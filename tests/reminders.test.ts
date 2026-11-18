import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { createInvoice } from "../src/services/paymentService";
import {
  DEFAULT_REMINDER_SETTINGS,
  getReminderSettings,
  raiseDormantReminders,
  raiseProposalReminders,
  raiseRenewalReminders,
  runReminders,
  updateReminderSettings,
} from "../src/services/reminderService";
import { runLifecycleSweep } from "../src/services/lifecycleService";
import { createRecurringService } from "../src/services/recurringServiceService";
import { createTestContext, createTestOrganization, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createOpenDeal, createWonDeal, day, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("Reminders");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const finance = await createTestContext(org.id, "FINANCE");
  return { org, management, sales, finance };
}

const typeCount = (organizationId: string, type: "PROPOSAL_UNANSWERED" | "RENEWAL_DUE" | "DORMANT_CUSTOMER" | "PAYMENT_OVERDUE", membershipId?: string) =>
  adminDb.notification.count({ where: { organizationId, type, ...(membershipId ? { membershipId } : {}) } });

async function sentProposal(organizationId: string, dealId: string, ownerMembershipId: string | null, ageDays: number, status: "SENT" | "DRAFT" | "ACCEPTED" = "SENT") {
  const p = await adminDb.proposalReference.create({ data: { organizationId, dealId, proposalNumber: `P-${Math.random().toString(36).slice(2, 7)}`, status, ownerMembershipId, sentAt: daysFrom(NOW, -ageDays) } });
  await adminDb.$executeRaw`UPDATE proposal_references SET updated_at = ${daysFrom(NOW, -ageDays)} WHERE id = ${p.id}`;
  return p;
}

describe("reminder settings", () => {
  it("default to on with sensible thresholds; only Management changes them, and bad values are refused", async () => {
    const { management, sales } = await setup();
    expect(await getReminderSettings(management)).toEqual(DEFAULT_REMINDER_SETTINGS);
    await expect(getReminderSettings(sales)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateReminderSettings(sales, { dormant: { enabled: false } })).rejects.toBeInstanceOf(ForbiddenError);
    const next = await updateReminderSettings(management, { proposalFollowUp: { days: 10 }, renewal: { enabled: false } });
    expect(next).toEqual({ ...DEFAULT_REMINDER_SETTINGS, proposalFollowUp: { enabled: true, days: 10 }, renewal: { enabled: false, daysAhead: 30 } });
    expect(await getReminderSettings(management)).toEqual(next);
    await expect(updateReminderSettings(management, { proposalFollowUp: { days: 0 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateReminderSettings(management, { renewal: { daysAhead: 1000 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateReminderSettings(management, { dormant: { enabled: "yes" as never } })).rejects.toBeInstanceOf(ValidationError);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: management.organizationId, action: "reminder_settings.updated" } });
    expect(audit).toHaveLength(1);
  });
});

describe("proposal follow-up reminders", () => {
  it("tell the owner of a proposal sent more than N days ago and unanswered, once, and change nothing", async () => {
    const { org, management, sales } = await setup();
    const deal = await createOpenDeal(org.id, sales);
    const old = await sentProposal(org.id, deal.id, sales.membershipId, 6);
    const fresh = await sentProposal(org.id, deal.id, sales.membershipId, 2);
    const draft = await sentProposal(org.id, deal.id, sales.membershipId, 9, "DRAFT");
    const accepted = await sentProposal(org.id, deal.id, sales.membershipId, 9, "ACCEPTED");
    const wonDeal = await createWonDeal(org.id, sales);
    await sentProposal(org.id, wonDeal.id, sales.membershipId, 20);

    expect(await raiseProposalReminders(org.id, NOW)).toEqual({ proposals: 1, notified: 1 });
    const note = await adminDb.notification.findFirstOrThrow({ where: { organizationId: org.id, type: "PROPOSAL_UNANSWERED" } });
    expect(note).toMatchObject({ membershipId: sales.membershipId, entityType: "ProposalReference" });
    expect(note.title).toContain(old.proposalNumber);
    expect(note.body).toContain("6 days ago");

    // A second run does nothing new, and the reminder decided nothing.
    await raiseProposalReminders(org.id, NOW);
    expect(await typeCount(org.id, "PROPOSAL_UNANSWERED")).toBe(1);
    expect(await adminDb.proposalReference.findMany({ where: { id: { in: [old.id, fresh.id, draft.id, accepted.id] } }, orderBy: { proposalNumber: "asc" } }).then((r) => r.map((p) => p.status).sort())).toEqual(["ACCEPTED", "DRAFT", "SENT", "SENT"]);
    const after = await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after).toMatchObject({ outcome: "OPEN", pipelineStageId: deal.pipelineStageId, value: null });

    // The same proposal asks again only after another quiet stretch (its last update moved).
    await adminDb.$executeRaw`UPDATE proposal_references SET updated_at = ${daysFrom(NOW, -7)} WHERE id = ${old.id}`;
    await raiseProposalReminders(org.id, NOW);
    expect(await typeCount(org.id, "PROPOSAL_UNANSWERED")).toBe(2);

    // The proposal's owner wins over the deal's owner; with no owner on either, nobody is told.
    const other = await createTestContext(org.id, "SALES", "other.sales");
    const deal2 = await createOpenDeal(org.id, sales);
    await sentProposal(org.id, deal2.id, other.membershipId, 8);
    await raiseProposalReminders(org.id, NOW);
    expect(await typeCount(org.id, "PROPOSAL_UNANSWERED", other.membershipId)).toBe(1);
    void management;
  });

  it("follow the threshold and the on/off switch", async () => {
    const { org, management, sales } = await setup();
    const deal = await createOpenDeal(org.id, sales);
    await sentProposal(org.id, deal.id, sales.membershipId, 4);
    expect((await raiseProposalReminders(org.id, NOW)).notified).toBe(0);
    await updateReminderSettings(management, { proposalFollowUp: { days: 3 } });
    expect((await raiseProposalReminders(org.id, NOW)).notified).toBe(1);
    await adminDb.notification.deleteMany({ where: { organizationId: org.id } });
    await updateReminderSettings(management, { proposalFollowUp: { enabled: false } });
    expect(await raiseProposalReminders(org.id, NOW)).toEqual({ proposals: 0, notified: 0 });
  });
});

describe("renewal reminders", () => {
  it("tell the owner N days ahead, including a renewal already past its date, and only once per renewal date", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Hosting Co", ownerMembershipId: sales.membershipId });
    const serviceId = await getServiceId(org.id, "CRM");
    const mk = (renewsOn: string, extra: Record<string, unknown> = {}) =>
      createRecurringService(management, { companyId: company.id, serviceId, startsOn: "2025-01-01", renewsOn, ...extra } as never, NOW);
    const soon = await mk("2026-11-20");
    await mk("2027-03-01"); // too far
    const late = await mk("2026-11-05"); // past its date, inside the grace window
    const cancelled = await mk("2026-11-15");
    await adminDb.recurringService.update({ where: { id: cancelled.id }, data: { cancelledAt: NOW, cancelReason: "gone" } });
    await mk("2026-11-25", { startsOn: "2026-11-20" }); // not started yet

    expect(await raiseRenewalReminders(org.id, NOW)).toEqual({ services: 2, notified: 2 });
    const notes = await adminDb.notification.findMany({ where: { organizationId: org.id, type: "RENEWAL_DUE" }, orderBy: { title: "asc" } });
    expect(notes.map((n) => n.membershipId)).toEqual([sales.membershipId, sales.membershipId]);
    expect(notes.map((n) => n.body).sort()).toEqual(["It renews in 10 days.", "It was due 5 days ago."]);
    await raiseRenewalReminders(org.id, NOW);
    expect(await typeCount(org.id, "RENEWAL_DUE")).toBe(2);

    // Renewing moves the date, so the next period gets its own reminder.
    await adminDb.recurringService.update({ where: { id: soon.id }, data: { renewsOn: day("2026-12-05") } });
    await raiseRenewalReminders(org.id, new Date("2026-12-01T09:00:00.000Z"));
    expect(await typeCount(org.id, "RENEWAL_DUE")).toBeGreaterThanOrEqual(3);
    void late;
  });

  it("are configurable, can be switched off, and cover a company service with an end date and no recurring record", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Ends Ltd", ownerMembershipId: sales.membershipId });
    const serviceId = await getServiceId(org.id, "CRM");
    await adminDb.companyService.create({ data: { organizationId: org.id, companyId: company.id, serviceId, status: "ACTIVE", startDate: day("2026-01-01"), endDate: day("2026-12-25") } });
    expect((await raiseRenewalReminders(org.id, NOW)).notified).toBe(0); // 45 days away, window is 30
    await updateReminderSettings(management, { renewal: { daysAhead: 60 } });
    expect(await raiseRenewalReminders(org.id, NOW)).toEqual({ services: 1, notified: 1 });
    expect((await adminDb.notification.findFirstOrThrow({ where: { organizationId: org.id, type: "RENEWAL_DUE" } })).title).toContain("Ends soon");
    await adminDb.notification.deleteMany({ where: { organizationId: org.id } });
    await updateReminderSettings(management, { renewal: { enabled: false } });
    expect(await raiseRenewalReminders(org.id, NOW)).toEqual({ services: 0, notified: 0 });
  });

  it("do not count a company service twice when it already has a recurring service", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { ownerMembershipId: sales.membershipId });
    const serviceId = await getServiceId(org.id, "CRM");
    const link = await adminDb.companyService.create({ data: { organizationId: org.id, companyId: company.id, serviceId, status: "ACTIVE", startDate: day("2026-01-01"), endDate: day("2026-11-20") } });
    await adminDb.recurringService.create({ data: { organizationId: org.id, companyId: company.id, serviceId, companyServiceId: link.id, startsOn: day("2026-01-01"), renewsOn: day("2026-11-20"), ownerMembershipId: sales.membershipId } });
    expect(await raiseRenewalReminders(org.id, NOW)).toEqual({ services: 1, notified: 1 });
    void management;
  });
});

describe("dormant customer reminders", () => {
  it("tell the owner once when a customer goes dormant, and can be switched off", async () => {
    const { org, management, sales } = await setup();
    const quiet = await createCompanyRow(org.id, { name: "Quiet Ltd", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: daysFrom(NOW, -400) });
    const result = await runLifecycleSweep(org.id, NOW);
    expect(result.becameDormant).toHaveLength(1);
    expect(await raiseDormantReminders(org.id, result.becameDormant)).toEqual({ notified: 1 });
    await raiseDormantReminders(org.id, result.becameDormant);
    const notes = await adminDb.notification.findMany({ where: { organizationId: org.id, type: "DORMANT_CUSTOMER" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ membershipId: sales.membershipId, entityType: "Company" });
    expect(notes[0]!.body).toContain("400 days");

    await updateReminderSettings(management, { dormant: { enabled: false } });
    expect(await raiseDormantReminders(org.id, [{ companyId: quiet.id, ownerMembershipId: sales.membershipId, eventId: "other", quietDays: 1 }])).toEqual({ notified: 0 });
  });
});

describe("the nightly jobs", () => {
  it("run the lifecycle sweep and the reminders through the job framework", async () => {
    const { org, management, sales, finance } = await setup();
    const company = await createCompanyRow(org.id, { name: "Job Ltd", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) });
    const deal = await createWonDeal(org.id, sales, { companyId: company.id, wonAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) });
    await adminDb.deal.update({ where: { id: deal.id }, data: { lastActivityAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) } });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await createInvoice(management, { number: "JOB-1", amount: 1000, issuedOn: "2026-01-01", dueOn: yesterday, dealId: deal.id, sent: true });

    const lifecycle = await enqueueAndRunNow({ organizationId: org.id, type: "lifecycle.sweep" });
    expect(lifecycle.outcome).toBe("succeeded");
    expect(lifecycle.job?.result).toMatchObject({ toDormant: 1, notified: 1 });
    const reminders = await enqueueAndRunNow({ organizationId: org.id, type: "reminders.sweep" });
    expect(reminders.outcome).toBe("succeeded");
    expect(await typeCount(org.id, "DORMANT_CUSTOMER", sales.membershipId)).toBe(1);
    expect(await typeCount(org.id, "PAYMENT_OVERDUE", finance.membershipId)).toBe(1);

    // Switch the invoice reminder off: the combined run skips it.
    await updateReminderSettings(management, { overdueInvoices: { enabled: false } });
    expect((await runReminders(org.id, new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))).invoices).toEqual({ invoices: 0, notified: 0 });
  });
});
