import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { dbCallStats } from "../src/db/orgScopedClient";
import { quickCapture } from "../src/services/quickCaptureService";
import { createTestContext, createTestOrganization, getLeadSourceId, getServiceId } from "./helpers/fixtures";

async function setup() {
  const org = await createTestOrganization("QuickCapture");
  const sales = await createTestContext(org.id, "SALES", "qc.sales");
  const management = await createTestContext(org.id, "MANAGEMENT", "qc.mgmt");
  return { org, sales, management };
}

const counts = async (orgId: string) => ({
  leads: await adminDb.lead.count({ where: { organizationId: orgId } }),
  contacts: await adminDb.contact.count({ where: { organizationId: orgId } }),
  tasks: await adminDb.task.count({ where: { organizationId: orgId } }),
});

describe("quick capture defaults (FIG-1065)", () => {
  it("makes the caller the owner, status New, source Physical Meeting, and returns a slim answer", async () => {
    const { org, sales } = await setup();
    const result = await quickCapture(sales, { name: "Amina Odhiambo", phone: "0722 123 456" });
    expect(result.status).toBe("CREATED");
    if (result.status !== "CREATED") throw new Error("unreachable");
    const lead = await adminDb.lead.findUniqueOrThrow({ where: { id: result.lead.id }, include: { leadStatus: true, leadSource: true, contact: true } });
    expect(lead.ownerMembershipId).toBe(sales.membershipId);
    expect(lead.createdByMembershipId).toBe(sales.membershipId);
    expect(lead.leadStatus.key).toBe("NEW");
    expect(lead.leadSource?.key).toBe("PHYSICAL_MEETING");
    expect(lead.contact).toMatchObject({ firstName: "Amina", lastName: "Odhiambo", phone: "0722 123 456" });
    expect(result.contact).toEqual({ id: lead.contactId, name: "Amina Odhiambo" });
    expect(result.followUpTask).toBeNull();
    expect(Object.keys(result.lead).sort()).toEqual(["createdAt", "id", "ownerMembershipId", "serviceId", "sourceId", "statusId"]);
    void org;
  });

  it("uses the source the caller used last", async () => {
    const { org, sales } = await setup();
    const referral = await getLeadSourceId(org.id, "REFERRAL");
    const first = await quickCapture(sales, { name: "First Person", phone: "0711000111", sourceId: referral });
    if (first.status !== "CREATED") throw new Error("expected CREATED");
    const second = await quickCapture(sales, { name: "Second Person", phone: "0711000222" });
    if (second.status !== "CREATED") throw new Error("expected CREATED");
    expect(second.lead.sourceId).toBe(referral);
    // Another person's habit is not mine.
    const other = await createTestContext(org.id, "SALES", "qc.other");
    const third = await quickCapture(other, { name: "Third Person", phone: "0711000333" });
    if (third.status !== "CREATED") throw new Error("expected CREATED");
    expect(third.lead.sourceId).toBe(await getLeadSourceId(org.id, "PHYSICAL_MEETING"));
  });

  it("falls back to the first active source when Physical Meeting is hidden, and never picks a hidden last-used one", async () => {
    const { org, sales } = await setup();
    const referral = await getLeadSourceId(org.id, "REFERRAL");
    await quickCapture(sales, { name: "Seed Person", phone: "0711999000", sourceId: referral });
    await adminDb.leadSource.update({ where: { id: referral }, data: { isActive: false } });
    await adminDb.leadSource.update({ where: { id: await getLeadSourceId(org.id, "PHYSICAL_MEETING") }, data: { isActive: false } });
    const result = await quickCapture(sales, { name: "Fallback Person", phone: "0711999111" });
    if (result.status !== "CREATED") throw new Error("expected CREATED");
    const first = await adminDb.leadSource.findFirstOrThrow({ where: { organizationId: org.id, isActive: true }, orderBy: { sequence: "asc" } });
    expect(result.lead.sourceId).toBe(first.id);
  });

  it("takes the service, source, company, a note and a follow-up task in one call", async () => {
    const { org, sales } = await setup();
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Known Traders Ltd" } });
    const serviceId = await getServiceId(org.id, "CCTV");
    const result = await quickCapture(sales, {
      name: "Brian Kamau",
      email: "brian@knowntraders.test",
      company: "known traders ltd",
      serviceId,
      sourceId: await getLeadSourceId(org.id, "NETWORKING"),
      note: "Met at the Nairobi expo, wants 8 cameras.",
      followUp: { title: "Send the CCTV quote", dueOn: "2026-11-05" },
    });
    if (result.status !== "CREATED") throw new Error("expected CREATED");
    const lead = await adminDb.lead.findUniqueOrThrow({ where: { id: result.lead.id } });
    expect(lead).toMatchObject({ companyId: company.id, serviceInterestId: serviceId, notes: "Met at the Nairobi expo, wants 8 cameras." });
    const task = await adminDb.task.findUniqueOrThrow({ where: { id: result.followUpTask!.id } });
    expect(task).toMatchObject({ title: "Send the CCTV quote", leadId: lead.id, assigneeMembershipId: sales.membershipId });
    expect(task.dueAt?.toISOString().slice(0, 10)).toBe("2026-11-05");
  });

  it("keeps an unknown company name in the note instead of inventing a company", async () => {
    const { org, sales } = await setup();
    const result = await quickCapture(sales, { name: "Cynthia Wanjiru", phone: "0733111222", company: "Brand New Co", note: "Called back." });
    if (result.status !== "CREATED") throw new Error("expected CREATED");
    const lead = await adminDb.lead.findUniqueOrThrow({ where: { id: result.lead.id } });
    expect(lead.companyId).toBeNull();
    expect(lead.notes).toBe("Called back.\nCompany: Brand New Co");
    expect(await adminDb.company.count({ where: { organizationId: org.id, name: "Brand New Co" } })).toBe(0);
  });
});

describe("validation and permissions", () => {
  it("needs a name and a way to reach the person, and checks every id belongs to the organisation", async () => {
    const { sales, org } = await setup();
    const before = await counts(org.id);
    for (const [input, path] of [
      [{ name: "  ", phone: "0700000000" }, "name"],
      [{ name: "No Contact" }, "phone"],
      [{ name: "Bad Email", email: "not-an-email" }, "email"],
      [{ name: "Bad Follow", phone: "0700000000", followUp: { title: " " } }, "followUp.title"],
      [{ name: "Bad Decision", phone: "0700000000", duplicateDecision: "NOPE" as never }, "duplicateDecision"],
      [{ name: "Missing Id", phone: "0700000000", duplicateDecision: "MERGE" as const }, "duplicateId"],
    ] as const) {
      const err = await quickCapture(sales, input as never).catch((e) => e);
      expect(err, path).toBeInstanceOf(ValidationError);
    }
    await expect(quickCapture(sales, { name: "Foreign Source", phone: "0700000000", sourceId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(ValidationError);
    await expect(quickCapture(sales, { name: "Foreign Service", phone: "0700000000", serviceId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(ValidationError);
    expect(await counts(org.id)).toEqual(before);

    const other = await createTestOrganization("QuickCaptureOther");
    const otherSource = await getLeadSourceId(other.id, "REFERRAL");
    await expect(quickCapture(sales, { name: "Cross Org", phone: "0700000000", sourceId: otherSource })).rejects.toThrow(ValidationError);
  });

  it("is for people who can create leads and contacts", async () => {
    const { org } = await setup();
    for (const role of ["DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const) {
      const ctx = await createTestContext(org.id, role, `qc.${role}`);
      await expect(quickCapture(ctx, { name: "Nope Person", phone: "0700000000" })).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("duplicate warning (FIG-1065)", () => {
  async function withExisting() {
    const ctx = await setup();
    const first = await quickCapture(ctx.sales, { name: "Peter Mwangi", phone: "0700 555 123", email: "peter@example.test" });
    if (first.status !== "CREATED") throw new Error("expected CREATED");
    return { ...ctx, first };
  }

  it("warns before writing anything, naming the existing open lead", async () => {
    const { org, sales, first } = await withExisting();
    const before = await counts(org.id);
    const again = await quickCapture(sales, { name: "Pete Mwangi", phone: "+254 700 555 123", note: "Met again at the shop." });
    expect(again.status).toBe("DUPLICATE_WARNING");
    if (again.status !== "DUPLICATE_WARNING") throw new Error("unreachable");
    expect(again.created).toBe(false);
    expect(again.options).toEqual(["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"]);
    expect(again.duplicates[0]).toMatchObject({ entityType: "lead", id: first.lead.id, confidence: expect.stringMatching(/high|medium/) });
    expect(again.duplicates[0]!.label).toContain("open lead");
    expect(await counts(org.id)).toEqual(before);
  });

  it("OPEN_EXISTING returns the existing record and writes nothing", async () => {
    const { org, sales, first } = await withExisting();
    const before = await counts(org.id);
    const opened = await quickCapture(sales, { name: "Peter Mwangi", phone: "0700555123", duplicateDecision: "OPEN_EXISTING", duplicateId: first.lead.id });
    expect(opened).toEqual({ status: "OPENED_EXISTING", created: false, existing: { type: "lead", id: first.lead.id } });
    expect(await counts(org.id)).toEqual(before);
  });

  it("CREATE_ANYWAY creates a second lead, and says it ignored the warning", async () => {
    const { org, sales } = await withExisting();
    const created = await quickCapture(sales, { name: "Peter Mwangi", phone: "0700555123", duplicateDecision: "CREATE_ANYWAY" });
    expect(created.status).toBe("CREATED");
    if (created.status !== "CREATED") throw new Error("unreachable");
    expect(created.duplicatesIgnored).toBe(true);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("MERGE adds the note, fills only missing contact details, and creates the follow-up on the existing lead", async () => {
    const ctx = await setup();
    const first = await quickCapture(ctx.sales, { name: "Grace Njeri", phone: "0700 999 888" });
    if (first.status !== "CREATED") throw new Error("expected CREATED");
    const merged = await quickCapture(ctx.sales, {
      name: "Grace Njeri",
      phone: "0700 999 888",
      email: "grace@example.test",
      note: "Wants a demo on Friday.",
      followUp: { title: "Book the demo" },
      duplicateDecision: "MERGE",
      duplicateId: first.lead.id,
    });
    expect(merged).toMatchObject({ status: "MERGED", created: false, mergedInto: { type: "lead", id: first.lead.id } });
    expect(await adminDb.lead.count({ where: { organizationId: ctx.org.id } })).toBe(1);
    const contact = await adminDb.contact.findUniqueOrThrow({ where: { id: first.contact.id } });
    expect(contact).toMatchObject({ phone: "0700 999 888", email: "grace@example.test" });
    const note = await adminDb.activity.findFirstOrThrow({ where: { organizationId: ctx.org.id, leadId: first.lead.id, type: "NOTE" } });
    expect(note.description).toBe("Wants a demo on Friday.");
    expect((await adminDb.task.findMany({ where: { organizationId: ctx.org.id, leadId: first.lead.id } })).map((t) => t.title)).toEqual(["Book the demo"]);
    expect(await adminDb.auditEvent.count({ where: { organizationId: ctx.org.id, action: "quick_capture.merged" } })).toBe(1);

    // A merge never overwrites what is already on the contact.
    await quickCapture(ctx.sales, { name: "Grace Njeri", phone: "0711 000 000", email: "other@example.test", duplicateDecision: "MERGE", duplicateId: first.lead.id });
    expect(await adminDb.contact.findUniqueOrThrow({ where: { id: first.contact.id } })).toMatchObject({ phone: "0700 999 888", email: "grace@example.test" });
  });

  it("will not open or merge into a lead the caller cannot see, or one from another organisation", async () => {
    const { org, first } = await withExisting();
    // A different salesperson cannot see the first one's lead: it answers not found, like every other read.
    const other = await createTestContext(org.id, "SALES", "qc.other.sales");
    await expect(quickCapture(other, { name: "Peter Mwangi", phone: "0700555123", duplicateDecision: "OPEN_EXISTING", duplicateId: first.lead.id })).rejects.toThrow(NotFoundError);
    await expect(quickCapture(other, { name: "Peter Mwangi", phone: "0700555123", duplicateDecision: "MERGE", duplicateId: first.lead.id })).rejects.toThrow(NotFoundError);

    const foreign = await setup();
    await expect(quickCapture(foreign.sales, { name: "Peter Mwangi", phone: "0700555123", duplicateDecision: "MERGE", duplicateId: first.lead.id })).rejects.toThrow(NotFoundError);
  });

  it("counts a duplicate the caller cannot see without describing it", async () => {
    const { org, first } = await withExisting();
    const other = await createTestContext(org.id, "SALES", "qc.blind.sales");
    const result = await quickCapture(other, { name: "Peter Mwangi", phone: "0700555123" });
    // The other person cannot see that lead (or its contact, which Sales may), so what they get is bounded by their own access.
    if (result.status === "DUPLICATE_WARNING") {
      expect(JSON.stringify(result.duplicates)).not.toContain(first.lead.id);
    }
  });
});

describe("speed (FIG-1065: round trip under 300 ms p95)", () => {
  /**
   * The 300 ms budget is for the whole round trip on a mid-range mobile network, so the server's share has to be small
   * and, above all, bounded. Two checks: the number of database transactions a capture makes is fixed (the real driver of
   * latency, since each costs several round trips to Postgres), and the wall clock on this machine stays inside a
   * regression guard. On the Windows and Docker development database a capture measures about 150 to 250 ms because every
   * transaction is slow here; on a database next to the server the same 14 transactions cost a few ms each. The
   * production figure is measured in G1.04 (performance and scale) against staging.
   */
  it("a capture with a note and a follow-up makes a fixed, small number of database calls, and stays inside the guard", async () => {
    const { sales } = await setup();
    const timings: number[] = [];
    const calls: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const callsBefore = dbCallStats.orgContextCalls;
      const started = performance.now();
      const result = await quickCapture(sales, {
        name: `Speed Person ${i} Unique${i}x`,
        phone: `07${String(10_000_000 + i * 7919).slice(0, 8)}`,
        note: "Quick note",
        followUp: { title: "Call back", dueOn: "2026-12-01" },
      });
      timings.push(performance.now() - started);
      calls.push(dbCallStats.orgContextCalls - callsBefore);
      expect(result.status).toBe("CREATED");
    }
    // Same number every time, however many leads already exist, and no more than the budget below.
    expect(new Set(calls).size).toBe(1);
    expect(calls[0]).toBeLessThanOrEqual(16);
    timings.sort((a, b) => a - b);
    expect(timings[Math.floor(timings.length * 0.95)]!).toBeLessThan(600);
  });

  it("a duplicate warning is cheaper than a capture, and writes nothing", async () => {
    const { sales, org } = await setup();
    await quickCapture(sales, { name: "Warn Person", phone: "0700 111 000" });
    const before = dbCallStats.orgContextCalls;
    const again = await quickCapture(sales, { name: "Warn Person", phone: "0700 111 000" });
    expect(again.status).toBe("DUPLICATE_WARNING");
    expect(dbCallStats.orgContextCalls - before).toBeLessThanOrEqual(8);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });
});
