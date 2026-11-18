import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { canViewTeamPage } from "../src/auth/teamAccess";
import { recordAuditEvent } from "../src/repositories/auditEvents";
import { createCompany } from "../src/services/companyService";
import { createDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import { createTask } from "../src/services/taskService";
import { getTeamAttention, getTeamMember, getTeamSummary, listTeamMembers } from "../src/services/teamService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

/**
 * The Team page API (P2-15, FIG-1598): correct numbers for known data, Management only with the explained refusal, masking of deal values,
 * no payment data, sales-object activity only, and tenant isolation.
 */

const DAY = 24 * 60 * 60_000;
const SENTINEL = 7654321;

async function setup() {
  const org = await createTestOrganization("Team");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const salesA = await createTestContext(org.id, "SALES", "a");
  const salesB = await createTestContext(org.id, "SALES", "b");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const statusId = await getLeadStatusId(org.id);
  const stageId = await getPipelineStageId(org.id);
  const { company } = await createCompany(management, { name: "Team Co" });

  // A has 3 open leads (one quiet for 60 days), 2 open deals (one stuck, one valued), 1 overdue and 1 upcoming task.
  await createLead(salesA, { leadStatusId: statusId, temperature: "HOT" });
  await createLead(salesA, { leadStatusId: statusId });
  const quiet = (await createLead(salesA, { leadStatusId: statusId })).lead;
  await adminDb.lead.update({ where: { id: quiet.id }, data: { createdAt: new Date(Date.now() - 60 * DAY) } });
  await createLead(salesB, { leadStatusId: statusId });
  await createLead(management, { leadStatusId: statusId }); // owned by Management
  const pool = (await createLead(salesA, { leadStatusId: statusId })).lead;
  await adminDb.lead.update({ where: { id: pool.id }, data: { ownerMembershipId: null } });
  const valued = await createDeal(salesA, { companyId: company.id, pipelineStageId: stageId, value: SENTINEL } as never);
  const stuck = await createDeal(salesA, { companyId: company.id, pipelineStageId: stageId });
  await adminDb.deal.update({ where: { id: stuck.id }, data: { lastActivityAt: new Date(Date.now() - 300 * DAY) } });
  await createTask(salesA, { title: "Late call", dueAt: new Date(Date.now() - 2 * DAY).toISOString() });
  await createTask(salesA, { title: "Later", dueAt: new Date(Date.now() + 5 * DAY).toISOString() });
  return { org, management, salesA, salesB, delivery, finance, technical, statusId, stageId, company, valued, stuck };
}

const without = (ctx: AuthContext, ...keys: string[]): AuthContext => ({ ...ctx, permissionKeys: ctx.permissionKeys.filter((k) => !keys.includes(k)) });

describe("Team page API (P2-15)", () => {
  it("the one access function is Management only today", async () => {
    const { management, salesA, delivery, finance, technical } = await setup();
    expect(canViewTeamPage(management.permissionKeys)).toBe(true);
    for (const ctx of [salesA, delivery, finance, technical]) expect(canViewTeamPage(ctx.permissionKeys)).toBe(false);
  });

  it("every other role is refused with the explained 403 on every endpoint", async () => {
    const { salesA, delivery, finance, technical, salesB } = await setup();
    for (const ctx of [salesA, delivery, finance, technical]) {
      for (const call of [
        () => getTeamSummary(ctx, {}),
        () => listTeamMembers(ctx, {}),
        () => getTeamMember(ctx, salesB.membershipId, {}),
        () => getTeamAttention(ctx),
      ]) {
        const error = await call().then(() => null, (e: unknown) => e);
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).detail).toMatchObject({ roleKey: ctx.roleKey, organizationId: ctx.organizationId });
      }
    }
  });

  it("the summary and the member rows match the seeded data", async () => {
    const { management, salesA } = await setup();
    const s = await getTeamSummary(management, { range: "7d" });
    expect(s.summary.openLeads).toBe(5); // A 3, B 1, Management 1; the pooled lead is unassigned
    expect(s.summary.unassignedLeads).toBe(1);
    expect(s.summary.openDeals).toBe(2);
    expect(s.summary.overdueTasks).toBe(1);
    expect(s.summary.newLeads).toBe(5); // six leads exist, one was made 60 days ago
    expect(s.summary.openDealsValue).toEqual({ amount: String(SENTINEL), masked: false });
    expect(s.summary.membersTotal).toBe(6);
    expect(s.workload.find((w) => w.membershipId === salesA.membershipId)?.openLeads).toBe(3);

    const list = await listTeamMembers(management, {});
    expect(list.total).toBe(6);
    const a = list.items.find((m) => m.membershipId === salesA.membershipId)!;
    expect(a).toMatchObject({ openLeads: 3, openDeals: 2, overdueTasks: 1, newLeads: 2, stuckDeals: 1, status: "ACTIVE" });
    expect(a.role.key).toBe("SALES");
    expect(list.roles.map((r) => r.key)).toContain("MANAGEMENT");
  });

  it("the date range changes the range numbers consistently, not the open counts", async () => {
    const { management } = await setup();
    const thirty = await getTeamSummary(management, { range: "30d" });
    const today = await getTeamSummary(management, { range: "today" });
    expect(thirty.summary.newLeads).toBe(5); // the 60-day-old lead is outside both
    expect(today.summary.newLeads).toBe(5);
    expect(today.summary.openLeads).toBe(thirty.summary.openLeads);
    expect(new Date(today.rangeStart).getTime()).toBeGreaterThan(new Date(thirty.rangeStart).getTime());
  });

  it("filters by role, status and name, sorts, and pages", async () => {
    const { management, salesA } = await setup();
    expect((await listTeamMembers(management, { role: "SALES" })).items.map((m) => m.role.key)).toEqual(["SALES", "SALES"]);
    expect((await listTeamMembers(management, { status: "PENDING" })).total).toBe(0);
    const byName = await listTeamMembers(management, { q: "a." });
    expect(byName.items.some((m) => m.membershipId === salesA.membershipId)).toBe(true);
    const sorted = await listTeamMembers(management, { sort: "-openLeads" });
    expect(sorted.items[0]!.membershipId).toBe(salesA.membershipId);
    const paged = await listTeamMembers(management, { sort: "name" }, { page: 2, pageSize: 4 });
    expect(paged.items).toHaveLength(2);
    expect(paged.total).toBe(6);
    // A hostile sort or filter is ignored or matched literally, never executed.
    await expect(listTeamMembers(management, { sort: "name; DROP TABLE leads", q: "%' OR 1=1 --" })).resolves.toMatchObject({ total: 0 });
  });

  it("member detail carries the person's open work and a 30-day trend, and an unknown member is not found", async () => {
    const { management, salesA, valued } = await setup();
    await recordAuditEvent({ organizationId: management.organizationId, actorMembershipId: salesA.membershipId, action: "deal.updated", entityType: "Deal", entityId: valued.id });
    const d = await getTeamMember(management, salesA.membershipId, {});
    expect(d.member.membershipId).toBe(salesA.membershipId);
    expect(d.openLeads).toHaveLength(3);
    expect(d.openLeads!.filter((l) => l.stale)).toHaveLength(1);
    expect(d.openDeals).toHaveLength(2);
    expect(d.tasks).toHaveLength(2);
    expect(d.tasks!.filter((t) => t.overdue)).toHaveLength(1);
    expect(d.trend).toHaveLength(30);
    expect(d.recentActivity.some((e) => e.action === "deal.updated" && e.path === `/deals/${valued.id}`)).toBe(true);
    expect(d.member.lastActiveAt).not.toBeNull();
    await expect(getTeamMember(management, "00000000-0000-0000-0000-000000000000", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deal values are hidden for a viewer without the permission, in every answer", async () => {
    const { management, salesA } = await setup();
    const blind = without(management, "deals.view.value");
    const answers = [await getTeamSummary(blind, {}), await listTeamMembers(blind, {}), await getTeamMember(blind, salesA.membershipId, {}), await getTeamAttention(blind)];
    expect(JSON.stringify(answers)).not.toMatch(/7[,\s]?654[,\s]?321/);
    expect(answers[0]).toMatchObject({ summary: { openDealsValue: { amount: null, masked: true } } });
    // The same answers do carry it for Management.
    expect(JSON.stringify(await getTeamSummary(management, {}))).toMatch(/7654321/);
  });

  it("a section the viewer's role cannot read is null, not zero", async () => {
    const { management } = await setup();
    const noDeals = without(management, "deals.view.all");
    const s = await getTeamSummary(noDeals, {});
    expect(s.summary.openDeals).toBeNull();
    expect(s.summary.dealsWon.count).toBeNull();
    expect(s.summary.openLeads).not.toBeNull();
    expect((await getTeamAttention(noDeals)).stuckDeals).toBeNull();
  });

  it("needs attention lists the quiet lead, the overdue task and the stuck deal", async () => {
    const { management, salesA, stuck } = await setup();
    const a = await getTeamAttention(management);
    expect(a.staleLeads!.total).toBe(1);
    expect(a.staleLeads!.items[0]!.ownerMembershipId).toBe(salesA.membershipId);
    expect(a.overdueTasks!.total).toBe(1);
    expect(a.stuckDeals!.items[0]).toMatchObject({ id: stuck.id, ownerName: expect.any(String) });
  });

  it("activity is sales work only: payment and settings events never appear, and no snapshot is carried", async () => {
    const { management, salesA } = await setup();
    const org = management.organizationId;
    await recordAuditEvent({ organizationId: org, actorMembershipId: salesA.membershipId, action: "payment.recorded", entityType: "PaymentRecord", entityId: "p-1", newValue: { amount: 8123456 } });
    await recordAuditEvent({ organizationId: org, actorMembershipId: salesA.membershipId, action: "membership.role_changed", entityType: "Membership", entityId: "m-1" });
    await recordAuditEvent({ organizationId: org, actorMembershipId: salesA.membershipId, action: "lead.updated", entityType: "Lead", entityId: "l-1", newValue: { value: SENTINEL } });
    const d = await getTeamMember(management, salesA.membershipId, {});
    expect(d.recentActivity.map((e) => e.entityType).sort()).toEqual(["Lead"]);
    expect(JSON.stringify(d.recentActivity)).not.toMatch(/8[,\s]?123[,\s]?456|7[,\s]?654[,\s]?321/);
    expect(JSON.stringify(d)).not.toMatch(/8[,\s]?123[,\s]?456/);
    expect(Object.keys(d.recentActivity[0]!).sort()).toEqual(["action", "at", "entityId", "entityType", "id", "label", "path"]);
  });

  it("another organisation sees none of it (tenant isolation)", async () => {
    const { salesA, valued } = await setup();
    const other = await createTestOrganization("TeamOther");
    const otherMgmt = await createTestContext(other.id, "MANAGEMENT");
    const list = await listTeamMembers(otherMgmt, {});
    expect(list.items.map((m) => m.membershipId)).toEqual([otherMgmt.membershipId]);
    expect(list.items[0]).toMatchObject({ openLeads: 0, openDeals: 0 });
    const s = await getTeamSummary(otherMgmt, {});
    expect(s.summary).toMatchObject({ openLeads: 0, openDeals: 0, overdueTasks: 0, unassignedLeads: 0 });
    await expect(getTeamMember(otherMgmt, salesA.membershipId, {})).rejects.toBeInstanceOf(NotFoundError);
    const attention = await getTeamAttention(otherMgmt);
    expect(JSON.stringify(attention)).not.toContain(valued.id);
    expect(attention.staleLeads!.total + attention.overdueTasks!.total + attention.stuckDeals!.total).toBe(0);
  });
});
