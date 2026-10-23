import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { updateFeatureToggles } from "../src/services/featureService";
import {
  askToTake,
  cancelRequest,
  decideRequest,
  getPoolMode,
  listPool,
  listRequests,
  setPoolMode,
} from "../src/services/leadPoolService";
import * as leadService from "../src/services/leadService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

async function setup() {
  const org = await createTestOrganization("Pool");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const salesA = await createTestContext(org.id, "SALES", "a");
  const salesB = await createTestContext(org.id, "SALES", "b");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const statusId = await getLeadStatusId(org.id);
  const unassigned = async () => {
    const { lead } = await leadService.createLead(management, { leadStatusId: statusId });
    await adminDb.lead.update({ where: { id: lead.id }, data: { ownerMembershipId: null } });
    return lead;
  };
  return { org, management, salesA, salesB, delivery, statusId, unassigned };
}

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

const notificationsFor = (organizationId: string, membershipId: string) =>
  adminDb.notification.findMany({ where: { organizationId, membershipId, type: "LEAD_POOL" }, orderBy: { createdAt: "asc" } });

describe("shared lead pool (FIG-1031, B2.02)", () => {
  it("lists only unassigned open leads; Sales never sees another user's owned lead through it", async () => {
    const { org, management, salesA, salesB, statusId, unassigned } = await setup();
    const free = await unassigned();
    const { lead: ownedByB } = await leadService.createLead(salesB, { leadStatusId: statusId });
    const archived = await unassigned();
    await leadService.archiveLead(management, archived.id);

    const asA = await listPool(salesA);
    expect(asA.items.map((l) => l.id)).toEqual([free.id]);
    expect(JSON.stringify(asA)).not.toContain(ownedByB.id);
    const asManagement = await listPool(management);
    expect(asManagement.items.map((l) => l.id)).toEqual([free.id]);
    void org;
  });

  it("the pool exists for Sales only while the departure is on; off, it is refused with the explained no-access", async () => {
    const { org, management, unassigned } = await setup();
    await unassigned();
    await updateFeatureToggles(management, { "departure.shared_pool": false });
    const salesOff = await createTestContext(org.id, "SALES", "off");
    await expect(listPool(salesOff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(askToTake(salesOff, (await unassigned()).id)).rejects.toBeInstanceOf(ForbiddenError);
    // Management still sees the pool.
    expect((await listPool(management)).total).toBeGreaterThan(0);

    await updateFeatureToggles(management, { "departure.shared_pool": true });
    const salesOn = await createTestContext(org.id, "SALES", "on");
    await expect(listPool(salesOn)).resolves.toBeDefined();
  });

  it("other roles do not get the pool", async () => {
    const { delivery } = await setup();
    await expect(listPool(delivery)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("approval mode: the request notifies Management, approving makes the lead the requester's own at once", async () => {
    const { org, management, salesA, unassigned } = await setup();
    const lead = await unassigned();
    expect(await getPoolMode(org.id)).toBe("approval");

    const asked = await askToTake(salesA, lead.id, { note: "I know this client" });
    expect(asked).toMatchObject({ mode: "approval", taken: false });
    expect(asked.request.status).toBe("PENDING");
    // Asking twice is the same request.
    expect((await askToTake(salesA, lead.id)).request.id).toBe(asked.request.id);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).ownerMembershipId).toBeNull();
    expect((await notificationsFor(org.id, management.membershipId)).map((n) => n.title)[0]).toMatch(/asks to take a lead/);
    expect((await listPool(salesA)).items[0]).toMatchObject({ id: lead.id, myPendingRequestId: asked.request.id });

    const approved = await decideRequest(management, asked.request.id, { decision: "APPROVE" });
    expect(approved?.status).toBe("APPROVED");
    const owned = await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(owned.ownerMembershipId).toBe(salesA.membershipId);
    // It is now the salesperson's own lead and has left the pool.
    expect(await leadService.getLead(salesA, lead.id)).toMatchObject({ id: lead.id });
    expect((await listPool(salesA)).items).toEqual([]);
    expect((await adminDb.notification.findMany({ where: { organizationId: org.id, membershipId: salesA.membershipId, type: "LEAD_ASSIGNED" } })).length).toBe(1);

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["lead_pool.requested", "lead.owner_reassigned", "lead_pool.approved"]));
    await expect(decideRequest(management, asked.request.id, { decision: "APPROVE" })).rejects.toThrow(/already answered/);
  });

  it("declining needs a reason, keeps the lead in the pool, and tells the requester", async () => {
    const { org, management, salesA, unassigned } = await setup();
    const lead = await unassigned();
    const { request } = await askToTake(salesA, lead.id);

    expect((await issuesOf(decideRequest(management, request.id, { decision: "DECLINE" })))[0]).toMatchObject({ path: "reason" });
    const declined = await decideRequest(management, request.id, { decision: "DECLINE", reason: "Already promised to Achieng" });
    expect(declined).toMatchObject({ status: "DECLINED", decisionReason: "Already promised to Achieng" });
    expect((await listPool(salesA)).items.map((l) => l.id)).toEqual([lead.id]);
    expect((await notificationsFor(org.id, salesA.membershipId))[0]!.body).toContain("Already promised to Achieng");
    // They may ask again later.
    await expect(askToTake(salesA, lead.id)).resolves.toMatchObject({ taken: false });
  });

  it("auto mode: the first request wins at once and later requests are told it is taken", async () => {
    const { org, management, salesA, salesB, unassigned } = await setup();
    await setPoolMode(management, "auto");
    const lead = await unassigned();

    const first = await askToTake(salesA, lead.id);
    expect(first).toMatchObject({ mode: "auto", taken: true });
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).ownerMembershipId).toBe(salesA.membershipId);
    expect((await issuesOf(askToTake(salesB, lead.id)))[0]).toMatchObject({ code: "LEAD_ALREADY_OWNED" });
    void org;
  });

  it("two people asking at once cannot both get the lead", async () => {
    const { org, management, salesA, salesB, unassigned } = await setup();
    await setPoolMode(management, "auto");
    const lead = await unassigned();

    const results = await Promise.allSettled([askToTake(salesA, lead.id), askToTake(salesB, lead.id)]);
    const winners = results.filter((r) => r.status === "fulfilled" && r.value.taken);
    expect(winners).toHaveLength(1);
    const row = await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect([salesA.membershipId, salesB.membershipId]).toContain(row.ownerMembershipId);
    expect(await adminDb.leadPoolRequest.count({ where: { leadId: lead.id, status: "APPROVED" } })).toBe(1);
    void org;
  });

  it("approving one of two pending requests supersedes the other, and approving a lead that was taken meanwhile fails safely", async () => {
    const { org, management, salesA, salesB, unassigned } = await setup();
    const lead = await unassigned();
    const a = (await askToTake(salesA, lead.id)).request;
    const b = (await askToTake(salesB, lead.id)).request;

    await decideRequest(management, a.id, { decision: "APPROVE" });
    expect((await adminDb.leadPoolRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("SUPERSEDED");
    expect((await notificationsFor(org.id, salesB.membershipId)).map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringMatching(/already taken/i)]));

    // Management assigns a different lead directly while a request is pending for it.
    const other = await unassigned();
    const c = (await askToTake(salesB, other.id)).request;
    await leadService.assignLead(management, other.id, salesA.membershipId);
    expect((await issuesOf(decideRequest(management, c.id, { decision: "APPROVE" })))[0]).toMatchObject({ code: "LEAD_ALREADY_OWNED" });
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: other.id } })).ownerMembershipId).toBe(salesA.membershipId);
  });

  it("a lead that already has an owner, an archived or a converted one cannot be asked for", async () => {
    const { management, salesA, salesB, statusId, unassigned } = await setup();
    const { lead: owned } = await leadService.createLead(salesB, { leadStatusId: statusId });
    expect((await issuesOf(askToTake(salesA, owned.id)))[0]).toMatchObject({ code: "LEAD_ALREADY_OWNED" });
    const mine = await leadService.createLead(salesA, { leadStatusId: statusId });
    await expect(askToTake(salesA, mine.lead.id)).rejects.toThrow(/already yours/);

    const gone = await unassigned();
    await leadService.archiveLead(management, gone.id);
    await expect(askToTake(salesA, gone.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only Management decides; a requester sees and cancels their own requests; Management sees all", async () => {
    const { org, management, salesA, salesB, unassigned } = await setup();
    const lead = await unassigned();
    const { request } = await askToTake(salesA, lead.id);

    await expect(decideRequest(salesA, request.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelRequest(salesB, request.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listRequests(salesA)).items.map((r) => r.id)).toEqual([request.id]);
    expect((await listRequests(salesB)).items).toEqual([]);
    expect((await listRequests(management, { status: "PENDING" })).items.map((r) => r.id)).toEqual([request.id]);
    await expect(listRequests(management, { status: "BOGUS" })).rejects.toBeInstanceOf(ValidationError);

    const cancelled = await cancelRequest(salesA, request.id);
    expect(cancelled?.status).toBe("CANCELLED");
    await expect(cancelRequest(salesA, request.id)).rejects.toThrow(/pending/);
    void org;
  });

  it("the mode is Management's to change and is audited; another organisation's pool is separate", async () => {
    const one = await setup();
    const two = await setup();
    await expect(setPoolMode(one.salesA, "auto")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPoolMode(one.management, "bogus" as "auto")).rejects.toBeInstanceOf(ValidationError);
    await setPoolMode(one.management, "auto");
    expect(await getPoolMode(one.org.id)).toBe("auto");
    expect(await getPoolMode(two.org.id)).toBe("approval");
    await one.unassigned();
    expect((await listPool(two.management)).items).toEqual([]);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: one.org.id, action: "lead_pool.mode_changed" } });
    expect(audit).toHaveLength(1);
  });
});
