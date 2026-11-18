import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getPwaManifest, getPwaVersion } from "../src/services/pwaService";
import { MAX_BATCH, OFFLINE_SAFE_KINDS, applySyncBatch, getSyncStatus } from "../src/services/syncService";
import { updateOrganizationLook } from "../src/services/organizationLookService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";
import { createCompanyRow, createOpenDeal } from "./helpers/stage3";

const cid = (label: string) => `${label}-${randomUUID()}`;

async function setup() {
  const org = await createTestOrganization("Sync");
  const sales = await createTestContext(org.id, "SALES", "sync.sales");
  const management = await createTestContext(org.id, "MANAGEMENT", "sync.mgmt");
  return { org, sales, management };
}

const capture = (clientId: string, name: string, phone: string, extra: Record<string, unknown> = {}, clientCreatedAt?: string) => ({
  clientId,
  kind: "QUICK_CAPTURE",
  payload: { name, phone, ...extra },
  ...(clientCreatedAt ? { clientCreatedAt } : {}),
});

describe("replay (FIG-1064: replaying the same batch twice changes nothing)", () => {
  it("answers DUPLICATE with the first answer, and creates and changes nothing the second time", async () => {
    const { org, sales } = await setup();
    const company = await createCompanyRow(org.id, { ownerMembershipId: sales.membershipId });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Known", phone: "0711222333", companyId: company.id, ownerMembershipId: sales.membershipId } });
    const batch = {
      mutations: [
        capture(cid("cap"), "Replay Person", "0722111000", { note: "Met at the gate", followUp: { title: "Call back" } }),
        { clientId: cid("call"), kind: "CALL_LOG", payload: { contactId: contact.id, outcome: "REACHED", note: "Confirmed", durationSeconds: 90 } },
        { clientId: cid("note"), kind: "NOTE_ADD", payload: { contactId: contact.id, text: "Prefers WhatsApp" } },
        { clientId: cid("task"), kind: "TASK_CREATE", payload: { title: "Send brochure", contactId: contact.id } },
      ],
    };
    const first = await applySyncBatch(sales, batch);
    expect(first.counts).toEqual({ applied: 4, duplicate: 0, conflict: 0, rejected: 0 });
    expect(first.results.map((r) => r.status)).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED"]);

    const snapshot = async () => ({
      leads: await adminDb.lead.count({ where: { organizationId: org.id } }),
      contacts: await adminDb.contact.count({ where: { organizationId: org.id } }),
      tasks: await adminDb.task.count({ where: { organizationId: org.id } }),
      activities: await adminDb.activity.count({ where: { organizationId: org.id } }),
      communications: await adminDb.communication.count({ where: { organizationId: org.id } }),
      audit: await adminDb.auditEvent.count({ where: { organizationId: org.id } }),
    });
    const before = await snapshot();

    const second = await applySyncBatch(sales, batch);
    expect(second.counts).toEqual({ applied: 0, duplicate: 4, conflict: 0, rejected: 0 });
    expect(second.results.every((r) => r.status === "DUPLICATE" && r.originalStatus === "APPLIED")).toBe(true);
    // The second answer carries what the first made, so the phone can reconcile.
    expect(second.results.map((r) => r.entity)).toEqual(first.results.map((r) => r.entity));
    expect(await snapshot()).toEqual(before);
    expect(await adminDb.syncMutation.count({ where: { organizationId: org.id } })).toBe(4);
  });

  it("two requests racing with the same client ids apply each action once", async () => {
    const { org, sales } = await setup();
    const batch = { mutations: [capture(cid("race"), "Race Person", "0733000111"), { clientId: cid("racetask"), kind: "TASK_CREATE", payload: { title: "Race task" } }] };
    const [a, b, c] = await Promise.all([applySyncBatch(sales, batch), applySyncBatch(sales, batch), applySyncBatch(sales, batch)]);
    const all = [a, b, c].flatMap((r) => r.results);
    expect(all.filter((r) => r.status === "APPLIED")).toHaveLength(2);
    expect(all.filter((r) => r.status === "DUPLICATE")).toHaveLength(4);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await adminDb.task.count({ where: { organizationId: org.id, title: "Race task" } })).toBe(1);
  });

  it("the same client id twice in one batch is applied once", async () => {
    const { org, sales } = await setup();
    const id = cid("same");
    const result = await applySyncBatch(sales, { mutations: [capture(id, "Twice Person", "0733000222"), capture(id, "Twice Person", "0733000222")] });
    expect(result.results.map((r) => r.status)).toEqual(["APPLIED", "DUPLICATE"]);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("a client id reused for a different action is refused, not treated as a replay", async () => {
    const { org, sales } = await setup();
    const id = cid("reuse");
    await applySyncBatch(sales, { mutations: [capture(id, "First Use", "0733000333")] });
    const result = await applySyncBatch(sales, { mutations: [capture(id, "Different Use", "0733000444")] });
    expect(result.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "CLIENT_ID_REUSED" } });
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("a request that died mid-way leaves a claim: fresh it blocks a replay, stale it is taken over", async () => {
    const { org, sales } = await setup();
    const id = cid("crash");
    const batch = { mutations: [{ clientId: id, kind: "TASK_CREATE", payload: { title: "Survives a crash" } }] };
    expect((await applySyncBatch(sales, batch)).results[0]!.status).toBe("APPLIED");
    const where = { organizationId_membershipId_clientId: { organizationId: org.id, membershipId: sales.membershipId, clientId: id } };

    // Still being worked on (a request in flight): the replay waits, it does not run a second copy.
    await adminDb.syncMutation.update({ where, data: { status: "PENDING", createdAt: new Date() } });
    expect((await applySyncBatch(sales, batch)).results[0]).toMatchObject({ status: "DUPLICATE", originalStatus: "PENDING" });

    // Abandoned for minutes (the request died): the replay takes over and finishes the job.
    await adminDb.syncMutation.update({ where, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await applySyncBatch(sales, batch)).results[0]!.status).toBe("APPLIED");
    expect((await adminDb.syncMutation.findUniqueOrThrow({ where })).status).toBe("APPLIED");
  });
});

describe("ordering", () => {
  it("runs items in the order the person made them, whatever order they arrive in", async () => {
    const { org, sales } = await setup();
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: org.id, key: "NEW" } })).id, ownerMembershipId: sales.membershipId } });
    const t = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const ids = { late: cid("late"), early: cid("early"), middle: cid("middle") };
    const result = await applySyncBatch(sales, {
      mutations: [
        { clientId: ids.late, kind: "NOTE_ADD", payload: { leadId: lead.id, text: "third" }, clientCreatedAt: t(1) },
        { clientId: ids.early, kind: "NOTE_ADD", payload: { leadId: lead.id, text: "first" }, clientCreatedAt: t(30) },
        { clientId: ids.middle, kind: "NOTE_ADD", payload: { leadId: lead.id, text: "second" }, clientCreatedAt: t(10) },
      ],
    });
    // Results come back in the request's order; processing followed the time order.
    expect(result.results.map((r) => r.clientId)).toEqual([ids.late, ids.early, ids.middle]);
    expect(result.processedOrder).toEqual([1, 2, 0]);
    // Each note is stamped with when the person wrote it, so the timeline reads in order.
    const notes = await adminDb.activity.findMany({ where: { organizationId: org.id, leadId: lead.id }, orderBy: { occurredAt: "asc" } });
    expect(notes.map((n) => n.description)).toEqual(["first", "second", "third"]);
  });

  it("items with no time keep their own order after the timed ones, and a later item can refer to an earlier one", async () => {
    const { org, sales } = await setup();
    const capId = cid("capture");
    const result = await applySyncBatch(sales, {
      mutations: [
        // Listed first, but depends on the capture below.
        { clientId: cid("task"), kind: "TASK_CREATE", payload: { title: "Follow the capture", leadId: `ref:${capId}` } },
        capture(capId, "Ref Person", "0744000111", {}, new Date(Date.now() - 60_000).toISOString()),
      ],
    });
    expect(result.processedOrder).toEqual([1, 0]);
    expect(result.results.map((r) => r.status)).toEqual(["APPLIED", "APPLIED"]);
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(await adminDb.task.count({ where: { organizationId: org.id, leadId: lead.id, title: "Follow the capture" } })).toBe(1);
  });

  it("a reference to something that was not applied fails that item only, with a reason", async () => {
    const { org, sales } = await setup();
    const badId = cid("bad");
    const result = await applySyncBatch(sales, {
      mutations: [
        { clientId: badId, kind: "QUICK_CAPTURE", payload: { name: "No Way To Reach" } },
        { clientId: cid("dependent"), kind: "NOTE_ADD", payload: { leadId: `ref:${badId}`, text: "depends" } },
        { clientId: cid("fine"), kind: "TASK_CREATE", payload: { title: "Independent task" } },
      ],
    });
    expect(result.results.map((r) => r.status)).toEqual(["REJECTED", "REJECTED", "APPLIED"]);
    expect(result.results[0]!.reason?.code).toBe("VALIDATION_FAILED");
    expect(result.results[1]!.reason?.code).toBe("DEPENDENCY_FAILED");
    expect(await adminDb.task.count({ where: { organizationId: org.id, title: "Independent task" } })).toBe(1);
  });

  it("never records anything in the future: a phone clock that is ahead is treated as now", async () => {
    const { org, sales } = await setup();
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: org.id, key: "NEW" } })).id, ownerMembershipId: sales.membershipId } });
    const now = new Date();
    await applySyncBatch(sales, { mutations: [{ clientId: cid("future"), kind: "NOTE_ADD", payload: { leadId: lead.id, text: "from the future" }, clientCreatedAt: new Date(now.getTime() + 3 * 3600_000).toISOString() }] }, now);
    const note = await adminDb.activity.findFirstOrThrow({ where: { organizationId: org.id, leadId: lead.id } });
    expect(note.occurredAt.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("conflicts: the server wins on stage and ownership", () => {
  it("a stale stage change answers CONFLICT with what the server has, and never overwrites", async () => {
    const { org, sales } = await setup();
    const deal = await createOpenDeal(org.id, sales);
    const negotiation = await getPipelineStageId(org.id, "NEGOTIATION");
    // Someone moved it on while the phone was offline.
    await adminDb.deal.update({ where: { id: deal.id }, data: { pipelineStageId: negotiation } });
    const result = await applySyncBatch(sales, {
      mutations: [{ clientId: cid("stale"), kind: "STAGE_CHANGE", payload: { dealId: deal.id, expectedStageId: deal.pipelineStageId, toStageId: await getPipelineStageId(org.id, "PROPOSAL_SENT") } }],
    });
    expect(result.results[0]).toMatchObject({
      status: "CONFLICT",
      reason: { code: "STAGE_CHANGED" },
      entity: { type: "Deal", id: deal.id },
      serverState: { stageId: negotiation, stageName: "Negotiation" },
    });
    expect(result.results[0]!.reason?.message).toContain("Negotiation");
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).pipelineStageId).toBe(negotiation);
    expect(await adminDb.dealMove.count({ where: { organizationId: org.id, dealId: deal.id } })).toBe(0);
  });

  it("even a current stage change is not applied: the pipeline is read-only offline", async () => {
    const { org, sales } = await setup();
    const deal = await createOpenDeal(org.id, sales);
    const target = await getPipelineStageId(org.id, "PROPOSAL_SENT");
    const result = await applySyncBatch(sales, { mutations: [{ clientId: cid("current"), kind: "STAGE_CHANGE", payload: { dealId: deal.id, expectedStageId: deal.pipelineStageId, toStageId: target } }] });
    expect(result.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "NOT_ALLOWED_OFFLINE" } });
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).pipelineStageId).toBe(deal.pipelineStageId);
  });

  it("an owner change is server-wins too: stale is a conflict, current is refused", async () => {
    const { org, sales, management } = await setup();
    const deal = await createOpenDeal(org.id, sales);
    const stale = await applySyncBatch(sales, { mutations: [{ clientId: cid("owner1"), kind: "OWNER_CHANGE", payload: { dealId: deal.id, expectedOwnerMembershipId: management.membershipId, toOwnerMembershipId: management.membershipId } }] });
    expect(stale.results[0]).toMatchObject({ status: "CONFLICT", reason: { code: "OWNER_CHANGED" }, serverState: { ownerMembershipId: sales.membershipId } });
    const current = await applySyncBatch(sales, { mutations: [{ clientId: cid("owner2"), kind: "OWNER_CHANGE", payload: { dealId: deal.id, expectedOwnerMembershipId: sales.membershipId, toOwnerMembershipId: management.membershipId } }] });
    expect(current.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "NOT_ALLOWED_OFFLINE" } });
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).ownerMembershipId).toBe(sales.membershipId);
  });

  it("a deal the person cannot open is not found, and an incomplete change is invalid", async () => {
    const { org, sales } = await setup();
    const otherSales = await createTestContext(org.id, "SALES", "sync.other");
    const deal = await createOpenDeal(org.id, otherSales);
    const result = await applySyncBatch(sales, {
      mutations: [
        { clientId: cid("hidden"), kind: "STAGE_CHANGE", payload: { dealId: deal.id, expectedStageId: deal.pipelineStageId } },
        { clientId: cid("incomplete"), kind: "STAGE_CHANGE", payload: { dealId: deal.id } },
      ],
    });
    expect(result.results.map((r) => r.reason?.code)).toEqual(["NOT_FOUND", "INVALID_MUTATION"]);
  });

  it("a quick capture that finds a duplicate is a CONFLICT with the choices, and creates nothing", async () => {
    const { org, sales } = await setup();
    await applySyncBatch(sales, { mutations: [capture(cid("orig"), "Dup Person", "0755000111")] });
    const result = await applySyncBatch(sales, { mutations: [capture(cid("again"), "Dup Person", "0755000111")] });
    expect(result.results[0]).toMatchObject({ status: "CONFLICT", reason: { code: "DUPLICATE_FOUND" }, serverState: { options: ["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"] } });
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
    // Resolved later with a decision under a new client id.
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id } });
    const merged = await applySyncBatch(sales, { mutations: [capture(cid("merge"), "Dup Person", "0755000111", { duplicateDecision: "MERGE", duplicateId: lead.id, note: "Second visit" })] });
    expect(merged.results[0]).toMatchObject({ status: "APPLIED", entity: { type: "Lead", id: lead.id } });
  });
});

describe("tasks and notes: last write wins, permissions as online", () => {
  it("completing a task works once, and completing it again (another device) is a quiet success", async () => {
    const { sales } = await setup();
    const created = await applySyncBatch(sales, { mutations: [{ clientId: cid("t"), kind: "TASK_CREATE", payload: { title: "Finish me" } }] });
    const taskId = created.results[0]!.entity!.id;
    const done = await applySyncBatch(sales, { mutations: [{ clientId: cid("done1"), kind: "TASK_COMPLETE", payload: { taskId } }] });
    expect(done.results[0]!.status).toBe("APPLIED");
    const completedAt = (await adminDb.task.findUniqueOrThrow({ where: { id: taskId } })).completedAt!;
    const again = await applySyncBatch(sales, { mutations: [{ clientId: cid("done2"), kind: "TASK_COMPLETE", payload: { taskId } }] });
    expect(again.results[0]!.status).toBe("APPLIED");
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: taskId } })).completedAt!.getTime()).toBe(completedAt.getTime());
  });

  it("a task reassigned to someone else meanwhile cannot be completed from the old phone", async () => {
    const { org, sales, management } = await setup();
    const task = await adminDb.task.create({ data: { organizationId: org.id, title: "Mine then theirs", assigneeMembershipId: management.membershipId, createdByMembershipId: management.membershipId } });
    const result = await applySyncBatch(sales, { mutations: [{ clientId: cid("notmine"), kind: "TASK_COMPLETE", payload: { taskId: task.id } }] });
    expect(result.results[0]!.status).toBe("REJECTED");
    expect(["FORBIDDEN", "NOT_FOUND"]).toContain(result.results[0]!.reason?.code);
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("PENDING");
  });

  it("a note needs exactly one record, and text", async () => {
    const { org, sales } = await setup();
    const company = await createCompanyRow(org.id, { ownerMembershipId: sales.membershipId });
    const result = await applySyncBatch(sales, {
      mutations: [
        { clientId: cid("n1"), kind: "NOTE_ADD", payload: { text: "nowhere" } },
        { clientId: cid("n2"), kind: "NOTE_ADD", payload: { companyId: company.id } },
        { clientId: cid("n3"), kind: "NOTE_ADD", payload: { companyId: company.id, text: "ok" } },
      ],
    });
    expect(result.results.map((r) => r.status)).toEqual(["REJECTED", "REJECTED", "APPLIED"]);
  });

  it("WhatsApp and call logs use the same rules as the quick log: no number on file is refused with the reason", async () => {
    const { org, sales } = await setup();
    const lead = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "NoPhone", ownerMembershipId: sales.membershipId } });
    const result = await applySyncBatch(sales, { mutations: [{ clientId: cid("wa"), kind: "WHATSAPP_LOG", payload: { contactId: lead.id, outcome: "REACHED" } }] });
    expect(result.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "VALIDATION_FAILED" } });
    expect(result.results[0]!.reason?.issues?.[0]?.code).toBe("NO_PHONE_ON_FILE");
  });
});

describe("batch shape and permissions", () => {
  it("refuses an empty batch or one over the limit, and answers bad items one by one", async () => {
    const { org, sales } = await setup();
    await expect(applySyncBatch(sales, { mutations: [] })).rejects.toThrow(ValidationError);
    await expect(applySyncBatch(sales, { mutations: Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ clientId: `bulk-id-${i}-${randomUUID()}`, kind: "TASK_CREATE" })) })).rejects.toThrow(ValidationError);

    const result = await applySyncBatch(sales, {
      mutations: [
        { clientId: "short", kind: "TASK_CREATE", payload: { title: "bad id" } },
        { clientId: cid("kind"), kind: "DELETE_EVERYTHING" },
        { clientId: cid("time"), kind: "TASK_CREATE", payload: { title: "bad time" }, clientCreatedAt: "last tuesday" },
        { clientId: cid("big"), kind: "TASK_CREATE", payload: { title: "big", description: "x".repeat(25_000) } },
        { clientId: cid("good"), kind: "TASK_CREATE", payload: { title: "good one" } },
      ],
    });
    expect(result.results.map((r) => r.status)).toEqual(["REJECTED", "REJECTED", "REJECTED", "REJECTED", "APPLIED"]);
    expect(result.results.map((r) => r.reason?.code)).toEqual(["INVALID_MUTATION", "UNKNOWN_KIND", "INVALID_MUTATION", "INVALID_MUTATION", undefined]);
    expect(result.counts).toEqual({ applied: 1, duplicate: 0, conflict: 0, rejected: 4 });
    expect(await adminDb.task.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("lists exactly the actions that are safe offline", () => {
    expect([...OFFLINE_SAFE_KINDS].sort()).toEqual(["CALL_LOG", "NOTE_ADD", "QUICK_CAPTURE", "TASK_COMPLETE", "TASK_CREATE", "WHATSAPP_LOG"]);
  });

  it("applies the caller's own permissions to every item", async () => {
    const { org } = await setup();
    const delivery = await createTestContext(org.id, "DELIVERY", "sync.delivery");
    const result = await applySyncBatch(delivery, { mutations: [capture(cid("nope"), "Delivery Capture", "0766000111")] });
    expect(result.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "FORBIDDEN" } });
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("client ids belong to a person in an organisation: the same id elsewhere is a different action", async () => {
    const a = await setup();
    const b = await setup();
    const id = cid("shared");
    expect((await applySyncBatch(a.sales, { mutations: [{ clientId: id, kind: "TASK_CREATE", payload: { title: "A task" } }] })).results[0]!.status).toBe("APPLIED");
    expect((await applySyncBatch(b.sales, { mutations: [{ clientId: id, kind: "TASK_CREATE", payload: { title: "B task" } }] })).results[0]!.status).toBe("APPLIED");
    // Another person in the same organisation cannot replay or read A's id either.
    const colleague = await createTestContext(a.org.id, "SALES", "sync.colleague");
    expect((await applySyncBatch(colleague, { mutations: [{ clientId: id, kind: "TASK_CREATE", payload: { title: "Colleague task" } }] })).results[0]!.status).toBe("APPLIED");
    expect(await adminDb.task.count({ where: { organizationId: a.org.id } })).toBe(2);
    expect(await adminDb.task.count({ where: { organizationId: b.org.id } })).toBe(1);
  });

  it("a reference to someone else's client id does not resolve", async () => {
    const a = await setup();
    const colleague = await createTestContext(a.org.id, "SALES", "sync.colleague2");
    const id = cid("theirs");
    await applySyncBatch(colleague, { mutations: [capture(id, "Their Lead", "0777000111")] });
    const result = await applySyncBatch(a.sales, { mutations: [{ clientId: cid("steal"), kind: "NOTE_ADD", payload: { leadId: `ref:${id}`, text: "snooping" } }] });
    expect(result.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "DEPENDENCY_FAILED" } });
  });

  it("the sync table is protected by row-level security", async () => {
    const a = await setup();
    const b = await setup();
    await applySyncBatch(a.sales, { mutations: [{ clientId: cid("rls"), kind: "TASK_CREATE", payload: { title: "RLS" } }] });
    const { withOrgContext } = await import("../src/db/orgScopedClient");
    const seenFromB = await withOrgContext(b.org.id, (tx) => tx.syncMutation.findMany({}));
    expect(seenFromB).toHaveLength(0);
    await expect(
      withOrgContext(b.org.id, (tx) => tx.syncMutation.create({ data: { organizationId: a.org.id, membershipId: a.sales.membershipId, clientId: "smuggled-id-1", kind: "TASK_CREATE", status: "APPLIED", requestHash: "x" } })),
    ).rejects.toThrow();
  });
});

describe("queue status", () => {
  it("shows the last sync, the last seven days, and what needs attention", async () => {
    const { org, sales } = await setup();
    const empty = await getSyncStatus(sales);
    expect(empty).toMatchObject({ lastSyncAt: null, lastSevenDays: { applied: 0, conflict: 0, rejected: 0 }, needsAttention: [], maxBatch: MAX_BATCH });

    const deal = await createOpenDeal(org.id, sales);
    await applySyncBatch(sales, {
      mutations: [
        { clientId: cid("ok"), kind: "TASK_CREATE", payload: { title: "Status task" } },
        { clientId: cid("conflict"), kind: "STAGE_CHANGE", payload: { dealId: deal.id, expectedStageId: await getPipelineStageId(org.id, "NEGOTIATION") } },
        { clientId: cid("reject"), kind: "TASK_COMPLETE", payload: {} },
      ],
    });
    const status = await getSyncStatus(sales);
    expect(status.lastSyncAt).toBeInstanceOf(Date);
    expect(status.lastSevenDays).toMatchObject({ applied: 1, conflict: 1, rejected: 1 });
    expect(status.needsAttention.map((n) => n.status).sort()).toEqual(["CONFLICT", "REJECTED"]);
    expect(status.needsAttention.every((n) => n.reason?.message)).toBe(true);

    // Nobody else's queue shows up.
    const other = await createTestContext(org.id, "SALES", "sync.other.status");
    expect((await getSyncStatus(other)).lastSevenDays).toMatchObject({ applied: 0, conflict: 0, rejected: 0 });
  });
});

describe("PWA manifest and cache version", () => {
  afterEach(() => undefined);

  it("builds the manifest from the organisation's own look, for any signed-in member", async () => {
    const { org, sales, management } = await setup();
    await updateOrganizationLook(management, { displayName: "Kamau Hardware & Supplies" });
    const manifest = await getPwaManifest(sales);
    expect(manifest).toMatchObject({
      name: "Kamau Hardware & Supplies",
      short_name: "Kamau Hardwa",
      start_url: `/o/${org.slug}`,
      scope: `/o/${org.slug}`,
      display: "standalone",
    });
    expect(manifest.theme_color).toMatch(/^#/);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("changes the cache version when the look or the release changes, and says what may be queued offline", async () => {
    const { org, sales, management } = await setup();
    const first = await getPwaVersion(sales);
    expect(await getPwaVersion(sales)).toMatchObject({ cacheVersion: first.cacheVersion });
    expect(first.cacheVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(first.offline).toMatchObject({ maxBatch: MAX_BATCH, safeKinds: [...OFFLINE_SAFE_KINDS], serverWinsKinds: ["STAGE_CHANGE", "OWNER_CHANGE"] });

    await updateOrganizationLook(management, { defaultTheme: "FOREST" as never }).catch(() => undefined);
    await adminDb.organization.update({ where: { id: org.id }, data: { displayName: "A New Name" } });
    const second = await getPwaVersion(sales);
    expect(second.cacheVersion).not.toBe(first.cacheVersion);

    // Another organisation has its own number.
    const other = await createTestContext((await createTestOrganization("SyncOther")).id, "SALES", "sync.other.pwa");
    expect((await getPwaVersion(other)).cacheVersion).not.toBe(second.cacheVersion);
  });
});

void ForbiddenError;
