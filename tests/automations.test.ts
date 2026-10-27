import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  FORBIDDEN_RULE_FIELDS,
  RULES,
  RULE_KEYS,
  assertRuleMay,
  findRule,
} from "../src/automations/catalogue";
import { notifyForRule, createRuleTask } from "../src/automations/effects";
import { logRuleRun, runRuleOnce } from "../src/automations/runLog";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { ingestWebsiteLead } from "../src/repositories/leadIngestion";
import {
  getAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  updateAutomationRule,
} from "../src/services/automationService";
import * as dealService from "../src/services/dealService";
import { takeHandoff, updateHandoffSettings } from "../src/services/handoffService";
import { createInvoice } from "../src/services/paymentService";
import { raiseProposalReminders, getReminderSettings, updateReminderSettings } from "../src/services/reminderService";
import { setWebsiteAssignmentSetting } from "../src/services/integrationService";
import { raiseStalledDealAlerts } from "../src/services/stalledDealAlerts";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";
import { createCompanyRow, createOpenDeal, createWonDeal, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("Automations");
  const management = await createTestContext(org.id, "MANAGEMENT", "auto.mgmt");
  const sales = await createTestContext(org.id, "SALES", "auto.sales");
  const delivery = await createTestContext(org.id, "DELIVERY", "auto.delivery");
  const finance = await createTestContext(org.id, "FINANCE", "auto.finance");
  return { org, management, sales, delivery, finance };
}

const runsFor = (organizationId: string, ruleKey: string) => adminDb.automationRun.findMany({ where: { organizationId, ruleKey }, orderBy: { createdAt: "asc" } });
const noteCount = (organizationId: string, type: string, membershipId?: string) =>
  adminDb.notification.count({ where: { organizationId, type: type as never, ...(membershipId ? { membershipId } : {}) } });

describe("the rule catalogue", () => {
  it("is a fixed set of eight rules with unique keys, defaults inside their own bounds, and only the four action kinds", () => {
    expect(RULES).toHaveLength(8);
    expect(new Set(RULES.map((r) => r.key)).size).toBe(8);
    for (const rule of RULES) {
      expect(rule.actions.length).toBeGreaterThan(0);
      for (const action of rule.actions) expect(ACTION_KINDS).toContain(action);
      for (const p of rule.params) {
        if (typeof p.default === "number") {
          expect(p.default).toBeGreaterThanOrEqual(p.min ?? Number.NEGATIVE_INFINITY);
          expect(p.default).toBeLessThanOrEqual(p.max ?? Number.POSITIVE_INFINITY);
        }
      }
      // Only rules that notify people have an audience.
      expect(rule.audiences.length > 0).toBe(rule.actions.includes("NOTIFY") && rule.key !== RULE_KEYS.OVERDUE_INVOICE_NOTICE);
    }
  });

  it("BOUNDARY: no rule may decide: only the website assignment rule can set an owner, none can do anything else", () => {
    const assigners = RULES.filter((r) => r.actions.includes("ASSIGN_OWNER")).map((r) => r.key);
    expect(assigners).toEqual([RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT]);
    // The action kinds themselves leave out every way of deciding.
    expect([...ACTION_KINDS].sort()).toEqual(["ASSIGN_OWNER", "CREATE_TASK", "FLAG", "NOTIFY"]);
    for (const rule of RULES) {
      for (const action of ACTION_KINDS) {
        if (rule.actions.includes(action)) expect(() => assertRuleMay(rule.key, action)).not.toThrow();
        else expect(() => assertRuleMay(rule.key, action)).toThrow(/never decide/);
      }
    }
    expect(() => assertRuleMay("NOPE" as never, "NOTIFY")).toThrow(/Unknown automation rule/);
  });

  it("BOUNDARY: the automation code never names a stage, outcome, discount or approval field", () => {
    const dir = join(__dirname, "..", "src", "automations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "catalogue.ts");
    expect(files.sort()).toEqual(["effects.ts", "runLog.ts"]);
    const forbidden = new RegExp(FORBIDDEN_RULE_FIELDS.join("|"), "i");
    for (const file of files) {
      const code = readFileSync(join(dir, file), "utf8")
        // Comments may talk about the boundary; code may not touch it.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file} must not mention a forbidden field`).not.toMatch(forbidden);
      expect(code, `${file} must not update a deal or proposal`).not.toMatch(/\.(deal|proposalReference|quote)\.(update|updateMany|upsert|delete)/);
    }
    // The stalled deal alert reads deals; it never writes one.
    const stalled = readFileSync(join(__dirname, "..", "src", "services", "stalledDealAlerts.ts"), "utf8");
    expect(stalled).not.toMatch(/\.deal\.(update|updateMany|upsert|delete|create)/);
  });

  it("the effects an organisation's rules can have are gated by what the rule declares", async () => {
    const { org, sales } = await setup();
    const base = { organizationId: org.id, assigneeMembershipId: sales.membershipId, createdByMembershipId: sales.membershipId, dueAt: NOW, priority: "LOW" as const, title: "t" };
    // The stalled alert only notifies: it cannot create a task, and the follow-up task rule cannot notify.
    await expect(createRuleTask({ ...base, ruleKey: RULE_KEYS.STALLED_DEAL_ALERT })).rejects.toThrow(/never decide/);
    await expect(
      notifyForRule({ organizationId: org.id, ruleKey: RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, ownerMembershipId: sales.membershipId, audience: "OWNER", type: "STALLED_DEAL", title: "x", body: "y", entityType: "Deal", entityId: "1", path: "/x" }),
    ).rejects.toThrow(/never decide/);
    await expect(createRuleTask({ ...base, ruleKey: RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK })).resolves.toHaveProperty("id");
  });
});

describe("running every rule changes no stage, outcome, value, discount or approval", () => {
  it("snapshot before and after a full day of automation", async () => {
    const { org, management, sales, delivery, finance } = await setup();
    const longAgo = daysFrom(new Date(), -400);

    // A stalled open deal, a proposal nobody answered, a quiet customer, an overdue invoice, a lead from the website.
    const stalledDeal = await createOpenDeal(org.id, sales);
    await adminDb.deal.update({ where: { id: stalledDeal.id }, data: { lastActivityAt: longAgo, value: 90000 } });
    const proposal = await adminDb.proposalReference.create({ data: { organizationId: org.id, dealId: stalledDeal.id, proposalNumber: "P-BOUND-1", status: "SENT", ownerMembershipId: sales.membershipId, sentAt: longAgo, amount: 90000 } });
    await adminDb.$executeRaw`UPDATE proposal_references SET updated_at = ${longAgo} WHERE id = ${proposal.id}`;
    const company = await createCompanyRow(org.id, { name: "Quiet Bound Ltd", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: longAgo });
    const wonDeal = await createWonDeal(org.id, sales, { companyId: company.id, wonAt: longAgo });
    await adminDb.deal.update({ where: { id: wonDeal.id }, data: { lastActivityAt: longAgo } });
    await createInvoice(management, { number: "BOUND-1", amount: 5000, issuedOn: "2026-01-01", dueOn: "2026-02-01", dealId: wonDeal.id, sent: true });

    const snapshot = async () => ({
      deals: await adminDb.deal.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" }, select: { id: true, pipelineStageId: true, outcome: true, value: true, wonAt: true, lostAt: true, ownerMembershipId: true, lostReasonId: true, expectedCloseDate: true } }),
      proposals: await adminDb.proposalReference.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" }, select: { id: true, status: true, amount: true, ownerMembershipId: true } }),
      invoices: await adminDb.invoice.findMany({ where: { organizationId: org.id }, orderBy: { id: "asc" }, select: { id: true, status: true, amount: true } }),
    });
    const before = await snapshot();

    await ingestWebsiteLead(org.id, { name: "Bound Lead", email: "bound@example.test" });
    for (const type of ["lifecycle.sweep", "reminders.sweep", "automations.sweep"]) {
      expect((await enqueueAndRunNow({ organizationId: org.id, type })).outcome).toBe("succeeded");
    }
    expect(await snapshot()).toEqual(before);

    // ...and the rules did act: notifications went out and the run log has them.
    expect(await noteCount(org.id, "STALLED_DEAL", sales.membershipId)).toBe(1);
    expect(await noteCount(org.id, "PROPOSAL_UNANSWERED", sales.membershipId)).toBe(1);
    expect(await noteCount(org.id, "DORMANT_CUSTOMER", sales.membershipId)).toBe(1);
    expect(await noteCount(org.id, "PAYMENT_OVERDUE", finance.membershipId)).toBe(1);
    const log = await adminDb.automationRun.findMany({ where: { organizationId: org.id, status: "APPLIED" } });
    expect(new Set(log.map((r) => r.ruleKey))).toEqual(
      new Set([RULE_KEYS.STALLED_DEAL_ALERT, RULE_KEYS.PROPOSAL_FOLLOW_UP, RULE_KEYS.DORMANT_CUSTOMER_FLAG, RULE_KEYS.OVERDUE_INVOICE_NOTICE, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK]),
    );
    void delivery;
  });
});

describe("one effect per trigger", () => {
  it("two runs of the same trigger apply once, concurrently or one after the other", async () => {
    const { org } = await setup();
    let applied = 0;
    const target = { organizationId: org.id, ruleKey: RULE_KEYS.STALLED_DEAL_ALERT, triggerKey: "deal:x:2026-11-01", entityType: "Deal", entityId: "x" };
    const effect = async () => {
      applied += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { result: "done" };
    };
    const outcomes = await Promise.all([runRuleOnce(target, effect), runRuleOnce(target, effect), runRuleOnce(target, effect)]);
    expect(outcomes.filter((o) => o === "APPLIED")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "DUPLICATE")).toHaveLength(2);
    expect(applied).toBe(1);
    expect(await runRuleOnce(target, effect)).toBe("DUPLICATE");
    expect(await runsFor(org.id, RULE_KEYS.STALLED_DEAL_ALERT)).toHaveLength(1);
    // A different trigger is its own effect.
    expect(await runRuleOnce({ ...target, triggerKey: "deal:x:2026-11-09" }, effect)).toBe("APPLIED");
    expect(applied).toBe(2);
  });

  it("the database refuses a second applied run for the same trigger, whoever writes it", async () => {
    const { org } = await setup();
    const row = { organizationId: org.id, ruleKey: RULE_KEYS.RENEWAL_REMINDER, triggerKey: "service:1:2026-12-01", status: "APPLIED", result: "ok" };
    await adminDb.automationRun.create({ data: row });
    await expect(adminDb.automationRun.create({ data: row })).rejects.toThrow();
    // A failed or skipped run for the same trigger does not count as the effect.
    await adminDb.automationRun.create({ data: { ...row, status: "FAILED" } });
    await adminDb.automationRun.create({ data: { ...row, status: "SKIPPED" } });
  });

  it("a rule that fails is logged FAILED, never throws into its caller, and can run again", async () => {
    const { org } = await setup();
    const target = { organizationId: org.id, ruleKey: RULE_KEYS.PROPOSAL_FOLLOW_UP, triggerKey: "proposal:p:2026-11-01", entityType: "ProposalReference", entityId: "p" };
    expect(await runRuleOnce(target, async () => { throw new Error("The mail server was down."); })).toBe("FAILED");
    const failed = await runsFor(org.id, RULE_KEYS.PROPOSAL_FOLLOW_UP);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: "FAILED", result: "The mail server was down." });
    expect(await runRuleOnce(target, async () => ({ result: "second try worked" }))).toBe("APPLIED");
    expect((await runsFor(org.id, RULE_KEYS.PROPOSAL_FOLLOW_UP)).map((r) => r.status).sort()).toEqual(["APPLIED", "FAILED"]);
    // An effect that decides there is nothing to do leaves no claim behind.
    expect(await runRuleOnce({ ...target, triggerKey: "proposal:q:2026-11-01" }, async () => null)).toBe("SKIPPED");
    expect(await runRuleOnce({ ...target, triggerKey: "proposal:q:2026-11-01" }, async () => ({ result: "now there is" }))).toBe("APPLIED");
  });
});

describe("the rules screen: list, switch and thresholds", () => {
  it("lists every rule with its defaults, for Management only", async () => {
    const { management, sales, delivery, finance } = await setup();
    const { items, boundary } = await listAutomationRules(management);
    expect(items.map((r) => r.key)).toEqual(RULES.map((r) => r.key));
    expect(items.every((r) => r.enabled)).toBe(true);
    expect(boundary).toMatch(/never move a deal stage/);
    const proposal = items.find((r) => r.key === RULE_KEYS.PROPOSAL_FOLLOW_UP)!;
    expect(proposal).toMatchObject({ audience: "OWNER", params: [expect.objectContaining({ key: "days", value: 5 })], recent: { applied: 0, skipped: 0, failed: 0, lastRunAt: null } });
    expect(items.find((r) => r.key === RULE_KEYS.DORMANT_CUSTOMER_FLAG)!.params[0]).toMatchObject({ key: "days", value: 90 });
    expect(items.find((r) => r.key === RULE_KEYS.STALLED_DEAL_ALERT)!.params[0]).toMatchObject({ readOnly: true, value: 10 });
    for (const who of [sales, delivery, finance]) {
      await expect(listAutomationRules(who)).rejects.toThrow(ForbiddenError);
      await expect(getAutomationRule(who, RULE_KEYS.PROPOSAL_FOLLOW_UP)).rejects.toThrow(ForbiddenError);
      await expect(updateAutomationRule(who, RULE_KEYS.PROPOSAL_FOLLOW_UP, { enabled: false })).rejects.toThrow(ForbiddenError);
      await expect(listAutomationRuns(who)).rejects.toThrow(ForbiddenError);
    }
  });

  it("switches a rule off and on, changes thresholds and the audience, and audits each change with before and after", async () => {
    const { org, management } = await setup();
    const off = await updateAutomationRule(management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { enabled: false });
    expect(off.enabled).toBe(false);
    const hours = await updateAutomationRule(management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { enabled: true, params: { dueInHours: 4 } });
    expect(hours).toMatchObject({ enabled: true, params: [expect.objectContaining({ value: 4 })] });
    const audience = await updateAutomationRule(management, RULE_KEYS.STALLED_DEAL_ALERT, { audience: "OWNER_AND_MANAGEMENT" });
    expect(audience.audience).toBe("OWNER_AND_MANAGEMENT");

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "automation_rule.updated" }, orderBy: { createdAt: "asc" } });
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ entityId: RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, previousValue: expect.objectContaining({ enabled: true }), newValue: expect.objectContaining({ enabled: false }) });
  });

  it("refuses unknown rules, bad thresholds, read-only numbers and an audience a rule cannot have", async () => {
    const { management } = await setup();
    await expect(updateAutomationRule(management, "MOVE_DEALS_FORWARD", { enabled: true })).rejects.toThrow(NotFoundError);
    await expect(getAutomationRule(management, "MOVE_DEALS_FORWARD")).rejects.toThrow(NotFoundError);
    const bad = (key: string, patch: Parameters<typeof updateAutomationRule>[2]) => updateAutomationRule(management, key, patch).catch((e) => e);
    expect(await bad(RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { params: { dueInHours: 0 } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { params: { dueInHours: 169 } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { params: { dueInHours: 1.5 } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { params: { colour: 3 } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.STALLED_DEAL_ALERT, { params: { stalledAfterDays: 3 } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, { audience: "OWNER" })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, { params: { fallback: "PICK_AT_RANDOM" } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.PROPOSAL_FOLLOW_UP, { audience: "EVERYONE" as never })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.PROPOSAL_FOLLOW_UP, { params: { days: 366 } })).toBeInstanceOf(ValidationError);
    expect(await bad(RULE_KEYS.OVERDUE_INVOICE_NOTICE, { audience: "OWNER_AND_MANAGEMENT" })).toBeInstanceOf(ValidationError);
  });

  it("stays in step with the reminder settings and the dormancy threshold it shares", async () => {
    const { management } = await setup();
    await updateAutomationRule(management, RULE_KEYS.PROPOSAL_FOLLOW_UP, { enabled: false, params: { days: 9 } });
    expect(await getReminderSettings(management)).toMatchObject({ proposalFollowUp: { enabled: false, days: 9 } });
    await updateReminderSettings(management, { proposalFollowUp: { enabled: true, days: 3 }, renewal: { daysAhead: 14 } });
    expect(await getAutomationRule(management, RULE_KEYS.PROPOSAL_FOLLOW_UP)).toMatchObject({ enabled: true, params: [expect.objectContaining({ value: 3 })] });
    expect(await getAutomationRule(management, RULE_KEYS.RENEWAL_REMINDER)).toMatchObject({ params: [expect.objectContaining({ key: "daysAhead", value: 14 })] });

    await updateAutomationRule(management, RULE_KEYS.DORMANT_CUSTOMER_FLAG, { params: { days: 45 } });
    expect((await getAutomationRule(management, RULE_KEYS.DORMANT_CUSTOMER_FLAG)).params[0]).toMatchObject({ value: 45 });
    await updateAutomationRule(management, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, { params: { fallback: "UNASSIGNED" } });
    expect((await getAutomationRule(management, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT)).params[0]).toMatchObject({ value: "UNASSIGNED" });
    await setWebsiteAssignmentSetting(management, "ROUND_ROBIN");
    expect((await getAutomationRule(management, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT)).params[0]).toMatchObject({ value: "ROUND_ROBIN" });
  });
});

describe("website lead assignment and the follow-up task are rules", () => {
  it("assign and create the task by default, and log both", async () => {
    const { org, sales } = await setup();
    const result = await ingestWebsiteLead(org.id, { name: "Rule Lead", email: "rule@example.test" });
    expect(result.ownerMembershipId).toBe(sales.membershipId);
    const task = await adminDb.task.findFirstOrThrow({ where: { organizationId: org.id, leadId: result.leadId } });
    expect(task.title).toBe("Follow up on new website lead");
    expect(Math.round((task.dueAt!.getTime() - Date.now()) / 3_600_000)).toBe(24);
    expect((await runsFor(org.id, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT))[0]).toMatchObject({ status: "APPLIED", entityType: "Lead", entityId: result.leadId, result: "Assigned by the round robin." });
    expect((await runsFor(org.id, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK))[0]).toMatchObject({ status: "APPLIED", entityId: result.leadId });
  });

  it("with the assignment rule off, the lead is left unassigned, gets no task, and the log says why", async () => {
    const { org, management } = await setup();
    await updateAutomationRule(management, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, { enabled: false });
    const result = await ingestWebsiteLead(org.id, { name: "Unassigned Lead", email: "un@example.test" });
    expect(result.ownerMembershipId).toBeNull();
    expect(await adminDb.task.count({ where: { organizationId: org.id, leadId: result.leadId } })).toBe(0);
    const [run] = await runsFor(org.id, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT);
    expect(run).toMatchObject({ status: "SKIPPED" });
    expect(run!.result).toContain("switched off");
  });

  it("with the fallback set to Unassigned and no matching rule, the lead is left unassigned too", async () => {
    const { org, management } = await setup();
    await updateAutomationRule(management, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, { params: { fallback: "UNASSIGNED" } });
    const result = await ingestWebsiteLead(org.id, { name: "Fallback Lead", phone: "0700111222" });
    expect(result.ownerMembershipId).toBeNull();
    expect((await runsFor(org.id, RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT))[0]!.result).toContain("fallback is Unassigned");
  });

  it("with the follow-up rule off there is no task, and its due time follows the setting", async () => {
    const { org, management } = await setup();
    await updateAutomationRule(management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { enabled: false });
    const off = await ingestWebsiteLead(org.id, { name: "No Task Lead", email: "notask@example.test" });
    expect(off.ownerMembershipId).not.toBeNull();
    expect(await adminDb.task.count({ where: { organizationId: org.id, leadId: off.leadId } })).toBe(0);
    expect(await runsFor(org.id, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK)).toHaveLength(0);

    await updateAutomationRule(management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { enabled: true, params: { dueInHours: 2 } });
    const on = await ingestWebsiteLead(org.id, { name: "Quick Task Lead", email: "quick@example.test" });
    const task = await adminDb.task.findFirstOrThrow({ where: { organizationId: org.id, leadId: on.leadId } });
    expect(Math.round((task.dueAt!.getTime() - Date.now()) / 3_600_000)).toBe(2);
  });
});

describe("handoff onboarding tasks are a rule", () => {
  it("off: the handoff happens without tasks; on again: taking the handoff creates them once", async () => {
    const { org, management, sales, delivery } = await setup();
    const wonStage = await getPipelineStageId(org.id, "CLOSED_WON");
    const openStage = await getPipelineStageId(org.id);
    const { company } = await import("../src/services/companyService").then((m) => m.createCompany(management, { name: "Handoff Rule Co" }));
    const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: openStage, value: 1000 });

    await updateAutomationRule(management, RULE_KEYS.HANDOFF_ONBOARDING_TASKS, { enabled: false });
    await dealService.updateDeal(management, deal.id, { pipelineStageId: wonStage, handoff: { ownerLater: true } });
    expect(await adminDb.task.count({ where: { organizationId: org.id, dealId: deal.id } })).toBe(0);
    expect(await runsFor(org.id, RULE_KEYS.HANDOFF_ONBOARDING_TASKS)).toHaveLength(0);

    await updateAutomationRule(management, RULE_KEYS.HANDOFF_ONBOARDING_TASKS, { enabled: true });
    await takeHandoff(delivery, deal.id);
    const tasks = await adminDb.task.findMany({ where: { organizationId: org.id, dealId: deal.id } });
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => t.assigneeMembershipId === delivery.membershipId)).toBe(true);
    const log = await runsFor(org.id, RULE_KEYS.HANDOFF_ONBOARDING_TASKS);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "APPLIED", entityType: "Deal", entityId: deal.id });
    expect(log[0]!.result).toContain("3 onboarding tasks");
    void updateHandoffSettings;
  });
});

describe("proposal follow-up, dormant flag and renewal rules", () => {
  it("the audience decides who hears: the owner alone, or the owner and Management", async () => {
    const { org, management, sales } = await setup();
    const deal = await createOpenDeal(org.id, sales);
    const proposal = await adminDb.proposalReference.create({ data: { organizationId: org.id, dealId: deal.id, proposalNumber: "P-AUD-1", status: "SENT", ownerMembershipId: sales.membershipId, sentAt: daysFrom(NOW, -8) } });
    await adminDb.$executeRaw`UPDATE proposal_references SET updated_at = ${daysFrom(NOW, -8)} WHERE id = ${proposal.id}`;

    expect(await raiseProposalReminders(org.id, NOW)).toEqual({ proposals: 1, notified: 1 });
    expect(await noteCount(org.id, "PROPOSAL_UNANSWERED", management.membershipId)).toBe(0);

    await adminDb.$executeRaw`UPDATE proposal_references SET updated_at = ${daysFrom(NOW, -9)} WHERE id = ${proposal.id}`;
    await updateAutomationRule(management, RULE_KEYS.PROPOSAL_FOLLOW_UP, { audience: "OWNER_AND_MANAGEMENT" });
    expect(await raiseProposalReminders(org.id, NOW)).toEqual({ proposals: 1, notified: 2 });
    expect(await noteCount(org.id, "PROPOSAL_UNANSWERED", management.membershipId)).toBe(1);
    expect(await noteCount(org.id, "PROPOSAL_UNANSWERED", sales.membershipId)).toBe(2);
    const runs = await runsFor(org.id, RULE_KEYS.PROPOSAL_FOLLOW_UP);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.result).toContain("Reminded 2 people");
  });

  it("with the dormant flag off, a quiet customer is not flagged and nobody is told", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Quiet Rule Co", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: daysFrom(new Date(), -400) });
    await updateAutomationRule(management, RULE_KEYS.DORMANT_CUSTOMER_FLAG, { enabled: false });
    const off = await enqueueAndRunNow({ organizationId: org.id, type: "lifecycle.sweep" });
    expect(off.job?.result).toMatchObject({ toDormant: 0, notified: 0 });
    const still = await adminDb.company.findUniqueOrThrow({ where: { id: company.id }, include: { lifecycleState: true } });
    expect(still.lifecycleState?.key).toBe("ACTIVE_CUSTOMER");
    expect(await runsFor(org.id, RULE_KEYS.DORMANT_CUSTOMER_FLAG)).toHaveLength(0);

    await updateAutomationRule(management, RULE_KEYS.DORMANT_CUSTOMER_FLAG, { enabled: true });
    const on = await enqueueAndRunNow({ organizationId: org.id, type: "lifecycle.sweep" });
    expect(on.job?.result).toMatchObject({ toDormant: 1, notified: 1 });
    const flagged = await adminDb.company.findUniqueOrThrow({ where: { id: company.id }, include: { lifecycleState: true } });
    expect(flagged.lifecycleState?.key).toBe("DORMANT_CUSTOMER");
    const log = await runsFor(org.id, RULE_KEYS.DORMANT_CUSTOMER_FLAG);
    expect(log).toHaveLength(2);
    expect(log.map((r) => r.result).join(" ")).toMatch(/Flagged the customer as dormant/);
  });
});

describe("stalled deal alert", () => {
  async function stalled() {
    const ctx = await setup();
    const deal = await createOpenDeal(ctx.org.id, ctx.sales);
    await adminDb.deal.update({ where: { id: deal.id }, data: { lastActivityAt: daysFrom(NOW, -20), value: 777000 } });
    return { ...ctx, deal };
  }

  it("tells the owner once per stall, carries no value, and repeats only after the deal wakes up and stalls again", async () => {
    const { org, sales, deal } = await stalled();
    expect(await raiseStalledDealAlerts(org.id, NOW)).toEqual({ deals: 1, notified: 1 });
    const note = await adminDb.notification.findFirstOrThrow({ where: { organizationId: org.id, type: "STALLED_DEAL" } });
    expect(note.membershipId).toBe(sales.membershipId);
    expect(note.body).toContain("20 days");
    expect(`${note.title} ${note.body}`).not.toContain("777");

    // A repeat run does nothing.
    expect(await raiseStalledDealAlerts(org.id, NOW)).toEqual({ deals: 0, notified: 0 });
    expect(await noteCount(org.id, "STALLED_DEAL")).toBe(1);

    // It wakes up (activity), then stalls again later: a new stall, a new alert.
    await adminDb.deal.update({ where: { id: deal.id }, data: { lastActivityAt: daysFrom(NOW, -1) } });
    expect(await raiseStalledDealAlerts(org.id, NOW)).toEqual({ deals: 0, notified: 0 });
    expect(await raiseStalledDealAlerts(org.id, daysFrom(NOW, 12))).toEqual({ deals: 1, notified: 1 });
    expect(await noteCount(org.id, "STALLED_DEAL")).toBe(2);
    expect(await runsFor(org.id, RULE_KEYS.STALLED_DEAL_ALERT)).toHaveLength(2);
  });

  it("follows the deal rules' threshold, skips won, lost and archived deals, and can be switched off", async () => {
    const { org, management, sales } = await stalled();
    const won = await createWonDeal(org.id, sales);
    await adminDb.deal.update({ where: { id: won.id }, data: { lastActivityAt: daysFrom(NOW, -60) } });
    const archived = await createOpenDeal(org.id, sales);
    await adminDb.deal.update({ where: { id: archived.id }, data: { lastActivityAt: daysFrom(NOW, -60), archivedAt: new Date() } });
    expect((await raiseStalledDealAlerts(org.id, NOW)).deals).toBe(1);

    const fresh = await createOpenDeal(org.id, sales);
    await adminDb.deal.update({ where: { id: fresh.id }, data: { lastActivityAt: daysFrom(NOW, -5) } });
    expect((await raiseStalledDealAlerts(org.id, NOW)).deals).toBe(0); // 5 days is inside the default 10

    await updateAutomationRule(management, RULE_KEYS.STALLED_DEAL_ALERT, { enabled: false });
    await adminDb.notification.deleteMany({ where: { organizationId: org.id } });
    await adminDb.automationRun.deleteMany({ where: { organizationId: org.id } });
    expect(await raiseStalledDealAlerts(org.id, daysFrom(NOW, 40))).toEqual({ deals: 0, notified: 0 });
  });

  it("tells Management as well when the audience says so, without duplicating an owner who is also Management", async () => {
    const { org, management } = await setup();
    const deal = await createOpenDeal(org.id, management);
    await adminDb.deal.update({ where: { id: deal.id }, data: { lastActivityAt: daysFrom(NOW, -30) } });
    await updateAutomationRule(management, RULE_KEYS.STALLED_DEAL_ALERT, { audience: "OWNER_AND_MANAGEMENT" });
    expect(await raiseStalledDealAlerts(org.id, NOW)).toEqual({ deals: 1, notified: 1 });
  });

  it("runs as the automations.sweep job, for its own organisation only", async () => {
    const mine = await stalled();
    const other = await stalled();
    // The job runs on the real clock, so these stalls are measured from today.
    await adminDb.deal.update({ where: { id: mine.deal.id }, data: { lastActivityAt: daysFrom(new Date(), -30) } });
    const run = await enqueueAndRunNow({ organizationId: mine.org.id, type: "automations.sweep" });
    expect(run.outcome).toBe("succeeded");
    expect(run.job?.result).toMatchObject({ stalledDeals: { deals: 1 } });
    expect(await noteCount(mine.org.id, "STALLED_DEAL")).toBe(1);
    expect(await noteCount(other.org.id, "STALLED_DEAL")).toBe(0);
  });
});

describe("the run log", () => {
  it("lists each run with its rule, record and result; filters, pages, and shows the recent counts on the rules screen", async () => {
    const { org, management } = await setup();
    await ingestWebsiteLead(org.id, { name: "Log Lead One", email: "one@example.test" });
    await ingestWebsiteLead(org.id, { name: "Log Lead Two", email: "two@example.test" });
    await logRuleRun({ organizationId: org.id, ruleKey: RULE_KEYS.RENEWAL_REMINDER, triggerKey: "service:z:2026-12-01", entityType: "RecurringService", entityId: "z" }, "FAILED", { result: "It broke." });

    const all = await listAutomationRuns(management);
    expect(all.total).toBe(5);
    expect(all.items[0]).toEqual(expect.objectContaining({ rule: { key: expect.any(String), name: expect.any(String) }, record: expect.any(Object), status: expect.any(String), result: expect.any(String) }));
    const times = all.items.map((r) => r.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    expect((await listAutomationRuns(management, { ruleKey: RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT })).total).toBe(2);
    expect((await listAutomationRuns(management, { status: "FAILED" })).items).toHaveLength(1);
    expect((await listAutomationRuns(management, { entityType: "RecurringService", entityId: "z" })).total).toBe(1);
    const page = await listAutomationRuns(management, {}, { pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    await expect(listAutomationRuns(management, { ruleKey: "NOPE" })).rejects.toThrow(ValidationError);
    await expect(listAutomationRuns(management, { status: "MAYBE" })).rejects.toThrow(ValidationError);
    expect((await listAutomationRuns(management, { dateFrom: "2000-01-01", dateTo: "2000-01-02" })).total).toBe(0);

    const screen = await listAutomationRules(management);
    expect(screen.items.find((r) => r.key === RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT)!.recent).toMatchObject({ applied: 2, failed: 0 });
    expect(screen.items.find((r) => r.key === RULE_KEYS.RENEWAL_REMINDER)!.recent).toMatchObject({ failed: 1 });
    expect(screen.items.find((r) => r.key === RULE_KEYS.RENEWAL_REMINDER)!.recent.lastRunAt).toBeInstanceOf(Date);
  });

  it("hides runs on invoices from a reader who may not see payments", async () => {
    const { org, management, sales, finance } = await setup();
    const deal = await createWonDeal(org.id, sales);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await createInvoice(management, { number: "RUNLOG-INV-9", amount: 4321, issuedOn: "2026-01-01", dueOn: yesterday, dealId: deal.id, sent: true });
    await enqueueAndRunNow({ organizationId: org.id, type: "reminders.sweep" });

    const full = await listAutomationRuns(management, { ruleKey: RULE_KEYS.OVERDUE_INVOICE_NOTICE });
    expect(full.total).toBe(1);
    expect(JSON.stringify(full)).not.toMatch(/RUNLOG-INV-9|4321/);

    const limited = { ...management, permissionKeys: management.permissionKeys.filter((k) => k !== "finance.view.payments") };
    expect((await listAutomationRuns(limited)).items.some((r) => r.rule.key === RULE_KEYS.OVERDUE_INVOICE_NOTICE)).toBe(false);
    expect((await listAutomationRuns(limited, { ruleKey: RULE_KEYS.OVERDUE_INVOICE_NOTICE })).total).toBe(0);
    void finance;
  });

  it("never shows another organisation's runs or state", async () => {
    const a = await setup();
    const b = await setup();
    await ingestWebsiteLead(a.org.id, { name: "Isolated Lead", email: "iso@example.test" });
    await updateAutomationRule(a.management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK, { enabled: false });
    expect((await listAutomationRuns(b.management)).total).toBe(0);
    expect(findRule(RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK)!.defaultEnabled).toBe(true);
    expect((await getAutomationRule(b.management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK)).enabled).toBe(true);
    expect((await getAutomationRule(a.management, RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK)).enabled).toBe(false);
  });
});
