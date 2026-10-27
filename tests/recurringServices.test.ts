import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { addMonths, nextRenewalDate, renewalStanding, renewedUntil } from "../src/lib/renewals";
import { archiveCompany } from "../src/services/companyService";
import { getInvoice } from "../src/services/paymentService";
import {
  cancelRecurringService,
  createRecurringService,
  getRecurringService,
  getRenewalSettings,
  listRecurringServices,
  overrideRenewalState,
  renewRecurringService,
  updateRecurringService,
  updateRenewalSettings,
} from "../src/services/recurringServiceService";
import { createTestContext, createTestOrganization, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, day } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("Recurring");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const company = await createCompanyRow(org.id, { name: "Sarova Hotels", ownerMembershipId: sales.membershipId });
  const serviceId = await getServiceId(org.id, "CRM");
  return { org, management, sales, otherSales, delivery, finance, technical, company, serviceId };
}

async function issues(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("renewal rules (FIG-1051)", () => {
  const today = day("2026-11-10");
  const base = { startsOn: day("2026-01-01"), cancelledAt: null, stateOverride: null };

  it("derives the state from the dates, with the window and grace configurable", () => {
    expect(renewalStanding({ ...base, renewsOn: day("2027-03-01") }, today)).toMatchObject({ state: "ACTIVE", source: "rule" });
    expect(renewalStanding({ ...base, renewsOn: day("2026-12-10") }, today)).toMatchObject({ state: "DUE_SOON", daysToRenewal: 30 });
    expect(renewalStanding({ ...base, renewsOn: day("2026-12-11") }, today).state).toBe("ACTIVE");
    expect(renewalStanding({ ...base, renewsOn: day("2026-11-01") }, today)).toMatchObject({ state: "DUE_SOON", daysToRenewal: -9 }); // inside the grace window
    expect(renewalStanding({ ...base, renewsOn: day("2026-10-27") }, today).state).toBe("DUE_SOON"); // 14 days past: still inside the grace
    expect(renewalStanding({ ...base, renewsOn: day("2026-10-26") }, today).state).toBe("LAPSED"); // 15 days past
    expect(renewalStanding({ ...base, startsOn: day("2026-12-01"), renewsOn: day("2027-12-01") }, today).state).toBe("STARTS_LATER");
    expect(renewalStanding({ ...base, renewsOn: day("2026-12-20") }, today, { dueSoonDays: 60, graceDays: 14 }).state).toBe("DUE_SOON");
    expect(renewalStanding({ ...base, renewsOn: day("2026-10-25") }, today, { dueSoonDays: 30, graceDays: 30 }).state).toBe("DUE_SOON");
  });

  it("lets cancelled win, then a person's override, over the dates", () => {
    const facts = { ...base, renewsOn: day("2026-10-01") };
    expect(renewalStanding({ ...facts, stateOverride: "ACTIVE" }, today)).toMatchObject({ state: "ACTIVE", source: "override" });
    expect(renewalStanding({ ...facts, stateOverride: "ACTIVE", cancelledAt: new Date() }, today)).toMatchObject({ state: "CANCELLED", source: "rule" });
  });

  it("adds a period keeping the day of the month, and a late renewal lands ahead of today", () => {
    expect(addMonths(day("2026-01-31"), 1)).toEqual(day("2026-02-28"));
    expect(addMonths(day("2028-01-31"), 1)).toEqual(day("2028-02-29"));
    expect(nextRenewalDate(day("2026-11-15"), "MONTHLY")).toEqual(day("2026-12-15"));
    expect(nextRenewalDate(day("2026-11-15"), "QUARTERLY")).toEqual(day("2027-02-15"));
    expect(nextRenewalDate(day("2026-11-15"), "YEARLY")).toEqual(day("2027-11-15"));
    expect(renewedUntil(day("2026-11-15"), "YEARLY", today)).toEqual(day("2027-11-15"));
    expect(renewedUntil(day("2026-01-15"), "MONTHLY", today)).toEqual(day("2026-11-15")); // 10 months late: keeps the 15th, lands after today
    expect(renewedUntil(day("2024-03-01"), "YEARLY", today)).toEqual(day("2027-03-01"));
  });
});

describe("recurring services", () => {
  it("Management and Sales manage them; every role with the service view can read them", async () => {
    const { management, sales, delivery, finance, technical, company, serviceId } = await setup();
    const input = { companyId: company.id, serviceId, billingCycle: "YEARLY" as const, value: 120000, startsOn: "2026-01-01", renewsOn: "2026-12-01" };
    await expect(createRecurringService(delivery, input, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRecurringService(finance, input, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createRecurringService(technical, input, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const made = await createRecurringService(sales, input, NOW);
    expect(made).toMatchObject({ companyName: "Sarova Hotels", billingCycle: "YEARLY", state: "DUE_SOON", ownerMembershipId: sales.membershipId, autoRenew: false });
    expect((await createRecurringService(management, { ...input, billingCycle: "MONTHLY", renewsOn: "2027-06-01" }, NOW)).state).toBe("ACTIVE");
    for (const who of [management, sales, delivery, finance]) expect((await getRecurringService(who, made.id, NOW)).id).toBe(made.id);
    await expect(getRecurringService(technical, made.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides the value from roles that may not see values, except the person who owns the service", async () => {
    const { management, sales, otherSales, delivery, finance, company, serviceId } = await setup();
    const made = await createRecurringService(management, { companyId: company.id, serviceId, value: "45000.50", startsOn: "2026-01-01", renewsOn: "2027-01-01", ownerMembershipId: sales.membershipId }, NOW);
    expect(made).toMatchObject({ value: "45000.50", valueMasked: false });
    expect(await getRecurringService(sales, made.id, NOW)).toMatchObject({ value: "45000.50", valueMasked: false });
    expect(await getRecurringService(finance, made.id, NOW)).toMatchObject({ value: "45000.50", valueMasked: false });
    for (const who of [otherSales, delivery]) {
      const view = await getRecurringService(who, made.id, NOW);
      expect(view).toMatchObject({ value: null, valueMasked: true });
      expect(JSON.stringify(view)).not.toContain("45000");
    }
    for (const who of [otherSales, delivery]) {
      const page = await listRecurringServices(who, {}, {}, NOW);
      expect(JSON.stringify(page)).not.toContain("45000");
      expect(page.items[0]).toMatchObject({ value: null, valueMasked: true });
    }
  });

  it("validates the company, service, dates, owner, cycle and value", async () => {
    const { sales, org, company, serviceId } = await setup();
    const input = { companyId: company.id, serviceId, startsOn: "2026-01-01", renewsOn: "2026-12-01" };
    await expect(createRecurringService(sales, { ...input, companyId: "00000000-0000-0000-0000-000000000000" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    expect((await issues(createRecurringService(sales, { ...input, serviceId: "nope" }, NOW)))[0]).toMatchObject({ path: "serviceId" });
    expect((await issues(createRecurringService(sales, { ...input, renewsOn: "2025-12-01" }, NOW)))[0]).toMatchObject({ path: "renewsOn" });
    expect((await issues(createRecurringService(sales, { ...input, billingCycle: "WEEKLY" as never }, NOW)))[0]).toMatchObject({ path: "billingCycle" });
    expect((await issues(createRecurringService(sales, { ...input, value: "-5" }, NOW)))[0]).toMatchObject({ path: "value" });
    expect((await issues(createRecurringService(sales, { ...input, ownerMembershipId: "nobody" }, NOW)))[0]).toMatchObject({ path: "ownerMembershipId" });
    expect((await issues(createRecurringService(sales, { ...input, startsOn: "soon" }, NOW)))[0]).toMatchObject({ path: "startsOn" });
    const archived = await createCompanyRow(org.id, { name: "Gone Ltd" });
    await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await expect(createRecurringService(sales, { ...input, companyId: archived.id }, NOW)).rejects.toMatchObject({ message: expect.stringMatching(/archived/i) });
  });

  it("changes the state by the dates, by a changed window, and by a person's override with a reason", async () => {
    const { management, sales, company, serviceId } = await setup();
    const made = await createRecurringService(sales, { companyId: company.id, serviceId, startsOn: "2026-01-01", renewsOn: "2026-12-20" }, NOW);
    expect(made.state).toBe("ACTIVE");
    expect(await getRenewalSettings(sales)).toEqual({ dueSoonDays: 30, graceDays: 14 });
    await expect(updateRenewalSettings(sales, { dueSoonDays: 60 })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await issues(updateRenewalSettings(management, { dueSoonDays: 0 })))[0]).toMatchObject({ path: "dueSoonDays" });
    expect((await issues(updateRenewalSettings(management, { graceDays: 999 })))[0]).toMatchObject({ path: "graceDays" });
    await updateRenewalSettings(management, { dueSoonDays: 60 });
    expect((await getRecurringService(sales, made.id, NOW)).state).toBe("DUE_SOON");

    expect((await issues(overrideRenewalState(sales, made.id, { state: "LAPSED" }, NOW)))[0]).toMatchObject({ path: "reason" });
    expect((await issues(overrideRenewalState(sales, made.id, { state: "CANCELLED", reason: "x" }, NOW)))[0]).toMatchObject({ path: "state" });
    const overridden = await overrideRenewalState(sales, made.id, { state: "ACTIVE", reason: "Customer confirmed by phone" }, NOW);
    expect(overridden).toMatchObject({ state: "ACTIVE", stateSource: "override", overrideReason: "Customer confirmed by phone" });
    const cleared = await overrideRenewalState(sales, made.id, { state: null }, NOW);
    expect(cleared).toMatchObject({ state: "DUE_SOON", stateSource: "rule", overrideReason: null });
  });

  it("edits, cancels (with a note on the timeline) and refuses changes to a cancelled service", async () => {
    const { sales, delivery, org, company, serviceId } = await setup();
    const made = await createRecurringService(sales, { companyId: company.id, serviceId, value: 1000, startsOn: "2026-01-01", renewsOn: "2027-06-01" }, NOW);
    await expect(updateRecurringService(delivery, made.id, { autoRenew: true }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const edited = await updateRecurringService(sales, made.id, { billingCycle: "QUARTERLY", value: "2000.00", autoRenew: true, notes: "Moved to quarterly" }, NOW);
    expect(edited).toMatchObject({ billingCycle: "QUARTERLY", value: "2000.00", autoRenew: true, notes: "Moved to quarterly" });
    expect((await issues(updateRecurringService(sales, made.id, { renewsOn: "2025-01-01" }, NOW)))[0]).toMatchObject({ path: "renewsOn" });
    expect((await issues(cancelRecurringService(sales, made.id, { reason: " " }, NOW)))[0]).toMatchObject({ path: "reason" });
    const cancelled = await cancelRecurringService(sales, made.id, { reason: "Moved to another provider" }, NOW);
    expect(cancelled).toMatchObject({ state: "CANCELLED", cancelReason: "Moved to another provider" });
    expect((await adminDb.activity.findMany({ where: { organizationId: org.id, companyId: company.id } })).map((a) => a.subject)).toContain("Cancelled: CRM");
    expect((await issues(updateRecurringService(sales, made.id, { autoRenew: false }, NOW)))[0]).toMatchObject({ code: "SERVICE_CANCELLED" });
    expect((await issues(renewRecurringService(sales, made.id, {}, NOW)))[0]).toMatchObject({ code: "SERVICE_CANCELLED" });
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: made.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((e) => e.action)).toEqual(["recurring_service.created", "recurring_service.updated", "recurring_service.cancelled"]);
  });
});

describe("renewing", () => {
  it("moves to the next period, clears an override, logs the activity, and can add a task and a draft invoice", async () => {
    const { sales, finance, management, org, company, serviceId } = await setup();
    const made = await createRecurringService(sales, { companyId: company.id, serviceId, billingCycle: "YEARLY", value: 90000, startsOn: "2025-12-01", renewsOn: "2026-12-01" }, NOW);
    await overrideRenewalState(sales, made.id, { state: "LAPSED", reason: "Looks lapsed" }, NOW);

    const plain = await renewRecurringService(sales, made.id, {}, NOW);
    expect(plain.service).toMatchObject({ state: "ACTIVE", stateSource: "rule", overrideReason: null });
    expect(plain.service.renewsOn).toEqual(day("2027-12-01"));
    expect(plain.service.lastRenewedAt).toEqual(NOW);
    expect((await adminDb.activity.findFirstOrThrow({ where: { organizationId: org.id, subject: "Renewed: CRM" } })).description).toBe("Renewed until 2027-12-01.");

    // Sales can add a task, but not an invoice: payments belong to Finance and Management.
    const withTask = await renewRecurringService(sales, made.id, { task: { title: "Call Sarova about 2028" } }, NOW);
    expect(withTask.taskId).toBeTruthy();
    expect(await adminDb.task.findUniqueOrThrow({ where: { id: withTask.taskId! } })).toMatchObject({ title: "Call Sarova about 2028", assigneeMembershipId: sales.membershipId, companyId: company.id });
    await expect(renewRecurringService(sales, made.id, { invoice: { number: "REN-1" } }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(renewRecurringService(finance, made.id, { task: {} }, NOW)).rejects.toBeInstanceOf(ForbiddenError); // Finance has no task permission, and no service manage either

    const withInvoice = await renewRecurringService(management, made.id, { invoice: { number: "REN-2" } }, NOW);
    expect(withInvoice.invoiceId).toBeTruthy();
    const invoice = await getInvoice(management, withInvoice.invoiceId!, NOW);
    expect(invoice).toMatchObject({ number: "REN-2", amount: "90000.00", status: "DRAFT", recurringServiceId: made.id, companyId: company.id });
  });

  it("needs an amount for the invoice when the service has no value, and refuses a missing or foreign task assignee", async () => {
    const { management, company, serviceId } = await setup();
    const made = await createRecurringService(management, { companyId: company.id, serviceId, startsOn: "2026-01-01", renewsOn: "2026-12-01" }, NOW);
    expect((await issues(renewRecurringService(management, made.id, { invoice: { number: "NOVAL-1" } }, NOW)))[0]).toMatchObject({ path: "invoice.amount" });
    expect((await renewRecurringService(management, made.id, { invoice: { number: "NOVAL-2", amount: "500" } }, NOW)).invoiceId).toBeTruthy();
    await expect(renewRecurringService(management, made.id, { task: { assigneeMembershipId: "00000000-0000-0000-0000-000000000000" } }, NOW)).rejects.toThrow();
  });

  it("a late renewal lands ahead of today", async () => {
    const { sales, company, serviceId } = await setup();
    const made = await createRecurringService(sales, { companyId: company.id, serviceId, billingCycle: "MONTHLY", startsOn: "2025-01-15", renewsOn: "2026-06-15" }, NOW);
    expect(made.state).toBe("LAPSED");
    const renewed = await renewRecurringService(sales, made.id, {}, NOW);
    expect(renewed.service.renewsOn).toEqual(day("2026-11-15"));
    expect(renewed.service.state).toBe("DUE_SOON"); // five days away, inside the due window
  });
});

describe("lists and tenant isolation", () => {
  it("filters by state, company and owner and pages the result; an archived company's services are read-only", async () => {
    const { sales, management, org, company, serviceId } = await setup();
    const mk = (renewsOn: string, extra: Partial<Parameters<typeof createRecurringService>[1]> = {}) =>
      createRecurringService(management, { companyId: company.id, serviceId, startsOn: "2025-01-01", renewsOn, ...extra }, NOW);
    const active = await mk("2027-06-01");
    const due = await mk("2026-11-25");
    const lapsed = await mk("2026-09-01");
    const later = await mk("2027-06-01", { startsOn: "2027-01-01" });
    const cancelled = await mk("2027-06-01");
    await cancelRecurringService(management, cancelled.id, { reason: "gone" }, NOW);

    const ids = async (filters: Parameters<typeof listRecurringServices>[1]) => (await listRecurringServices(management, filters, {}, NOW)).items.map((i) => i.id).sort();
    expect(await ids({ state: "ACTIVE" })).toEqual([active.id].sort());
    expect(await ids({ state: "DUE_SOON" })).toEqual([due.id]);
    expect(await ids({ state: "LAPSED" })).toEqual([lapsed.id]);
    expect(await ids({ state: "STARTS_LATER" })).toEqual([later.id]);
    expect(await ids({ state: "CANCELLED" })).toEqual([cancelled.id]);
    expect(await ids({ ownerMembershipId: sales.membershipId })).toHaveLength(5);
    expect(await ids({ companyId: "00000000-0000-0000-0000-000000000000" })).toEqual([]);
    expect((await issues(listRecurringServices(management, { state: "NOPE" }, {}, NOW)))[0]).toMatchObject({ path: "state" });
    const page = await listRecurringServices(management, {}, { pageSize: 2 }, NOW);
    expect(page).toMatchObject({ total: 5, pageCount: 3 });
    expect(page.items.map((i) => i.renewsOn.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-11-25"]);

    await archiveCompany(management, company.id, { reason: "closed" });
    await expect(updateRecurringService(management, active.id, { autoRenew: true }, NOW)).rejects.toMatchObject({ message: expect.stringMatching(/archived/i) });
    await expect(renewRecurringService(management, active.id, {}, NOW)).rejects.toMatchObject({ message: expect.stringMatching(/archived/i) });
    expect((await getRecurringService(management, active.id, NOW)).id).toBe(active.id);
    void org;
  });

  it("another organisation cannot see or change them, and the database refuses on its own", async () => {
    const a = await setup();
    const b = await setup();
    const made = await createRecurringService(a.management, { companyId: a.company.id, serviceId: a.serviceId, startsOn: "2026-01-01", renewsOn: "2027-01-01" }, NOW);
    await expect(getRecurringService(b.management, made.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateRecurringService(b.management, made.id, { autoRenew: true }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(renewRecurringService(b.management, made.id, {}, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelRecurringService(b.management, made.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createRecurringService(b.management, { companyId: a.company.id, serviceId: b.serviceId, startsOn: "2026-01-01", renewsOn: "2027-01-01" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createRecurringService(b.management, { companyId: b.company.id, serviceId: a.serviceId, startsOn: "2026-01-01", renewsOn: "2027-01-01" }, NOW)).rejects.toMatchObject({ issues: [expect.objectContaining({ path: "serviceId" })] });
    expect((await listRecurringServices(b.management, {}, {}, NOW)).total).toBe(0);
    expect(await withOrgContext(b.org.id, (tx) => tx.recurringService.findMany({ where: { id: made.id } }))).toEqual([]);
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.recurringService.create({ data: { organizationId: a.org.id, companyId: a.company.id, serviceId: a.serviceId, startsOn: day("2026-01-01"), renewsOn: day("2027-01-01") } }),
      ),
    ).rejects.toThrow();
  });
});
