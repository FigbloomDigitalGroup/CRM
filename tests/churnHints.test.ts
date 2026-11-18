import { describe, expect, it } from "vitest";
import { FeatureUnavailableError } from "../src/lib/featureFlags";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { TOGGLES_KEY } from "../src/lib/featureConfig";
import { evaluateCustomer, levelFor, signalsHash, viewForViewer, type CustomerFacts } from "../src/lib/churnSignals";
import { DEFAULT_RENEWAL_SETTINGS } from "../src/lib/renewals";
import { getJobDefinition } from "../src/jobs/registry";
import "../src/jobs/definitions";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { CONFIG_KEY } from "../src/services/assistantService";
import { dismissChurnHint, listChurnHints, rateChurnHint, refreshChurnHints, refreshChurnHintsNow } from "../src/services/churnHintService";
import * as dealService from "../src/services/dealService";
import { setOrganizationRelease } from "../src/services/featureService";
import { createRole } from "../src/services/roleEditorService";
import { createTestContext, createTestMembership, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

/**
 * FIG-1190 (B7.08): churn hints from the assistant. The rules (pure), the switches, explanations on every hint, masking by role and by
 * reason, dismiss and feedback, that a hint never acts, and tenant isolation.
 */

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-20T09:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);
const SENTINEL_VALUE = 4_242_424;

const baseFacts = (over: Partial<CustomerFacts> = {}): CustomerFacts => ({
  createdAt: ago(400),
  lastActivityAt: ago(3),
  activitiesLast30: 4,
  activitiesPrior30: 4,
  dormant: false,
  services: [],
  ...over,
});
const keysOf = (facts: CustomerFacts) => evaluateCustomer(facts, NOW, DEFAULT_RENEWAL_SETTINGS).map((r) => r.signal);

describe("the rules (pure)", () => {
  it("says nothing about a healthy customer or a brand-new one", () => {
    expect(keysOf(baseFacts())).toEqual([]);
    expect(keysOf(baseFacts({ createdAt: ago(5), lastActivityAt: null, activitiesLast30: 0, activitiesPrior30: 0 }))).toEqual([]);
  });

  it("reads quiet time, a drop in activity, and dormancy", () => {
    expect(keysOf(baseFacts({ lastActivityAt: ago(70), activitiesLast30: 0, activitiesPrior30: 0 }))).toEqual(["no_contact_60"]);
    expect(keysOf(baseFacts({ lastActivityAt: ago(40), activitiesLast30: 0, activitiesPrior30: 0 }))).toEqual(["no_contact_30"]);
    expect(keysOf(baseFacts({ lastActivityAt: ago(35), activitiesLast30: 0, activitiesPrior30: 5 }))).toEqual(["no_contact_30", "activity_drop"]);
    expect(keysOf(baseFacts({ dormant: true }))).toEqual(["dormant"]);
    // A customer with nothing logged is judged from when it was added.
    expect(keysOf(baseFacts({ createdAt: ago(90), lastActivityAt: null, activitiesLast30: 0, activitiesPrior30: 0 }))).toEqual(["no_contact_60"]);
  });

  it("reads renewals: lapsed, due while quiet, recently cancelled; and one reason per kind", () => {
    const svc = (renewsOn: Date, cancelledAt: Date | null = null) => ({ startsOn: ago(500), renewsOn, cancelledAt, stateOverride: null });
    expect(keysOf(baseFacts({ services: [svc(ago(40))] }))).toEqual(["renewal_lapsed"]);
    // Due soon with recent contact: no reason. Due soon and quiet for 20 days: a reason.
    expect(keysOf(baseFacts({ services: [svc(ahead(10))] }))).toEqual([]);
    expect(keysOf(baseFacts({ lastActivityAt: ago(20), activitiesLast30: 1, services: [svc(ahead(10))] }))).toEqual(["renewal_due_quiet"]);
    expect(keysOf(baseFacts({ services: [svc(ahead(200), ago(10))] }))).toEqual(["service_cancelled"]);
    expect(keysOf(baseFacts({ services: [svc(ahead(200), ago(100))] }))).toEqual([]);
    expect(keysOf(baseFacts({ services: [svc(ago(40)), svc(ago(60)), svc(ago(90))] }))).toEqual(["renewal_lapsed"]);
  });

  it("gives every reason a plain sentence, evidence without money, and the permission its data needs", () => {
    const reasons = evaluateCustomer(baseFacts({ lastActivityAt: ago(70), dormant: true, services: [{ startsOn: ago(500), renewsOn: ago(40), cancelledAt: null, stateOverride: null }] }), NOW, DEFAULT_RENEWAL_SETTINGS);
    expect(reasons.length).toBe(3);
    for (const r of reasons) {
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.needs).toMatch(/\.view$/);
      expect(JSON.stringify(r.evidence)).not.toMatch(/KES|\$|amount|value/i);
    }
  });

  it("maps score to level, hashes the situation, and recomputes for a viewer from the reasons they may see", () => {
    expect([levelFor(1), levelFor(2), levelFor(4), levelFor(6), levelFor(9)]).toEqual([null, "low", "medium", "high", "high"]);
    const reasons = evaluateCustomer(baseFacts({ lastActivityAt: ago(70), activitiesLast30: 0, activitiesPrior30: 0, dormant: true, services: [{ startsOn: ago(500), renewsOn: ago(40), cancelledAt: null, stateOverride: null }] }), NOW, DEFAULT_RENEWAL_SETTINGS);
    expect(signalsHash(reasons)).toBe(signalsHash([...reasons].reverse()));
    expect(signalsHash(reasons)).not.toBe(signalsHash(reasons.slice(1)));
    // The numbers behind a reason do not change the situation: a day later it is the same kinds of trouble.
    const later = evaluateCustomer(baseFacts({ lastActivityAt: ago(71), activitiesLast30: 0, activitiesPrior30: 0, dormant: true, services: [{ startsOn: ago(500), renewsOn: ago(41), cancelledAt: null, stateOverride: null }] }), NOW, DEFAULT_RENEWAL_SETTINGS);
    expect(signalsHash(later)).toBe(signalsHash(reasons));
    const all = viewForViewer(reasons, () => true)!;
    expect(all.level).toBe("high");
    expect(all.reasons).toHaveLength(3);
    const noRenewal = viewForViewer(reasons, (k) => k !== "company_services.view")!;
    expect(noRenewal.reasons.map((r) => r.signal).sort()).toEqual(["dormant", "no_contact_60"]);
    expect(noRenewal.level).toBe("medium");
    expect(noRenewal.summary).not.toMatch(/recurring service/i);
    expect(viewForViewer(reasons, (k) => k === "companies.view")!.reasons.map((r) => r.signal)).toEqual(["dormant"]);
    expect(viewForViewer(reasons, () => false)).toBeNull();
  });
});

async function setup(options: { on?: boolean } = {}) {
  const org = await createTestOrganization("Churn");
  await setOrganizationRelease(org.id, "v2");
  if (options.on !== false) {
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key: TOGGLES_KEY } },
      update: { value: { "assistant.enabled": true } },
      create: { organizationId: org.id, key: TOGGLES_KEY, value: { "assistant.enabled": true } },
    });
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key: CONFIG_KEY } },
      update: { value: { retention: true } },
      create: { organizationId: org.id, key: CONFIG_KEY, value: { retention: true } },
    });
  }
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "owner.sales");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  return { org, management, sales, otherSales };
}

async function customer(orgId: string, owner: AuthContext | null, name: string, state = "CUSTOMER", ageDays = 400) {
  const lifecycle = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: orgId, key: state } });
  return adminDb.company.create({
    data: { organizationId: orgId, name, lifecycleStateId: lifecycle.id, ownerMembershipId: owner?.membershipId ?? null, createdAt: ago(ageDays) },
  });
}
const activity = (orgId: string, companyId: string, authorMembershipId: string, daysAgo: number) =>
  adminDb.activity.create({ data: { organizationId: orgId, companyId, authorMembershipId, type: "CALL", subject: "Check-in", occurredAt: ago(daysAgo) } });

describe("switches", () => {
  it("is off until the assistant and its churn option are on, and says why", async () => {
    const { org, sales, management } = await setup({ on: false });
    await customer(org.id, sales, "Quiet Co");
    expect(await refreshChurnHints(org.id, NOW)).toMatchObject({ checked: 0, skipped: expect.stringMatching(/assistant is switched off/) });
    expect(await listChurnHints(sales)).toMatchObject({ enabled: false, hints: [] });
    await expect(refreshChurnHintsNow(management)).rejects.toBeInstanceOf(ValidationError);

    // Assistant on, churn option still off.
    await adminDb.organizationSetting.create({ data: { organizationId: org.id, key: TOGGLES_KEY, value: { "assistant.enabled": true } } });
    const listed = await listChurnHints(sales);
    expect(listed.enabled).toBe(false);
    expect(listed.reason).toMatch(/Settings, AI assistant/);
    expect(await adminDb.churnHint.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("needs ai.use and V2", async () => {
    const { org } = await setup();
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");
    await expect(listChurnHints(technical)).rejects.toBeInstanceOf(ForbiddenError);
    const v1 = await createTestOrganization("ChurnV1");
    const m = await createTestContext(v1.id, "MANAGEMENT", "v1");
    await expect(listChurnHints(m)).rejects.toThrow();
    const err = await listChurnHints(m).catch((e: unknown) => e);
    expect(err instanceof FeatureUnavailableError || err instanceof ForbiddenError).toBe(true);
  });

  it("is a nightly job", () => {
    expect(getJobDefinition("churn.hints.refresh")?.schedule?.everyMs).toBe(24 * 60 * 60_000);
  });
});

describe("generating and reading", () => {
  it("hints only at owned customers that show signals, with every reason shown", async () => {
    const { org, sales, otherSales, management } = await setup();
    const quiet = await customer(org.id, sales, "Quiet Co");
    await activity(org.id, quiet.id, sales.membershipId, 75);
    const healthy = await customer(org.id, sales, "Healthy Co");
    await activity(org.id, healthy.id, sales.membershipId, 2);
    await customer(org.id, null, "Unowned Co");
    await customer(org.id, sales, "Prospect Co", "PROSPECT");
    await adminDb.company.update({ where: { id: (await customer(org.id, sales, "Archived Co")).id }, data: { archivedAt: NOW } });

    const run = await refreshChurnHints(org.id, NOW);
    expect(run).toMatchObject({ checked: 2, created: 1, resolved: 0, skipped: null });
    // The same facts again change nothing.
    expect(await refreshChurnHints(org.id, NOW)).toMatchObject({ created: 0, updated: 0, resolved: 0 });

    const mine = await listChurnHints(sales);
    expect(mine.enabled).toBe(true);
    expect(mine.hints).toHaveLength(1);
    const hint = mine.hints[0]!;
    expect(hint).toMatchObject({ company: { id: quiet.id, name: "Quiet Co" }, level: "low", status: "OPEN", mine: true });
    expect(hint.reasons.length).toBeGreaterThan(0);
    expect(hint.reasons.every((r) => r.text.length > 0)).toBe(true);
    expect(hint.summary).toMatch(/75 days/);

    // The owner and Management see it; another salesperson does not, and cannot act on it.
    expect((await listChurnHints(management)).hints.map((h) => h.id)).toEqual([hint.id]);
    expect((await listChurnHints(otherSales)).hints).toEqual([]);
    await expect(dismissChurnHint(otherSales, hint.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rateChurnHint(otherSales, hint.id, { value: "HELPFUL" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("uses no masked data: no deal value, margin, quote or payment in the store or in any answer", async () => {
    const { org, sales, management } = await setup();
    const co = await customer(org.id, sales, "Valuable Co");
    await activity(org.id, co.id, sales.membershipId, 80);
    await dealService.createDeal(sales, { companyId: co.id, pipelineStageId: await getPipelineStageId(org.id), value: SENTINEL_VALUE, currency: "KES" });
    await refreshChurnHints(org.id, NOW);

    const stored = JSON.stringify(await adminDb.churnHint.findMany({ where: { organizationId: org.id } }));
    expect(stored.replace(/[,\s]/g, "")).not.toContain(String(SENTINEL_VALUE));
    for (const viewer of [sales, management]) {
      const out = JSON.stringify(await listChurnHints(viewer));
      expect(out.replace(/[,\s]/g, "")).not.toContain(String(SENTINEL_VALUE));
      expect(out).not.toMatch(/KES|margin|payment|invoice/i);
    }
  });

  it("shows a viewer only the reasons their role may see, and recomputes the level from them", async () => {
    const { org, management } = await setup();
    const co = await customer(org.id, management, "Renewal Co", "DORMANT_CUSTOMER");
    await activity(org.id, co.id, management.membershipId, 70);
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: org.id } });
    await adminDb.recurringService.create({
      data: { organizationId: org.id, companyId: co.id, serviceId: service.id, startsOn: ago(500), renewsOn: ago(40), billingCycle: "YEARLY", ownerMembershipId: management.membershipId },
    });
    await refreshChurnHints(org.id, NOW);

    const full = (await listChurnHints(management)).hints[0]!;
    expect(full.level).toBe("high");
    expect(full.reasons.map((r) => r.signal).sort()).toEqual(["dormant", "no_contact_60", "renewal_lapsed"]);

    // A custom role that sees hints for the whole organisation (reporting.view.all) but may not open recurring services.
    const role = await createRole(management, {
      name: "Account Reviewer",
      permissionKeys: ["ai.use", "companies.view", "activities.view", "reporting.view.all"],
    });
    const { membership, user } = await createTestMembership(org.id, "SALES", "reviewer");
    await adminDb.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
    const reviewer = (await resolveActiveMembership(user.id, org.id))!;
    expect(reviewer.permissionKeys).not.toContain("company_services.view");

    const seen = (await listChurnHints(reviewer)).hints[0]!;
    expect(seen.reasons.map((r) => r.signal).sort()).toEqual(["dormant", "no_contact_60"]);
    expect(seen.level).toBe("medium");
    expect(JSON.stringify(seen)).not.toMatch(/recurring service/i);
  });

  it("closes a hint when the signals clear, and opens a new one when the situation changes after a dismissal", async () => {
    const { org, sales } = await setup();
    const co = await customer(org.id, sales, "Changing Co");
    await activity(org.id, co.id, sales.membershipId, 75);
    await refreshChurnHints(org.id, NOW);
    const first = (await listChurnHints(sales)).hints[0]!;

    // The owner calls the customer: the next look resolves the hint.
    await activity(org.id, co.id, sales.membershipId, 1);
    expect(await refreshChurnHints(org.id, NOW)).toMatchObject({ resolved: 1 });
    expect((await listChurnHints(sales)).hints).toEqual([]);
    expect((await listChurnHints(sales, { status: "RESOLVED" })).hints.map((h) => h.id)).toEqual([first.id]);
  });
});

describe("dismiss and feedback", () => {
  it("dismisses with a reason, keeps it dismissed for the same situation, and brings it back only for a new one", async () => {
    const { org, sales, management } = await setup();
    const co = await customer(org.id, sales, "Dismissed Co");
    await activity(org.id, co.id, sales.membershipId, 75);
    await refreshChurnHints(org.id, NOW);
    const hint = (await listChurnHints(sales)).hints[0]!;

    const dismissed = await dismissChurnHint(sales, hint.id, { reason: "Known: they are on holiday." });
    expect(dismissed).toMatchObject({ status: "DISMISSED", dismissReason: "Known: they are on holiday." });
    await expect(dismissChurnHint(sales, hint.id)).rejects.toBeInstanceOf(ValidationError);
    expect((await listChurnHints(sales)).hints).toEqual([]);

    // Same kind of trouble, even a day later with a bigger number: it stays dismissed.
    expect(await refreshChurnHints(org.id, new Date(NOW.getTime() + DAY))).toMatchObject({ created: 0 });
    expect((await listChurnHints(sales)).hints).toEqual([]);

    // A new kind of trouble: a service lapses. A new open hint appears, the dismissed one stays in history.
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: org.id } });
    await adminDb.recurringService.create({ data: { organizationId: org.id, companyId: co.id, serviceId: service.id, startsOn: ago(500), renewsOn: ago(50), billingCycle: "YEARLY", ownerMembershipId: sales.membershipId } });
    expect(await refreshChurnHints(org.id, NOW)).toMatchObject({ created: 1 });
    const again = (await listChurnHints(sales)).hints;
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(hint.id);
    expect((await listChurnHints(management, { status: "DISMISSED" })).hints.map((h) => h.id)).toEqual([hint.id]);

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityType: "ChurnHint", action: "churn_hint.dismissed" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorMembershipId).toBe(sales.membershipId);
  });

  it("records feedback, audited, and refuses nonsense", async () => {
    const { org, sales } = await setup();
    const co = await customer(org.id, sales, "Rated Co");
    await activity(org.id, co.id, sales.membershipId, 75);
    await refreshChurnHints(org.id, NOW);
    const hint = (await listChurnHints(sales)).hints[0]!;
    const rated = await rateChurnHint(sales, hint.id, { value: "NOT_HELPFUL", note: "We spoke by phone, not logged." });
    expect(rated.feedback).toBe("NOT_HELPFUL");
    const row = await adminDb.churnHint.findUniqueOrThrow({ where: { id: hint.id } });
    expect(row).toMatchObject({ feedback: "NOT_HELPFUL", feedbackByMembershipId: sales.membershipId });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, entityId: hint.id, action: "churn_hint.feedback" } })).toBe(1);
    await expect(rateChurnHint(sales, hint.id, { value: "MAYBE" as never })).rejects.toThrow();
  });
});

describe("a hint never acts (hard rule 9)", () => {
  it("changes no owner, stage, lifecycle state, task or message, whatever happens to a hint", async () => {
    const { org, sales } = await setup();
    const co = await customer(org.id, sales, "Passive Co", "DORMANT_CUSTOMER");
    await activity(org.id, co.id, sales.membershipId, 90);
    const deal = await dealService.createDeal(sales, { companyId: co.id, pipelineStageId: await getPipelineStageId(org.id), value: 1000, currency: "KES" });
    const snapshot = async () =>
      JSON.stringify({
        company: await adminDb.company.findUnique({ where: { id: co.id } }),
        deal: await adminDb.deal.findUnique({ where: { id: deal.id } }),
        tasks: await adminDb.task.count({ where: { organizationId: org.id } }),
        proposals: await adminDb.assistantProposal.count({ where: { organizationId: org.id } }),
        communications: await adminDb.communication.count({ where: { organizationId: org.id } }),
        notifications: await adminDb.notification.count({ where: { organizationId: org.id } }),
      });
    const before = await snapshot();
    await refreshChurnHints(org.id, NOW);
    const hint = (await listChurnHints(sales)).hints[0]!;
    await rateChurnHint(sales, hint.id, { value: "HELPFUL" });
    await dismissChurnHint(sales, hint.id);
    await refreshChurnHints(org.id, NOW);
    expect(await snapshot()).toBe(before);
  });
});

describe("tenant isolation", () => {
  it("keeps one organisation's hints from another, in the service and in the database", async () => {
    const a = await setup();
    const b = await setup();
    const co = await customer(a.org.id, a.sales, "Org A Customer");
    await activity(a.org.id, co.id, a.sales.membershipId, 75);
    await refreshChurnHints(a.org.id, NOW);
    const hint = (await listChurnHints(a.sales)).hints[0]!;

    expect((await listChurnHints(b.management)).hints).toEqual([]);
    expect((await listChurnHints(b.management, { companyId: co.id })).hints).toEqual([]);
    await expect(dismissChurnHint(b.management, hint.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rateChurnHint(b.management, hint.id, { value: "HELPFUL" })).rejects.toBeInstanceOf(NotFoundError);

    expect(await withOrgContext(b.org.id, (tx) => tx.churnHint.count())).toBe(0);
    expect(await withOrgContext(a.org.id, (tx) => tx.churnHint.count())).toBe(1);
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.churnHint.create({ data: { organizationId: a.org.id, companyId: co.id, score: 3, signals: [], signalsHash: "x" } }),
      ),
    ).rejects.toThrow();
  });
});
