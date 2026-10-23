import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountDeactivatedError,
  ForbiddenError,
  RateLimitedError,
  ReassignmentRequiredError,
  SessionExpiredError,
  UnauthorizedError,
  ValidationError,
} from "../src/auth/errors";
import { hashPassword } from "../src/auth/password";
import { resolveRequestContext, type CookieReader } from "../src/auth/requestContext";
import { lookupSession, SESSION_COOKIE_NAME } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { buildErrorResponse } from "../src/lib/apiErrors";
import { createCompany } from "../src/repositories/companies";
import { createContact } from "../src/repositories/contacts";
import { createDeal } from "../src/repositories/deals";
import { createLead } from "../src/repositories/leads";
import { createProposalReference } from "../src/repositories/proposalReferences";
import { createTask } from "../src/repositories/tasks";
import * as authService from "../src/services/authService";
import { getAccessState } from "../src/services/accessStateService";
import * as membershipService from "../src/services/membershipService";
import * as reassignmentService from "../src/services/reassignmentService";
import * as signInEvents from "../src/services/signInEventService";
import {
  createTestContext,
  createTestMembership,
  createTestOrganization,
  createTestUser,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

const PASSWORD = "correct-horse-battery";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});

function uniqueIp(): string {
  return `198.51.100.${randomUUID().slice(0, 4)}`;
}
function uniqueEmail(prefix: string) {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
}
function cookieReaderFrom(entries: Record<string, string>): CookieReader {
  return {
    get(name) {
      const value = entries[name];
      return value === undefined ? undefined : { value };
    },
  };
}

async function withPassword(userId: string) {
  await adminDb.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(PASSWORD) } });
  return adminDb.user.findUniqueOrThrow({ where: { id: userId } });
}

async function member(organizationId: string, roleKey: string, prefix = "life") {
  const { user, membership } = await createTestMembership(organizationId, roleKey, prefix);
  return { user: await withPassword(user.id), membership };
}

/** A member who owns one of everything the checklist covers, plus things it must ignore. */
async function giveWork(organizationId: string, owner: string, by: string) {
  const company = await createCompany({ organizationId, name: "Acme Ltd", ownerMembershipId: owner, createdByMembershipId: by });
  const contact = await createContact({ organizationId, firstName: "Wanjiru", lastName: "K", ownerMembershipId: owner, createdByMembershipId: by });
  const openLead = await createLead({
    organizationId,
    leadStatusId: await getLeadStatusId(organizationId),
    companyId: company.id,
    ownerMembershipId: owner,
    createdByMembershipId: by,
  });
  // A converted lead and its deal, a won deal, and finished work must not count as open.
  const stage = await getPipelineStageId(organizationId);
  const openDeal = await createDeal({ organizationId, companyId: company.id, ownerMembershipId: owner, pipelineStageId: stage });
  const wonDeal = await createDeal({ organizationId, companyId: company.id, ownerMembershipId: owner, pipelineStageId: stage });
  await adminDb.deal.update({ where: { id: wonDeal.id }, data: { outcome: "WON", wonAt: new Date() } });
  const openTask = await createTask({ organizationId, title: "Call Acme", assigneeMembershipId: owner, createdByMembershipId: by });
  const doneTask = await createTask({ organizationId, title: "Old chore", assigneeMembershipId: owner, createdByMembershipId: by });
  await adminDb.task.update({ where: { id: doneTask.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  const proposal = await createProposalReference({ organizationId, dealId: openDeal.id, proposalNumber: `P-${randomUUID().slice(0, 6)}`, ownerMembershipId: owner });
  return { company, contact, openLead, openDeal, wonDeal, openTask, doneTask, proposal };
}

describe("account lockout (B1.05)", () => {
  async function lockedUser() {
    process.env.LOCKOUT_MAX_FAILURES = "3";
    process.env.LOCKOUT_DURATION_MS = String(15 * 60_000);
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "100";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "1000";
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await member(org.id, "SALES");
    for (let i = 0; i < 3; i++) {
      await expect(authService.login(user.email, "wrong", UA, uniqueIp())).rejects.toThrow(UnauthorizedError);
    }
    return { org, mgmt, user, membership };
  }

  it("locks the account after the configured run of wrong passwords -- and then refuses even the right one, generically", async () => {
    const { user } = await lockedUser();
    const row = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedSignInCount).toBe(3);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    // Same generic 429 as the rate limiter: no hint that the account exists.
    await expect(authService.login(user.email, PASSWORD, UA, uniqueIp())).rejects.toThrow(RateLimitedError);
    await expect(authService.login(user.email, "wrong", UA, uniqueIp())).rejects.toThrow(RateLimitedError);
    // An attempt while locked does not extend the lock.
    const after = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil!.getTime()).toBe(row.lockedUntil!.getTime());
  });

  it("records the failures and exactly one lockout event, and a lockout audit entry", async () => {
    const { org, mgmt, user, membership } = await lockedUser();
    await expect(authService.login(user.email, PASSWORD, UA, uniqueIp())).rejects.toThrow(RateLimitedError);

    const events = await signInEvents.listSignInEvents(mgmt, { membershipId: membership.id });
    const byOutcome = (o: string) => events.items.filter((e) => e.outcome === o);
    expect(byOutcome("FAILURE").map((e) => e.reason).sort()).toEqual(["LOCKED", "WRONG_PASSWORD", "WRONG_PASSWORD"]);
    expect(byOutcome("LOCKOUT")).toHaveLength(1);
    expect(byOutcome("LOCKOUT")[0]!.reason).toBe("TOO_MANY_FAILURES");

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "auth.locked_out", entityId: user.id } });
    expect(audit).toHaveLength(1);
  });

  it("unlocks by itself once the window has passed (time-based) and resets the counter", async () => {
    const { org, user } = await lockedUser();
    const lockedUntil = (await adminDb.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil!;

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(lockedUntil.getTime() - 1000));
    await expect(authService.login(user.email, PASSWORD, UA, uniqueIp())).rejects.toThrow(RateLimitedError);

    vi.setSystemTime(new Date(lockedUntil.getTime() + 1000));
    const result = await authService.login(user.email, PASSWORD, UA, uniqueIp());
    expect(result.userId).toBe(user.id);
    const row = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedSignInCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(
      await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "auth.unlocked", entityId: user.id } }),
    ).toBe(1);
  });

  it("can be unlocked by Management straight away, which also clears the email's login window", async () => {
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "600000";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "4";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "1000";
    process.env.LOCKOUT_MAX_FAILURES = "3";
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await member(org.id, "SALES");
    for (let i = 0; i < 3; i++) {
      await expect(authService.login(user.email, "wrong", UA, uniqueIp())).rejects.toThrow();
    }
    await expect(authService.login(user.email, PASSWORD, UA, uniqueIp())).rejects.toThrow(RateLimitedError);

    const result = await membershipService.unlockMember(mgmt, membership.id);
    expect(result).toEqual({ membershipId: membership.id, unlocked: true, wasLocked: true });
    const row = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).toBeNull();
    expect(row.failedSignInCount).toBe(0);

    // Straight back in: neither the lock nor the rate-limit window stops them.
    expect((await authService.login(user.email, PASSWORD, UA, uniqueIp())).userId).toBe(user.id);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "auth.unlocked", entityId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorMembershipId).toBe(mgmt.membershipId);
    expect(audit[0]!.metadata).toMatchObject({ by: "admin", wasLocked: true });
  });

  it("needs security.manage, and cannot reach another organisation's member", async () => {
    const { org, user, membership } = await lockedUser();
    const sales = await createTestContext(org.id, "SALES");
    await expect(membershipService.unlockMember(sales, membership.id)).rejects.toThrow(ForbiddenError);

    const otherOrg = await createTestOrganization();
    const otherMgmt = await createTestContext(otherOrg.id, "MANAGEMENT");
    await expect(membershipService.unlockMember(otherMgmt, membership.id)).rejects.toThrow(/not found/i);
    expect((await adminDb.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil).not.toBeNull();
  });

  it("a good sign-in resets the failure counter, so scattered mistakes never add up to a lockout", async () => {
    process.env.LOCKOUT_MAX_FAILURES = "3";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_EMAIL = "100";
    process.env.LOGIN_RATE_LIMIT_MAX_PER_IP = "1000";
    const org = await createTestOrganization();
    const { user } = await member(org.id, "SALES");
    for (let round = 0; round < 3; round++) {
      await expect(authService.login(user.email, "wrong", UA, uniqueIp())).rejects.toThrow();
      await expect(authService.login(user.email, "wrong", UA, uniqueIp())).rejects.toThrow();
      await authService.login(user.email, PASSWORD, UA, uniqueIp());
    }
    const row = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).toBeNull();
    expect(row.failedSignInCount).toBe(0);
  });

  it("shows in the member list while it lasts", async () => {
    const { org, mgmt, membership } = await lockedUser();
    const list = await membershipService.listMemberships(mgmt);
    expect(list.find((m) => m.membershipId === membership.id)!.lockedUntil).not.toBeNull();
    expect(list.find((m) => m.membershipId === mgmt.membershipId)!.lockedUntil).toBeNull();
    expect(org.id).toBeTruthy();
  });
});

describe("deactivate member (B1.05)", () => {
  it("blocks sign-in, ends their sessions at once, and keeps their records and history", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await member(org.id, "SALES");
    const work = await giveWork(org.id, membership.id, membership.id);

    const live = await authService.login(user.email, PASSWORD, UA, uniqueIp());
    const second = await authService.login(user.email, PASSWORD, UA, uniqueIp());
    const cookies = cookieReaderFrom({ [SESSION_COOKIE_NAME]: live.token });
    expect((await resolveRequestContext(org.slug, cookies)).membershipId).toBe(membership.id);

    const result = await membershipService.deactivateMember(mgmt, membership.id);
    expect(result.status).toBe("INACTIVE");
    expect(result.deactivatedAt).toBeInstanceOf(Date);
    expect(result.deactivatedByMembershipId).toBe(mgmt.membershipId);

    // Existing sessions are unusable...
    for (const t of [live.token, second.token]) expect((await lookupSession(t)).state).toBe("revoked");
    const err = await resolveRequestContext(org.slug, cookies).catch((e) => e);
    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(err.reason).toBe("revoked");
    expect(await adminDb.session.count({ where: { userId: user.id, revokedReason: "DEACTIVATED" } })).toBe(2);

    // ...and so is signing in -- but only the right password is told why.
    await expect(authService.login(user.email, PASSWORD, UA, uniqueIp())).rejects.toThrow(AccountDeactivatedError);
    const refused = await authService.login(user.email, PASSWORD, UA, uniqueIp()).catch((e) => e);
    expect((await buildErrorResponse(refused, "r")).body.code).toBe("ACCOUNT_DEACTIVATED");
    expect((await buildErrorResponse(refused, "r")).status).toBe(403);
    await expect(authService.login(user.email, "wrong-password", UA, uniqueIp())).rejects.toThrow(UnauthorizedError);

    // Everything they owned and did is exactly where it was.
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: work.openLead.id } })).ownerMembershipId).toBe(membership.id);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: work.openDeal.id } })).ownerMembershipId).toBe(membership.id);
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: work.openTask.id } })).assigneeMembershipId).toBe(membership.id);

    const events = await signInEvents.listSignInEvents(mgmt, { membershipId: membership.id, outcome: "FAILURE" });
    expect(events.items.map((e) => e.reason)).toContain("DEACTIVATED");
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "membership.deactivated", entityId: membership.id } });
    expect(audit.metadata).toMatchObject({ sessionsRevoked: 2 });
  });

  it("returns the reassignment checklist for open tasks, leads, deals, accounts and proposals -- and nothing already finished", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await member(org.id, "SALES");
    const work = await giveWork(org.id, membership.id, membership.id);

    const result = await membershipService.deactivateMember(mgmt, membership.id);
    const cl = result.reassignment;
    expect(cl.membershipId).toBe(membership.id);
    expect(cl.totals).toEqual({ tasks: 1, leads: 1, deals: 1, companies: 1, contacts: 1, proposals: 1 });
    expect(cl.total).toBe(6);
    expect(cl.items.tasks).toEqual([{ id: work.openTask.id, label: "Call Acme" }]);
    expect(cl.items.leads[0]).toEqual({ id: work.openLead.id, label: "Acme Ltd" });
    expect(cl.items.deals.map((d) => d.id)).toEqual([work.openDeal.id]);
    expect(cl.items.contacts[0]!.label).toBe("Wanjiru K");
    expect(cl.items.companies[0]!.id).toBe(work.company.id);
    expect(cl.items.proposals[0]!.id).toBe(work.proposal.id);

    // The same list is available on its own.
    const again = await reassignmentService.getMemberReassignmentChecklist(mgmt, membership.id);
    expect(again.total).toBe(6);
  });

  it("keeps the member in another organisation signed in: only the sessions under this organisation end", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const mgmtA = await createTestContext(orgA.id, "MANAGEMENT");
    const { user, membership } = await member(orgA.id, "SALES");
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({
      data: { organizationId: orgB.id, userId: user.id, roleId: role.id, joinedAt: new Date(Date.now() + 1000) },
    });
    const { token } = await authService.login(user.email, PASSWORD, UA, uniqueIp());
    expect((await lookupSession(token)).state).toBe("active");

    await membershipService.deactivateMember(mgmtA, membership.id);
    // Their session was signed in under A, so it ends; they can sign straight back in to B.
    expect((await lookupSession(token)).state).toBe("revoked");
    const again = await authService.login(user.email, PASSWORD, UA, uniqueIp());
    expect(again.organizationSlug).toBe(orgB.slug);
    await expect(resolveRequestContext(orgA.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: again.token }))).rejects.toThrow(/No active membership/);
  });

  it("can be undone: reactivating restores sign-in and clears the deactivation stamp", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await member(org.id, "SALES");
    await membershipService.deactivateMember(mgmt, membership.id);
    await expect(authService.login(user.email, PASSWORD, UA, uniqueIp())).rejects.toThrow(AccountDeactivatedError);

    const back = await membershipService.reactivateMember(mgmt, membership.id);
    expect(back.status).toBe("ACTIVE");
    expect(back.deactivatedAt).toBeNull();
    expect(back.deactivatedByMembershipId).toBeNull();
    expect((await authService.login(user.email, PASSWORD, UA, uniqueIp())).organizationSlug).toBe(org.slug);
  });

  it("is a Management action, and the last Management member can never be deactivated", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES");
    const { membership } = await createTestMembership(org.id, "DELIVERY");
    await expect(membershipService.deactivateMember(sales, membership.id)).rejects.toThrow(ForbiddenError);
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    await expect(membershipService.deactivateMember(mgmt, mgmt.membershipId)).rejects.toThrow(ValidationError);
  });
});

describe("remove member (B1.05)", () => {
  it("is blocked while they own records: the error is a 409 carrying the checklist", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await member(org.id, "SALES");
    await giveWork(org.id, membership.id, membership.id);

    const err = await membershipService.removeMember(mgmt, membership.id).catch((e) => e);
    expect(err).toBeInstanceOf(ReassignmentRequiredError);
    const { status, body } = await buildErrorResponse(err, "req");
    expect(status).toBe(409);
    expect(body.code).toBe("REASSIGNMENT_REQUIRED");
    expect(body.reassignment!.total).toBe(6);
    expect(body.reassignment!.totals.leads).toBe(1);
    expect(body.message).toMatch(/still owns 6 records/);
    expect((await adminDb.membership.findUniqueOrThrow({ where: { id: membership.id } })).status).toBe("ACTIVE");
  });

  it("reassigns everything to a colleague in one step, atomically, then removes", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const leaving = await member(org.id, "SALES", "leaving");
    const taking = await member(org.id, "SALES", "taking");
    const work = await giveWork(org.id, leaving.membership.id, leaving.membership.id);

    const result = await reassignmentService.reassignMemberRecords(mgmt, leaving.membership.id, {
      toMembershipId: taking.membership.id,
    });
    expect(result.moved).toEqual({ tasks: 1, leads: 1, deals: 1, companies: 1, contacts: 1, proposals: 1 });
    expect(result.total).toBe(6);
    expect(result.remaining.total).toBe(0);

    // Open work moved; finished work stays attributed to the person who did it.
    const to = taking.membership.id;
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: work.openTask.id } })).assigneeMembershipId).toBe(to);
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: work.doneTask.id } })).assigneeMembershipId).toBe(leaving.membership.id);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: work.openDeal.id } })).ownerMembershipId).toBe(to);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: work.wonDeal.id } })).ownerMembershipId).toBe(leaving.membership.id);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: work.openLead.id } })).ownerMembershipId).toBe(to);
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: work.company.id } })).ownerMembershipId).toBe(to);
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: work.contact.id } })).ownerMembershipId).toBe(to);
    expect((await adminDb.proposalReference.findUniqueOrThrow({ where: { id: work.proposal.id } })).ownerMembershipId).toBe(to);
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "membership.records_reassigned" } });
    expect(audit.metadata).toMatchObject({ toMembershipId: to, tasks: 1, leads: 1 });

    const removed = await membershipService.removeMember(mgmt, leaving.membership.id);
    expect(removed.status).toBe("REMOVED");
    expect(removed.removedAt).toBeInstanceOf(Date);
    expect(removed.removedByMembershipId).toBe(mgmt.membershipId);
  });

  it("ends their sessions, takes away the organisation, and leaves the account awaiting access", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await member(org.id, "SALES");
    const { token } = await authService.login(user.email, PASSWORD, UA, uniqueIp());

    await membershipService.removeMember(mgmt, membership.id);
    expect((await lookupSession(token)).state).toBe("revoked");
    expect(await getAccessState(user.id)).toMatchObject({ state: "awaitingAccess", reason: "REMOVED" });

    // They can still sign in to the account itself -- to an awaiting-access screen, not the organisation.
    const again = await authService.login(user.email, PASSWORD, UA, uniqueIp());
    expect(again.organizationSlug).toBeNull();
    expect(again.access.awaitingAccess).toBe(true);
    await expect(resolveRequestContext(org.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: again.token }))).rejects.toThrow(/No active membership/);

    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "membership.removed", entityId: membership.id } });
    expect(audit.previousValue).toMatchObject({ status: "ACTIVE", roleKey: "SALES" });
    expect(await membershipService.listMemberships(mgmt)).toEqual(
      expect.arrayContaining([expect.objectContaining({ membershipId: membership.id, state: "removed", removedByName: "Test User" })]),
    );
  });

  it("cannot be done twice, to the last Management member, or by anyone but Management", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const { membership } = await member(org.id, "DELIVERY");
    await expect(membershipService.removeMember(sales, membership.id)).rejects.toThrow(ForbiddenError);
    await membershipService.removeMember(mgmt, membership.id);
    await expect(membershipService.removeMember(mgmt, membership.id)).rejects.toThrow(/already been removed/);
    await expect(membershipService.removeMember(mgmt, mgmt.membershipId)).rejects.toThrow(/last active Management/);
  });

  it("cancels a pending invite without any checklist, and a removed person can be invited again", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("invitee");
    let token = "";
    const { membershipId } = await membershipService.inviteMember(mgmt, { email, name: "Invitee", roleKey: "SALES" }, (t) => ((token = t), t));

    await membershipService.removeMember(mgmt, membershipId);
    await expect(authService.acceptMembershipInvite(token, "a-fine-password-123")).rejects.toThrow(/Invalid or expired/);

    let fresh = "";
    await membershipService.inviteMember(mgmt, { email, name: "Invitee", roleKey: "SALES" }, (t) => ((fresh = t), t));
    const row = await adminDb.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(row.status).toBe("PENDING");
    expect(row.removedAt).toBeNull();
    expect(row.removedByMembershipId).toBeNull();
    expect(row.invitedByMembershipId).toBe(mgmt.membershipId);
    expect((await authService.acceptMembershipInvite(fresh, "a-fine-password-123")).organizationSlug).toBe(org.slug);
  });

  it("keeps another organisation's records out of reach: reassigning and checklists are tenant-scoped", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const mgmtB = await createTestContext(orgB.id, "MANAGEMENT");
    const a = await member(orgA.id, "SALES");
    const aOther = await member(orgA.id, "SALES");
    const work = await giveWork(orgA.id, a.membership.id, a.membership.id);

    await expect(reassignmentService.getMemberReassignmentChecklist(mgmtB, a.membership.id)).rejects.toThrow(/not found/i);
    await expect(
      reassignmentService.reassignMemberRecords(mgmtB, a.membership.id, { toMembershipId: aOther.membership.id }),
    ).rejects.toThrow(/not found/i);
    await expect(membershipService.removeMember(mgmtB, a.membership.id)).rejects.toThrow(/not found/i);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: work.openLead.id } })).ownerMembershipId).toBe(a.membership.id);

    // Row-level security: B's context cannot even see A's open tasks.
    expect(await withOrgContext(orgB.id, (tx) => tx.task.count({ where: { assigneeMembershipId: a.membership.id } }))).toBe(0);
  });
});

describe("reassignment rules (B1.05)", () => {
  it("refuses a new owner who cannot work the records, and changes nothing", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const leaving = await member(org.id, "SALES");
    const finance = await member(org.id, "FINANCE");
    const work = await giveWork(org.id, leaving.membership.id, leaving.membership.id);

    await expect(
      reassignmentService.reassignMemberRecords(mgmt, leaving.membership.id, { toMembershipId: finance.membership.id }),
    ).rejects.toThrow(ValidationError);
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: work.openTask.id } })).assigneeMembershipId).toBe(leaving.membership.id);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: work.openLead.id } })).ownerMembershipId).toBe(leaving.membership.id);
  });

  it("can move one kind at a time, and refuses itself, strangers, and deactivated members as new owners", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const leaving = await member(org.id, "SALES");
    const taking = await member(org.id, "SALES");
    await giveWork(org.id, leaving.membership.id, leaving.membership.id);

    const part = await reassignmentService.reassignMemberRecords(mgmt, leaving.membership.id, {
      toMembershipId: taking.membership.id,
      kinds: ["tasks", "leads"],
    });
    expect(part.moved).toMatchObject({ tasks: 1, leads: 1, deals: 0, companies: 0 });
    expect(part.remaining.total).toBe(4);

    await expect(
      reassignmentService.reassignMemberRecords(mgmt, leaving.membership.id, { toMembershipId: leaving.membership.id }),
    ).rejects.toThrow(/someone other than/);
    const stranger = await createTestContext((await createTestOrganization()).id, "SALES");
    await expect(
      reassignmentService.reassignMemberRecords(mgmt, leaving.membership.id, { toMembershipId: stranger.membershipId }),
    ).rejects.toThrow(/active member of this organization/);
    await adminDb.membership.update({ where: { id: taking.membership.id }, data: { status: "INACTIVE" } });
    await expect(
      reassignmentService.reassignMemberRecords(mgmt, leaving.membership.id, { toMembershipId: taking.membership.id }),
    ).rejects.toThrow(/active member/);

    const sales = await createTestContext(org.id, "SALES");
    await expect(
      reassignmentService.reassignMemberRecords(sales, leaving.membership.id, { toMembershipId: mgmt.membershipId }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("membership states and invites (B1.12)", () => {
  it("walks invited -> active -> deactivated -> active -> removed with timestamps and who acted", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("states");
    let token = "";
    const { membershipId } = await membershipService.inviteMember(mgmt, { email, name: "State Walker", roleKey: "SALES" }, (t) => ((token = t), t));
    const stateOf = async () => (await membershipService.listMemberships(mgmt)).find((m) => m.membershipId === membershipId)!;

    let row = await stateOf();
    expect(row.state).toBe("invited");
    expect(row.invitedByName).toBe("Test User");
    expect(row.inviteExpired).toBe(false);
    expect(row.inviteExpiresAt).toBeInstanceOf(Date);
    expect(row.inviteLastSentAt).toBeInstanceOf(Date);

    await authService.acceptMembershipInvite(token, "a-fine-password-123");
    row = await stateOf();
    expect(row.state).toBe("active");
    expect(row.joinedAt).toBeInstanceOf(Date);
    expect(row.inviteExpiresAt).toBeNull();

    await membershipService.deactivateMember(mgmt, membershipId);
    row = await stateOf();
    expect(row.state).toBe("deactivated");
    expect(row.deactivatedAt).toBeInstanceOf(Date);
    expect(row.deactivatedByName).toBe("Test User");

    await membershipService.reactivateMember(mgmt, membershipId);
    row = await stateOf();
    expect(row.state).toBe("active");
    expect(row.deactivatedAt).toBeNull();

    await membershipService.removeMember(mgmt, membershipId);
    row = await stateOf();
    expect(row.state).toBe("removed");
    expect(row.removedAt).toBeInstanceOf(Date);
    expect(row.removedByName).toBe("Test User");

    const actions = (
      await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: membershipId }, orderBy: { createdAt: "asc" } })
    ).map((a) => a.action);
    expect(actions).toEqual([
      "membership.invited",
      "membership.invite_accepted",
      "membership.deactivated",
      "membership.reactivated",
      "membership.removed",
    ]);
  });

  it("refuses transitions that make no sense", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await member(org.id, "SALES");
    await expect(membershipService.reactivateMember(mgmt, membership.id)).rejects.toThrow(/inactive/i);
    await expect(membershipService.resendInvite(mgmt, membership.id, (t) => t)).rejects.toThrow(/pending/i);
    await membershipService.deactivateMember(mgmt, membership.id);
    await expect(membershipService.deactivateMember(mgmt, membership.id)).rejects.toThrow(/active member/i);
    // A deactivated member comes back by reactivation, not by a fresh invite.
    const { user } = await adminDb.membership.findUniqueOrThrow({ where: { id: membership.id }, include: { user: true } });
    await expect(
      membershipService.inviteMember(mgmt, { email: user.email, name: user.name, roleKey: "SALES" }, (t) => t),
    ).rejects.toThrow(/reactivate/);
  });

  it("invite tokens are single-use", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    let token = "";
    await membershipService.inviteMember(mgmt, { email: uniqueEmail("once"), name: "Once", roleKey: "SALES" }, (t) => ((token = t), t));
    await authService.acceptMembershipInvite(token, "a-fine-password-123");
    await expect(authService.acceptMembershipInvite(token, "a-fine-password-123")).rejects.toThrow(/Invalid or expired/);
    await expect(authService.getInviteInfo(token)).rejects.toThrow(/Invalid or expired/);
  });

  it("invite tokens expire after seven days: the holder is told it expired, and an admin can resend", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("late");
    let token = "";
    const { membershipId } = await membershipService.inviteMember(mgmt, { email, name: "Late", roleKey: "SALES" }, (t) => ((token = t), t));
    const row = await adminDb.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(row.inviteTokenExpiresAt!.getTime() - row.inviteLastSentAt!.getTime()).toBeGreaterThan(7 * 24 * 3600_000 - 5000);
    expect(row.inviteTokenExpiresAt!.getTime() - row.inviteLastSentAt!.getTime()).toBeLessThanOrEqual(7 * 24 * 3600_000);

    // Still good just before the end...
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(row.inviteTokenExpiresAt!.getTime() - 1000));
    expect((await authService.getInviteInfo(token)).email).toBe(email);
    expect((await getAccessState((await adminDb.user.findUniqueOrThrow({ where: { email } })).id)).pendingInvites[0]!.expired).toBe(false);

    // ...and refused, with a clear reason, just after.
    vi.setSystemTime(new Date(row.inviteTokenExpiresAt!.getTime() + 1000));
    const err = await authService.acceptMembershipInvite(token, "a-fine-password-123").catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/has expired/);
    expect(err.issues[0].path).toBe("token");
    await expect(authService.getInviteInfo(token)).rejects.toThrow(/has expired/);
    expect((await membershipService.listMemberships(mgmt)).find((m) => m.membershipId === membershipId)!.inviteExpired).toBe(true);
    expect((await adminDb.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe("PENDING");

    // Resending gives a working link and kills the old one.
    process.env.INVITE_RESEND_COOLDOWN_MS = "0";
    let newer = "";
    await membershipService.resendInvite(mgmt, membershipId, (t) => ((newer = t), t));
    await expect(authService.acceptMembershipInvite(token, "a-fine-password-123")).rejects.toThrow(/Invalid or expired/);
    expect((await authService.acceptMembershipInvite(newer, "a-fine-password-123")).organizationSlug).toBe(org.slug);
  });

  it("limits how often an invite can be sent again, by the same rule for Management and the platform console", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    let token = "";
    const { membershipId } = await membershipService.inviteMember(mgmt, { email: uniqueEmail("brake"), name: "Brake", roleKey: "SALES" }, (t) => ((token = t), t));

    await expect(membershipService.resendInvite(mgmt, membershipId, (t) => t)).rejects.toThrow(RateLimitedError);
    expect(await authService.getInviteInfo(token)).toBeTruthy(); // the refused resend did not burn the old link

    const row = await adminDb.membership.findUniqueOrThrow({ where: { id: membershipId } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(row.inviteLastSentAt!.getTime() + 61_000));
    const operator = await createTestUser("operator");
    let fromConsole = "";
    const sent = await membershipService.resendAdminInvite(org.id, membershipId, { userId: operator.id }, (t) => ((fromConsole = t), t));
    expect(sent.membershipId).toBe(membershipId);
    expect(fromConsole).not.toBe(token);
    const audit = await adminDb.auditEvent.findFirstOrThrow({
      where: { organizationId: org.id, entityId: membershipId, action: "membership.reinvited" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actorUserId).toBe(operator.id);
    expect(audit.actorMembershipId).toBeNull();

    // Not someone else's membership, and not a member who has already joined.
    await expect(
      membershipService.resendAdminInvite((await createTestOrganization()).id, membershipId, { userId: operator.id }, (t) => t),
    ).rejects.toThrow(/not found/i);
    const { membership: joined } = await createTestMembership(org.id, "SALES");
    await expect(membershipService.resendAdminInvite(org.id, joined.id, { userId: operator.id }, (t) => t)).rejects.toThrow(/pending/i);
  });

  it("accepting an invite for an existing account links the membership without touching their password", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const mgmtB = await createTestContext(orgB.id, "MANAGEMENT");
    const { user } = await member(orgA.id, "SALES");
    const before = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });

    let token = "";
    const { membershipId } = await membershipService.inviteMember(mgmtB, { email: user.email, name: user.name, roleKey: "DELIVERY" }, (t) => ((token = t), t));
    expect((await authService.getInviteInfo(token)).requiresPassword).toBe(false);
    const accepted = await authService.acceptMembershipInvite(token, undefined, UA, uniqueIp(), "Nairobi, KE");
    expect(accepted.userId).toBe(user.id);
    expect(accepted.organizationSlug).toBe(orgB.slug);

    const after = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect((await adminDb.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe("ACTIVE");
    expect((await adminDb.membership.count({ where: { userId: user.id, status: "ACTIVE" } }))).toBe(2);
    // The accept signed them in under the inviting organisation, and logged it for that organisation.
    const session = await lookupSession(accepted.token);
    if (session.state !== "active") throw new Error("expected active");
    expect(session.session.organizationId).toBe(orgB.id);
    const events = await signInEvents.listSignInEvents(mgmtB, { membershipId });
    expect(events.items.map((e) => `${e.outcome}:${e.reason}`)).toEqual(["SUCCESS:INVITE_ACCEPTED"]);
    expect(events.items[0]!.place).toBe("Nairobi, KE");
  });
});

describe("access state: awaiting access (B1.12)", () => {
  it("reports awaiting access for an account with no membership, an unaccepted invite, or only a removed one", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");

    const fresh = await createTestUser("fresh");
    expect(await getAccessState(fresh.id)).toEqual({
      state: "awaitingAccess",
      awaitingAccess: true,
      reason: "NO_MEMBERSHIP",
      organizations: [],
      pendingInvites: [],
    });

    const email = uniqueEmail("pendingstate");
    await membershipService.inviteMember(mgmt, { email, name: "Pending", roleKey: "SALES" }, (t) => t);
    const invited = await adminDb.user.findUniqueOrThrow({ where: { email } });
    const state = await getAccessState(invited.id);
    expect(state).toMatchObject({ state: "awaitingAccess", reason: "INVITE_PENDING" });
    expect(state.pendingInvites).toEqual([
      { organizationName: org.name, expiresAt: expect.any(String), expired: false },
    ]);
  });

  it("is 'active' with the organisations once they have access, and 'deactivated' only when nothing active remains", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { user, membership } = await member(orgA.id, "SALES");
    const active = await getAccessState(user.id);
    expect(active).toMatchObject({ state: "active", awaitingAccess: false, reason: null });
    expect(active.organizations).toEqual([
      { id: orgA.id, slug: orgA.slug, name: orgA.name, membershipId: membership.id },
    ]);

    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    const other = await adminDb.membership.create({
      data: { organizationId: orgB.id, userId: user.id, roleId: role.id, joinedAt: new Date() },
    });
    await adminDb.membership.update({ where: { id: membership.id }, data: { status: "INACTIVE" } });
    expect((await getAccessState(user.id)).state).toBe("active");
    await adminDb.membership.update({ where: { id: other.id }, data: { status: "INACTIVE" } });
    expect((await getAccessState(user.id)).state).toBe("deactivated");
  });
});
