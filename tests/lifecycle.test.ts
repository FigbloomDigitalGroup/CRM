import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { updateReportSettings } from "../src/services/customerReportService";
import * as dealService from "../src/services/dealService";
import { listHandoffs, takeHandoff, updateHandoff } from "../src/services/handoffService";
import * as leadService from "../src/services/leadService";
import {
  LIFECYCLE_KEYS,
  deriveSweepTarget,
  getLifecycle,
  releaseLifecycleOverride,
  runLifecycleSweep,
  setLifecycleStateManually,
  transitionCompany,
} from "../src/services/lifecycleService";
import { createRecurringService } from "../src/services/recurringServiceService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, day, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function stateKey(companyId: string) {
  const c = await adminDb.company.findUniqueOrThrow({ where: { id: companyId }, include: { lifecycleState: true } });
  return c.lifecycleState?.key ?? null;
}

describe("what the daily job wants (pure rules, fixed clock)", () => {
  const facts = { lastActivity: daysFrom(NOW, -10), createdAt: daysFrom(NOW, -400), dormancyDays: 90, renewalAttention: false, now: NOW };

  it("leaves prospects and onboarding customers to the events that move them", () => {
    expect(deriveSweepTarget({ ...facts, currentKey: "PROSPECT", lastActivity: daysFrom(NOW, -500) })).toBeNull();
    expect(deriveSweepTarget({ ...facts, currentKey: "ONBOARDING", lastActivity: daysFrom(NOW, -500) })).toBeNull();
  });

  it("makes a quiet customer dormant only beyond the threshold", () => {
    expect(deriveSweepTarget({ ...facts, currentKey: "ACTIVE_CUSTOMER", lastActivity: daysFrom(NOW, -90) })).toBeNull();
    expect(deriveSweepTarget({ ...facts, currentKey: "ACTIVE_CUSTOMER", lastActivity: daysFrom(NOW, -91) })).toEqual({ toKey: "DORMANT_CUSTOMER", reason: "DORMANT" });
    expect(deriveSweepTarget({ ...facts, currentKey: "CUSTOMER", lastActivity: null, createdAt: daysFrom(NOW, -200) })).toEqual({ toKey: "DORMANT_CUSTOMER", reason: "DORMANT" });
    expect(deriveSweepTarget({ ...facts, currentKey: "DORMANT_CUSTOMER", lastActivity: daysFrom(NOW, -200) })).toBeNull();
  });

  it("brings a dormant customer back when activity returns, and a renewing one back when the renewal is done", () => {
    expect(deriveSweepTarget({ ...facts, currentKey: "DORMANT_CUSTOMER", lastActivity: daysFrom(NOW, -3) })).toEqual({ toKey: "ACTIVE_CUSTOMER", reason: "REACTIVATED" });
    expect(deriveSweepTarget({ ...facts, currentKey: "RENEWAL" })).toEqual({ toKey: "ACTIVE_CUSTOMER", reason: "RENEWAL_DONE" });
  });

  it("puts a customer with a renewal due or lapsed into Renewal, ahead of Dormant", () => {
    expect(deriveSweepTarget({ ...facts, currentKey: "ACTIVE_CUSTOMER", renewalAttention: true })).toEqual({ toKey: "RENEWAL", reason: "RENEWAL_WINDOW" });
    expect(deriveSweepTarget({ ...facts, currentKey: "ACTIVE_CUSTOMER", renewalAttention: true, lastActivity: daysFrom(NOW, -400) })).toEqual({ toKey: "RENEWAL", reason: "RENEWAL_WINDOW" });
    expect(deriveSweepTarget({ ...facts, currentKey: "DORMANT_CUSTOMER", renewalAttention: true })).toEqual({ toKey: "RENEWAL", reason: "RENEWAL_WINDOW" });
    expect(deriveSweepTarget({ ...facts, currentKey: "RENEWAL", renewalAttention: true })).toBeNull();
  });
});

describe("transitions", () => {
  it("are idempotent: the same move twice writes one history row and one audit event", async () => {
    const org = await createTestOrganization("LifecycleIdem");
    const company = await createCompanyRow(org.id, { lifecycleKey: "PROSPECT" });
    const first = await transitionCompany({ organizationId: org.id, companyId: company.id, toKey: "CUSTOMER", reason: "DEAL_WON", now: NOW });
    const second = await transitionCompany({ organizationId: org.id, companyId: company.id, toKey: "CUSTOMER", reason: "DEAL_WON", now: NOW });
    expect(first.changed).toBe(true);
    expect(second).toEqual({ changed: false, reason: "ALREADY_IN_STATE" });
    expect(await adminDb.lifecycleEvent.count({ where: { organizationId: org.id, companyId: company.id } })).toBe(1);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, entityId: company.id, action: "company.lifecycle_state_changed" } })).toBe(1);
    expect(await transitionCompany({ organizationId: org.id, companyId: company.id, toKey: "NOT_A_STATE", reason: "MANUAL" })).toEqual({ changed: false, reason: "STATE_MISSING" });
    expect(await transitionCompany({ organizationId: org.id, companyId: "missing", toKey: "CUSTOMER", reason: "MANUAL" })).toEqual({ changed: false, reason: "COMPANY_MISSING" });
  });

  it("two moves at once leave one event and a consistent state", async () => {
    const org = await createTestOrganization("LifecycleRace");
    const company = await createCompanyRow(org.id, { lifecycleKey: "CUSTOMER" });
    const results = await Promise.all([
      transitionCompany({ organizationId: org.id, companyId: company.id, toKey: "ACTIVE_CUSTOMER", reason: "HANDOFF_DELIVERED" }),
      transitionCompany({ organizationId: org.id, companyId: company.id, toKey: "ACTIVE_CUSTOMER", reason: "HANDOFF_DELIVERED" }),
    ]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await adminDb.lifecycleEvent.count({ where: { organizationId: org.id, companyId: company.id } })).toBe(1);
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");
  });

  it("follow the real events: converted lead is a Prospect, won deal a Customer, taken handoff Onboarding, delivered Active", async () => {
    const org = await createTestOrganization("LifecycleEvents");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const company = await createCompanyRow(org.id, { name: "Flow Ltd", ownerMembershipId: sales.membershipId });
    expect(await stateKey(company.id)).toBeNull();

    const lead = (await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id), companyId: company.id })).lead;
    const deal = (await leadService.convertLead(sales, lead.id, { serviceId: await getServiceId(org.id, "CCTV") })) as unknown as { id: string };
    expect(await stateKey(company.id)).toBe("PROSPECT");

    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true } } as never);
    expect(await stateKey(company.id)).toBe("CUSTOMER");

    await takeHandoff(delivery, deal.id);
    expect(await stateKey(company.id)).toBe("ONBOARDING");

    await updateHandoff(delivery, deal.id, { status: "DELIVERED" });
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");

    await updateHandoff(management, deal.id, { status: "ONBOARDING" });
    expect(await stateKey(company.id)).toBe("ONBOARDING");

    const history = await getLifecycle(management, company.id);
    expect(history.events.map((e) => `${e.from?.key ?? "-"}>${e.to?.key}:${e.reason}`).reverse()).toEqual([
      "->PROSPECT:LEAD_CONVERTED",
      "PROSPECT>CUSTOMER:DEAL_WON",
      "CUSTOMER>ONBOARDING:DEAL_WON",
      "ONBOARDING>ACTIVE_CUSTOMER:HANDOFF_DELIVERED",
      "ACTIVE_CUSTOMER>ONBOARDING:DEAL_WON",
    ]);
    expect(history.state?.key).toBe("ONBOARDING");
    const audited = await adminDb.auditEvent.count({ where: { organizationId: org.id, entityId: company.id, action: "company.lifecycle_state_changed" } });
    expect(audited).toBe(5);
    expect((await listHandoffs(delivery, { status: "ONBOARDING" } as never)).total).toBe(1);
  });

  it("a converted lead does not turn an existing customer back into a Prospect", async () => {
    const org = await createTestOrganization("LifecycleKeep");
    const sales = await createTestContext(org.id, "SALES");
    const company = await createCompanyRow(org.id, { lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId });
    const lead = (await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id), companyId: company.id })).lead;
    await leadService.convertLead(sales, lead.id, {});
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");
  });
});

describe("the daily job", () => {
  async function setup() {
    const org = await createTestOrganization("LifecycleSweep");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    return { org, management, sales };
  }
  const touch = (organizationId: string, companyId: string, membershipId: string, at: Date) =>
    adminDb.activity.create({ data: { organizationId, companyId, authorMembershipId: membershipId, type: "NOTE", subject: "Touch", occurredAt: at } });

  it("makes quiet customers dormant, leaves active ones alone, and reports who went dormant", async () => {
    const { org, sales } = await setup();
    const old = daysFrom(NOW, -400);
    const quiet = await createCompanyRow(org.id, { name: "Quiet", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: old });
    const lively = await createCompanyRow(org.id, { name: "Lively", lifecycleKey: "ACTIVE_CUSTOMER", createdAt: old });
    await touch(org.id, lively.id, sales.membershipId, daysFrom(NOW, -5));
    const viaContact = await createCompanyRow(org.id, { name: "ViaContact", lifecycleKey: "ACTIVE_CUSTOMER", createdAt: old });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Amina", companyId: viaContact.id } });
    await adminDb.activity.create({ data: { organizationId: org.id, contactId: contact.id, authorMembershipId: sales.membershipId, type: "CALL", occurredAt: daysFrom(NOW, -2) } });
    const withDeal = await createCompanyRow(org.id, { name: "WithDeal", lifecycleKey: "CUSTOMER", createdAt: old });
    await createWonDeal(org.id, sales, { companyId: withDeal.id, wonAt: daysFrom(NOW, -20) });
    const prospect = await createCompanyRow(org.id, { name: "Prospect", lifecycleKey: "PROSPECT", createdAt: old });
    const archived = await createCompanyRow(org.id, { name: "Archived", lifecycleKey: "ACTIVE_CUSTOMER", createdAt: old });
    await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    const result = await runLifecycleSweep(org.id, NOW);
    expect(result).toMatchObject({ checked: 4, toDormant: 1, toRenewal: 0, toActive: 0 });
    expect(result.becameDormant).toEqual([expect.objectContaining({ companyId: quiet.id, ownerMembershipId: sales.membershipId, quietDays: 400 })]);
    expect(await stateKey(quiet.id)).toBe("DORMANT_CUSTOMER");
    for (const c of [lively, viaContact, withDeal]) expect(await stateKey(c.id)).not.toBe("DORMANT_CUSTOMER");
    expect(await stateKey(prospect.id)).toBe("PROSPECT");
    expect(await stateKey(archived.id)).toBe("ACTIVE_CUSTOMER");

    // Run again: nothing changes, nothing new is written.
    const again = await runLifecycleSweep(org.id, NOW);
    expect(again).toMatchObject({ toDormant: 0, toRenewal: 0, toActive: 0, becameDormant: [] });
    expect(await adminDb.lifecycleEvent.count({ where: { organizationId: org.id } })).toBe(1);
    const event = await adminDb.lifecycleEvent.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(event).toMatchObject({ reason: "DORMANT", companyId: quiet.id });
    expect(event.detail).toMatchObject({ dormancyDays: 90, quietDays: 400 });
  });

  it("recomputes when the dormancy threshold changes, in both directions, and brings a company back when activity returns", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Threshold", lifecycleKey: "ACTIVE_CUSTOMER", createdAt: daysFrom(NOW, -300) });
    await touch(org.id, company.id, sales.membershipId, daysFrom(NOW, -100));

    expect((await runLifecycleSweep(org.id, NOW)).toDormant).toBe(1); // 100 days > the default 90
    expect(await stateKey(company.id)).toBe("DORMANT_CUSTOMER");

    await updateReportSettings(management, { dormancyDays: 180 });
    expect((await runLifecycleSweep(org.id, NOW)).toActive).toBe(1); // 100 days is inside 180: back to active
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");

    await updateReportSettings(management, { dormancyDays: 60 });
    expect((await runLifecycleSweep(org.id, NOW)).toDormant).toBe(1);

    await touch(org.id, company.id, sales.membershipId, daysFrom(NOW, -1));
    expect((await runLifecycleSweep(org.id, NOW)).toActive).toBe(1);
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");
    const reasons = (await adminDb.lifecycleEvent.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } })).map((e) => e.reason);
    expect(reasons).toEqual(["DORMANT", "REACTIVATED", "DORMANT", "REACTIVATED"]);
  });

  it("moves a customer with a renewal due or lapsed into Renewal, and back once it is renewed", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Renewing", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId });
    await touch(org.id, company.id, sales.membershipId, daysFrom(NOW, -2));
    const service = await createRecurringService(management, { companyId: company.id, serviceId: await getServiceId(org.id, "CRM"), startsOn: "2025-12-01", renewsOn: "2026-11-25" }, NOW);

    expect((await runLifecycleSweep(org.id, NOW)).toRenewal).toBe(1);
    expect(await stateKey(company.id)).toBe("RENEWAL");

    await adminDb.recurringService.update({ where: { id: service.id }, data: { renewsOn: day("2027-11-25") } });
    expect((await runLifecycleSweep(org.id, NOW)).toActive).toBe(1);
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");

    // A cancelled service needs no renewal.
    await adminDb.recurringService.update({ where: { id: service.id }, data: { renewsOn: day("2026-11-20"), cancelledAt: NOW, cancelReason: "gone" } });
    expect((await runLifecycleSweep(org.id, NOW)).toRenewal).toBe(0);
  });

  it("leaves a company a person set by hand alone until the override is released", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Hand", lifecycleKey: "ACTIVE_CUSTOMER", createdAt: daysFrom(NOW, -400) });
    const dormantState = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: org.id, key: "DORMANT_CUSTOMER" } });
    const activeState = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: org.id, key: "ACTIVE_CUSTOMER" } });

    await expect(setLifecycleStateManually(sales, company.id, { stateId: activeState.id, reason: " " }, NOW)).rejects.toBeInstanceOf(ValidationError);
    await expect(setLifecycleStateManually(sales, company.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    await expect(setLifecycleStateManually(sales, company.id, { stateId: "no-such-state", reason: "x" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    // Setting the state it already has still marks it as hand-set.
    const held = await setLifecycleStateManually(sales, company.id, { stateId: activeState.id, reason: "They told us they are very much alive" }, NOW);
    expect(held.manual).toBe(true);

    expect((await runLifecycleSweep(org.id, NOW)).checked).toBe(0);
    expect(await stateKey(company.id)).toBe("ACTIVE_CUSTOMER");

    await releaseLifecycleOverride(management, company.id);
    expect((await runLifecycleSweep(org.id, NOW)).toDormant).toBe(1);
    expect(await stateKey(company.id)).toBe("DORMANT_CUSTOMER");

    // A hand-set move is recorded with who and why, and a real event (a deal won) still moves it.
    const moved = await setLifecycleStateManually(management, company.id, { stateId: activeState.id, reason: "Back from a pause" }, new Date(NOW.getTime() + 60_000));
    expect(moved.events[0]).toMatchObject({ reason: "MANUAL", note: "Back from a pause", actorMembershipId: management.membershipId });
    expect(moved.manual).toBe(true);
    const won = await transitionCompany({ organizationId: org.id, companyId: company.id, toStateId: dormantState.id, reason: "DEAL_WON", now: NOW });
    expect(won.changed).toBe(true);
  });

  it("only people who can edit companies may set the state by hand, and only their own organisation's companies", async () => {
    const a = await setup();
    const b = await setup();
    const delivery = await createTestContext(a.org.id, "DELIVERY");
    const company = await createCompanyRow(a.org.id, { lifecycleKey: "CUSTOMER" });
    const state = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: a.org.id, key: "RENEWAL" } });
    await expect(setLifecycleStateManually(delivery, company.id, { stateId: state.id, reason: "x" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(releaseLifecycleOverride(delivery, company.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setLifecycleStateManually(b.management, company.id, { stateId: state.id, reason: "x" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getLifecycle(b.management, company.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLifecycle(delivery, company.id)).state?.key).toBe("CUSTOMER");
  });

  it("keeps its history inside the organisation", async () => {
    const a = await setup();
    const b = await setup();
    const company = await createCompanyRow(a.org.id, { lifecycleKey: "PROSPECT" });
    await transitionCompany({ organizationId: a.org.id, companyId: company.id, toKey: LIFECYCLE_KEYS.CUSTOMER, reason: "DEAL_WON" });
    expect(await withOrgContext(b.org.id, (tx) => tx.lifecycleEvent.findMany({ where: { companyId: company.id } }))).toEqual([]);
    const toState = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: a.org.id, key: "CUSTOMER" } });
    await expect(
      withOrgContext(b.org.id, (tx) => tx.lifecycleEvent.create({ data: { organizationId: a.org.id, companyId: company.id, toStateId: toState.id, reason: "MANUAL" } })),
    ).rejects.toThrow();
    // A transition cannot point at another organisation's state either.
    const foreignState = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: b.org.id, key: "CUSTOMER" } });
    await expect(transitionCompany({ organizationId: a.org.id, companyId: company.id, toStateId: foreignState.id, reason: "MANUAL" })).resolves.toEqual({ changed: false, reason: "STATE_MISSING" });
  });
});
