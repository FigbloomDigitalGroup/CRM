import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, daysFrom } from "./helpers/stage3";

// Route handlers resolve the caller from the session cookie; these tests drive the real handlers as whoever `current.ctx` says.
const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) {
      const { UnauthorizedError } = await import("../src/auth/errors");
      throw new UnauthorizedError();
    }
    return current.ctx;
  },
}));

import * as companies360 from "../src/app/api/orgs/[orgSlug]/companies/[companyId]/360/route";
import * as companyLifecycle from "../src/app/api/orgs/[orgSlug]/companies/[companyId]/lifecycle/route";
import * as companyDirectory from "../src/app/api/orgs/[orgSlug]/companies/directory/route";
import * as companyDirectoryExport from "../src/app/api/orgs/[orgSlug]/companies/directory/export/route";
import * as contactDirectory from "../src/app/api/orgs/[orgSlug]/contacts/directory/route";
import * as contactDirectoryExport from "../src/app/api/orgs/[orgSlug]/contacts/directory/export/route";
import * as conversations from "../src/app/api/orgs/[orgSlug]/conversations/route";
import * as conversationOne from "../src/app/api/orgs/[orgSlug]/conversations/[conversationId]/route";
import * as conversationDismiss from "../src/app/api/orgs/[orgSlug]/conversations/[conversationId]/dismiss/route";
import * as conversationLink from "../src/app/api/orgs/[orgSlug]/conversations/[conversationId]/link/route";
import * as conversationLead from "../src/app/api/orgs/[orgSlug]/conversations/[conversationId]/create-lead/route";
import * as needsLinking from "../src/app/api/orgs/[orgSlug]/conversations/needs-linking/route";
import * as dealNote from "../src/app/api/orgs/[orgSlug]/deals/[dealId]/payment-note/route";
import * as invoices from "../src/app/api/orgs/[orgSlug]/invoices/route";
import * as invoiceOne from "../src/app/api/orgs/[orgSlug]/invoices/[invoiceId]/route";
import * as invoicePayments from "../src/app/api/orgs/[orgSlug]/invoices/[invoiceId]/payments/route";
import * as invoiceSend from "../src/app/api/orgs/[orgSlug]/invoices/[invoiceId]/send/route";
import * as invoiceVoid from "../src/app/api/orgs/[orgSlug]/invoices/[invoiceId]/void/route";
import * as invoicesExport from "../src/app/api/orgs/[orgSlug]/invoices/export/route";
import * as paymentReverse from "../src/app/api/orgs/[orgSlug]/payments/[paymentId]/reverse/route";
import * as paymentDeals from "../src/app/api/orgs/[orgSlug]/payments/deals/route";
import * as paymentSummary from "../src/app/api/orgs/[orgSlug]/payments/summary/route";
import * as quickLog from "../src/app/api/orgs/[orgSlug]/quick-log/route";
import * as quickLogPrompt from "../src/app/api/orgs/[orgSlug]/quick-log/prompt/route";
import * as recurring from "../src/app/api/orgs/[orgSlug]/recurring-services/route";
import * as recurringOne from "../src/app/api/orgs/[orgSlug]/recurring-services/[serviceId]/route";
import * as recurringCancel from "../src/app/api/orgs/[orgSlug]/recurring-services/[serviceId]/cancel/route";
import * as recurringRenew from "../src/app/api/orgs/[orgSlug]/recurring-services/[serviceId]/renew/route";
import * as recurringState from "../src/app/api/orgs/[orgSlug]/recurring-services/[serviceId]/state/route";
import * as reminderSettings from "../src/app/api/orgs/[orgSlug]/reminder-settings/route";
import * as renewalSettings from "../src/app/api/orgs/[orgSlug]/renewal-settings/route";
import * as reportsAll from "../src/app/api/orgs/[orgSlug]/reports/v2/route";
import * as reportOne from "../src/app/api/orgs/[orgSlug]/reports/v2/[report]/route";
import * as reportExport from "../src/app/api/orgs/[orgSlug]/reports/v2/[report]/export/route";
import * as myMetrics from "../src/app/api/orgs/[orgSlug]/reports/v2/my-metrics/route";
import * as myMetricsExport from "../src/app/api/orgs/[orgSlug]/reports/v2/my-metrics/export/route";
import * as retention from "../src/app/api/orgs/[orgSlug]/retention/route";

const BASE = "http://localhost/api/orgs/x";

type Handler = (request: Request, context: { params: Promise<any> }) => Promise<Response>;

async function call(ctx: AuthContext | null, handler: Handler, path: string, options: { method?: string; body?: unknown; key?: string; params?: Record<string, string> } = {}) {
  current.ctx = ctx;
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  const res = await handler(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(options.key ? { "idempotency-key": options.key } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }),
    { params: Promise.resolve({ orgSlug: "x", ...(options.params ?? {}) }) },
  );
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text, res };
}

beforeEach(() => {
  current.ctx = null;
});

async function setup() {
  const org = await createTestOrganization("Stage3Api");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const company = await createCompanyRow(org.id, { name: "Api Ltd", ownerMembershipId: sales.membershipId, lifecycleKey: "ACTIVE_CUSTOMER", phone: "0700123456" });
  const deal = await createWonDeal(org.id, sales, { companyId: company.id, value: 100000 });
  return { org, management, sales, delivery, finance, technical, company, deal };
}

describe("payments over HTTP", () => {
  it("answers 401 without a session, the explained 403 to roles without payments, and 400 with field errors for bad input", async () => {
    const f = await setup();
    const none = await call(null, invoices.GET, "/invoices");
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ code: "UNAUTHORIZED" });
    const denied = await call(f.sales, invoices.GET, "/invoices");
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: "FORBIDDEN", denial: { yourRole: "Sales", ownerRoles: ["Finance", "Management"] } });
    for (const who of [f.delivery, f.technical]) expect((await call(who, paymentSummary.GET, "/payments/summary")).status).toBe(403);

    const missing = await call(f.finance, invoices.POST, "/invoices", { body: { amount: 100, issuedOn: "2026-11-01", dueOn: "2026-11-30", dealId: f.deal.id } });
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: expect.arrayContaining([expect.objectContaining({ path: "number" })]) });
    const extra = await call(f.finance, invoices.POST, "/invoices", { body: { number: "X-1", amount: 100, issuedOn: "2026-11-01", dueOn: "2026-11-30", dealId: f.deal.id, status: "PAID" } });
    expect(extra.status).toBe(400);
    const badStatus = await call(f.finance, invoices.GET, "/invoices?status=NOPE");
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.fieldErrors[0]).toMatchObject({ path: "status" });
    expect((await call(f.finance, invoices.GET, "/invoices?sort=password")).status).toBe(400);
  });

  it("creates, edits, sends, receives payments, reverses and voids an invoice; a retry with the same key creates it once", async () => {
    const f = await setup();
    const body = { number: "HTTP-1", amount: 100000, issuedOn: "2026-11-01", dueOn: "2026-12-30", dealId: f.deal.id };
    const first = await call(f.finance, invoices.POST, "/invoices", { body, key: "invoice-key-0001" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ number: "HTTP-1", status: "DRAFT", amount: "100000.00" });
    const again = await call(f.finance, invoices.POST, "/invoices", { body, key: "invoice-key-0001" });
    expect(again.body.id).toBe(first.body.id);
    expect(again.res.headers.get("idempotent-replayed")).toBe("true");
    expect(await adminDb.invoice.count({ where: { organizationId: f.org.id } })).toBe(1);
    const reused = await call(f.finance, invoices.POST, "/invoices", { body: { ...body, number: "HTTP-2" }, key: "invoice-key-0001" });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const id = first.body.id as string;
    const p = { invoiceId: id };
    expect((await call(f.finance, invoiceOne.PATCH, `/invoices/${id}`, { method: "PATCH", body: { notes: "Net 30" }, params: p })).body.notes).toBe("Net 30");
    expect((await call(f.finance, invoicePayments.POST, `/invoices/${id}/payments`, { body: { amount: 10 }, params: p })).body.code).toBe("VALIDATION_FAILED"); // still a draft
    expect((await call(f.finance, invoiceSend.POST, `/invoices/${id}/send`, { method: "POST", params: p })).body.status).toBe("SENT");

    const pay = await call(f.finance, invoicePayments.POST, `/invoices/${id}/payments`, { body: { amount: 40000, methodLabel: "M-Pesa" }, params: p, key: "payment-key-0001" });
    expect(pay.body).toMatchObject({ status: "PART_PAID", paidAmount: "40000.00", balance: "60000.00" });
    const replay = await call(f.finance, invoicePayments.POST, `/invoices/${id}/payments`, { body: { amount: 40000, methodLabel: "M-Pesa" }, params: p, key: "payment-key-0001" });
    expect(replay.body.paidAmount).toBe("40000.00");
    expect(await adminDb.paymentRecord.count({ where: { invoiceId: id } })).toBe(1);
    const over = await call(f.finance, invoicePayments.POST, `/invoices/${id}/payments`, { body: { amount: 60001 }, params: p });
    expect(over.status).toBe(400);
    expect(over.body.fieldErrors[0]).toMatchObject({ path: "amount", code: "OVERPAYMENT" });

    const paymentId = pay.body.payments[0].id as string;
    const rev = await call(f.management, paymentReverse.POST, `/payments/${paymentId}/reverse`, { body: { reason: "Wrong invoice" }, params: { paymentId } });
    expect(rev.body).toMatchObject({ status: "SENT", paidAmount: "0.00" });
    expect((await call(f.finance, invoiceVoid.POST, `/invoices/${id}/void`, { body: { reason: "Raised twice" }, params: p })).body).toMatchObject({ status: "VOID" });
    expect((await call(f.sales, invoiceOne.GET, `/invoices/${id}`, { params: p })).status).toBe(403);
    expect((await call(f.finance, invoiceOne.GET, "/invoices/nope", { params: { invoiceId: "nope" } })).status).toBe(404);
  });

  it("lists with totals and filters, exports CSV, and serves the summary, the by-deal view and the next note", async () => {
    const f = await setup();
    const make = (number: string, dueOn: string, sent = true) => call(f.finance, invoices.POST, "/invoices", { body: { number, amount: 1000, issuedOn: "2026-01-01", dueOn, dealId: f.deal.id, sent } });
    await make("L-1", "2026-02-01");
    await make("L-2", "2099-02-01");
    await make("L-3", "2099-03-01", false);
    const list = await call(f.finance, invoices.GET, "/invoices?overdue=true");
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { number: string }) => i.number)).toEqual(["L-1"]);
    expect(list.body.totals.byStatus.OVERDUE).toEqual({ count: 1, amount: "1000.00", outstanding: "1000.00" });
    expect((await call(f.finance, invoices.GET, "/invoices?pageSize=1")).body).toMatchObject({ pageSize: 1, total: 3, pageCount: 3 });

    const csv = await call(f.finance, invoicesExport.GET, "/invoices/export?status=OVERDUE");
    expect(csv.res.headers.get("content-type")).toContain("text/csv");
    expect(csv.res.headers.get("content-disposition")).toContain("invoices.csv");
    expect(csv.text.split("\n")[0]).toBe("number,company,dealId,status,currency,amount,paid,balance,issuedOn,dueOn,daysOverdue");
    expect(csv.text).toContain("L-1");
    expect(csv.text).not.toContain("L-2");
    expect((await call(f.sales, invoicesExport.GET, "/invoices/export")).status).toBe(403);

    expect((await call(f.finance, paymentSummary.GET, "/payments/summary")).body).toMatchObject({ overdue: { count: 1 } });
    const deals = await call(f.finance, paymentDeals.GET, "/payments/deals");
    expect(deals.body.items[0]).toMatchObject({ dealId: f.deal.id, state: "OVERDUE", invoiceCount: 2 });

    const noteParams = { dealId: f.deal.id };
    expect((await call(f.finance, dealNote.GET, `/deals/${f.deal.id}/payment-note`, { params: noteParams })).body).toEqual({ note: null });
    const put = await call(f.finance, dealNote.PUT, `/deals/${f.deal.id}/payment-note`, { method: "PUT", body: { note: "Call on Monday", nextOn: "2026-11-16" }, params: noteParams });
    expect(put.body).toMatchObject({ note: "Call on Monday" });
    expect((await call(f.sales, dealNote.GET, `/deals/${f.deal.id}/payment-note`, { params: noteParams })).status).toBe(403);
    expect((await call(f.finance, dealNote.DELETE, `/deals/${f.deal.id}/payment-note`, { method: "DELETE", params: noteParams })).body).toEqual({ dealId: f.deal.id, cleared: true });
  });
});

describe("recurring services, lifecycle, retention and Customer 360 over HTTP", () => {
  it("creates, reads, edits, renews, overrides and cancels a recurring service, and changes the renewal settings", async () => {
    const f = await setup();
    const serviceId = await getServiceId(f.org.id, "CRM");
    const body = { companyId: f.company.id, serviceId, billingCycle: "YEARLY", value: 90000, startsOn: "2025-12-01", renewsOn: "2030-12-01" };
    const made = await call(f.sales, recurring.POST, "/recurring-services", { body, key: "recurring-key-001" });
    expect(made.body).toMatchObject({ serviceName: "CRM", value: "90000.00", valueMasked: false, billingCycle: "YEARLY" });
    expect((await call(f.sales, recurring.POST, "/recurring-services", { body, key: "recurring-key-001" })).body.id).toBe(made.body.id);
    expect(await adminDb.recurringService.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect((await call(f.finance, recurring.POST, "/recurring-services", { body })).status).toBe(403);
    expect((await call(f.sales, recurring.POST, "/recurring-services", { body: { ...body, billingCycle: "WEEKLY" } })).status).toBe(400);

    const id = made.body.id as string;
    const p = { serviceId: id };
    expect((await call(f.delivery, recurringOne.GET, `/recurring-services/${id}`, { params: p })).body).toMatchObject({ value: null, valueMasked: true });
    expect((await call(f.sales, recurringOne.PATCH, `/recurring-services/${id}`, { method: "PATCH", body: { autoRenew: true }, params: p })).body.autoRenew).toBe(true);
    const list = await call(f.management, recurring.GET, "/recurring-services?state=ACTIVE");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect((await call(f.management, recurring.GET, "/recurring-services?state=NOPE")).status).toBe(400);

    expect((await call(f.sales, recurringState.PUT, `/recurring-services/${id}/state`, { method: "PUT", body: { state: "LAPSED" }, params: p })).status).toBe(400); // a reason is required
    expect((await call(f.sales, recurringState.PUT, `/recurring-services/${id}/state`, { method: "PUT", body: { state: "LAPSED", reason: "Customer asked to pause" }, params: p })).body).toMatchObject({ state: "LAPSED", stateSource: "override" });
    const renewed = await call(f.sales, recurringRenew.POST, `/recurring-services/${id}/renew`, { method: "POST", params: p });
    expect(renewed.body.service).toMatchObject({ stateSource: "rule" });
    expect(renewed.body.service.renewsOn.slice(0, 10)).toBe("2031-12-01");
    expect((await call(f.sales, recurringCancel.POST, `/recurring-services/${id}/cancel`, { body: { reason: "Moved away" }, params: p })).body).toMatchObject({ state: "CANCELLED" });

    expect((await call(f.sales, renewalSettings.GET, "/renewal-settings")).body).toEqual({ dueSoonDays: 30, graceDays: 14 });
    expect((await call(f.sales, renewalSettings.PUT, "/renewal-settings", { method: "PUT", body: { dueSoonDays: 45 } })).status).toBe(403);
    expect((await call(f.management, renewalSettings.PUT, "/renewal-settings", { method: "PUT", body: { dueSoonDays: 45 } })).body).toEqual({ dueSoonDays: 45, graceDays: 14 });
    expect((await call(f.management, renewalSettings.PUT, "/renewal-settings", { method: "PUT", body: { dueSoonDays: 0 } })).status).toBe(400);
  });

  it("lifecycle history, hand override with a reason and release; reminder settings; retention lists; Customer 360 sections", async () => {
    const f = await setup();
    const lp = { companyId: f.company.id };
    const history = await call(f.sales, companyLifecycle.GET, `/companies/${f.company.id}/lifecycle`, { params: lp });
    expect(history.body).toMatchObject({ state: { key: "ACTIVE_CUSTOMER" }, manual: false, events: [] });
    const renewalState = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: f.org.id, key: "RENEWAL" } });
    expect((await call(f.sales, companyLifecycle.PUT, `/companies/${f.company.id}/lifecycle`, { method: "PUT", body: { stateId: renewalState.id }, params: lp })).status).toBe(400);
    const set = await call(f.sales, companyLifecycle.PUT, `/companies/${f.company.id}/lifecycle`, { method: "PUT", body: { stateId: renewalState.id, reason: "Contract talks started" }, params: lp });
    expect(set.body).toMatchObject({ state: { key: "RENEWAL" }, manual: true, events: [expect.objectContaining({ reason: "MANUAL", note: "Contract talks started" })] });
    expect((await call(f.delivery, companyLifecycle.PUT, `/companies/${f.company.id}/lifecycle`, { method: "PUT", body: { stateId: renewalState.id, reason: "x" }, params: lp })).status).toBe(403);
    expect((await call(f.sales, companyLifecycle.DELETE, `/companies/${f.company.id}/lifecycle`, { method: "DELETE", params: lp })).body.manual).toBe(false);

    expect((await call(f.management, reminderSettings.GET, "/reminder-settings")).body).toMatchObject({ proposalFollowUp: { enabled: true, days: 5 } });
    expect((await call(f.sales, reminderSettings.GET, "/reminder-settings")).status).toBe(403);
    expect((await call(f.management, reminderSettings.PUT, "/reminder-settings", { method: "PUT", body: { dormant: { enabled: false } } })).body.dormant).toEqual({ enabled: false });
    expect((await call(f.management, reminderSettings.PUT, "/reminder-settings", { method: "PUT", body: { proposalFollowUp: { days: 0 } } })).status).toBe(400);

    const r = await call(f.management, retention.GET, "/retention?list=GOING_QUIET");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.lists)).toEqual(["GOING_QUIET"]);
    expect(r.body.counts).toEqual(expect.objectContaining({ LAPSED: 0, DUE_30: 0 }));
    expect((await call(f.management, retention.GET, "/retention?list=NOPE")).status).toBe(400);
    expect((await call(f.finance, retention.GET, "/retention")).status).toBe(403);

    await call(f.finance, invoices.POST, "/invoices", { body: { number: "SECRET-INV-360", amount: 55555, issuedOn: "2026-10-01", dueOn: "2026-10-20", dealId: f.deal.id, sent: true } });
    const c360 = await call(f.sales, companies360.GET, `/companies/${f.company.id}/360`, { params: lp });
    expect(c360.status).toBe(200);
    expect(c360.body.sections.payments).toMatchObject({ status: "no_access", ownerRoles: ["Finance", "Management"] });
    expect(c360.body.sections.deals.status).toBe("ok");
    expect(c360.text).not.toMatch(/SECRET-INV-360|55555/);
    const only = await call(f.finance, companies360.GET, `/companies/${f.company.id}/360?sections=payments,deals`, { params: lp });
    expect(Object.keys(only.body.sections).sort()).toEqual(["deals", "payments"]);
    expect((await call(f.finance, companies360.GET, `/companies/${f.company.id}/360?sections=nope`, { params: lp })).status).toBe(400);
    expect((await call(f.technical, companies360.GET, `/companies/${f.company.id}/360`, { params: lp })).status).toBe(403);
    expect((await call(f.management, companies360.GET, "/companies/missing/360", { params: { companyId: "missing" } })).status).toBe(404);
    expect((await call(f.management, companies360.GET, `/companies/${f.company.id}/360?cursor=junk&sections=timeline`, { params: lp })).status).toBe(400);
  });
});

describe("conversations and quick-log over HTTP", () => {
  it("lists the hub, logs an unlinked call, links it, creates a lead from another, dismisses a third, and refuses a role that may only read", async () => {
    const f = await setup();
    const log = (name: string, phone: string) => call(f.sales, conversations.POST, "/conversations", { body: { channel: "PHONE", direction: "INBOUND", summary: `Call from ${name}`, counterpartyName: name, counterpartyPhone: phone } });
    const a = (await log("Caller A", "0711000001")).body;
    const b = (await log("Caller B", "0711000002")).body;
    const c = (await log("Caller C", "0711000003")).body;
    expect(a).toMatchObject({ needsLinking: true, channel: "PHONE" });
    expect((await call(f.sales, conversations.POST, "/conversations", { body: { channel: "FAX", direction: "INBOUND", summary: "x", counterpartyName: "A" } })).status).toBe(400);

    const queue = await call(f.delivery, needsLinking.GET, "/conversations/needs-linking");
    expect(queue.body.total).toBe(3);
    expect(queue.body.access).toMatchObject({ canAct: false, readOnly: true });
    expect((await call(f.delivery, conversationLink.POST, `/conversations/${a.id}/link`, { body: { companyId: f.company.id }, params: { conversationId: a.id } })).status).toBe(403);

    const linked = await call(f.sales, conversationLink.POST, `/conversations/${a.id}/link`, { body: { companyId: f.company.id }, params: { conversationId: a.id } });
    expect(linked.body).toMatchObject({ alreadyLinked: false, item: { needsLinking: false, link: { companyId: f.company.id } } });
    expect((await call(f.sales, conversationLink.POST, `/conversations/${a.id}/link`, { body: { companyId: f.company.id }, params: { conversationId: a.id } })).body.alreadyLinked).toBe(true);
    expect((await call(f.sales, conversationLink.POST, `/conversations/${b.id}/link`, { body: {}, params: { conversationId: b.id } })).status).toBe(400);

    const lead = await call(f.sales, conversationLead.POST, `/conversations/${b.id}/create-lead`, { method: "POST", body: { firstName: "Brenda" }, params: { conversationId: b.id } });
    expect(lead.body).toMatchObject({ created: true, alreadyCreated: false });
    expect((await call(f.sales, conversationDismiss.POST, `/conversations/${c.id}/dismiss`, { body: {}, params: { conversationId: c.id } })).status).toBe(400);
    expect((await call(f.sales, conversationDismiss.POST, `/conversations/${c.id}/dismiss`, { body: { reason: "Wrong number" }, params: { conversationId: c.id } })).body).toMatchObject({ alreadyDismissed: false });
    expect((await call(f.sales, needsLinking.GET, "/conversations/needs-linking")).body.total).toBe(0);

    const hub = await call(f.sales, conversations.GET, "/conversations?tab=CALLS");
    expect(hub.body.tab).toBe("CALLS");
    expect(hub.body.tabCounts.CALLS).toBe(hub.body.total);
    expect((await call(f.sales, conversations.GET, "/conversations?tab=SPAM")).status).toBe(400);
    expect((await call(f.finance, conversations.GET, "/conversations")).status).toBe(403);
    expect((await call(f.sales, conversationOne.GET, `/conversations/${a.id}`, { params: { conversationId: a.id } })).body.id).toBe(a.id);
    expect((await call(f.sales, conversationOne.GET, "/conversations/missing", { params: { conversationId: "missing" } })).status).toBe(404);
  });

  it("quick-log: a double tap with the same key logs once, no phone gives NO_PHONE_ON_FILE, and the prompt says what to dial", async () => {
    const f = await setup();
    const contact = await adminDb.contact.create({ data: { organizationId: f.org.id, firstName: "Njeri", phone: "0722 333 444", companyId: f.company.id } });
    const silent = await adminDb.contact.create({ data: { organizationId: f.org.id, firstName: "Silent" } });
    const lead = await adminDb.lead.create({ data: { organizationId: f.org.id, contactId: contact.id, companyId: f.company.id, leadStatusId: await getLeadStatusId(f.org.id), ownerMembershipId: f.sales.membershipId } });
    void getPipelineStageId;

    const prompt = await call(f.sales, quickLogPrompt.GET, `/quick-log/prompt?contactId=${contact.id}`);
    expect(prompt.body).toMatchObject({ hasPhone: true, telHref: "tel:+254722333444", whatsappHref: "https://wa.me/254722333444" });
    expect((await call(f.sales, quickLogPrompt.GET, `/quick-log/prompt?contactId=${silent.id}`)).body).toMatchObject({ hasPhone: false, code: "NO_PHONE_ON_FILE" });

    const body = { leadId: lead.id, channel: "CALL", outcome: "REACHED", note: "Wants a quote", durationSeconds: 90, followUp: { title: "Send quote", dueOn: "2026-12-01" } };
    const first = await call(f.sales, quickLog.POST, "/quick-log", { body, key: "double-tap-0001" });
    const second = await call(f.sales, quickLog.POST, "/quick-log", { body, key: "double-tap-0001" });
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.res.headers.get("idempotent-replayed")).toBe("true");
    expect(await adminDb.activity.count({ where: { organizationId: f.org.id, leadId: lead.id, type: "CALL" } })).toBe(1);
    expect(await adminDb.communication.count({ where: { organizationId: f.org.id, leadId: lead.id } })).toBe(1);
    expect(await adminDb.task.count({ where: { organizationId: f.org.id, title: "Send quote" } })).toBe(1);

    const noPhone = await call(f.sales, quickLog.POST, "/quick-log", { body: { contactId: silent.id, channel: "CALL", outcome: "NO_ANSWER" } });
    expect(noPhone.status).toBe(400);
    expect(noPhone.body.fieldErrors[0]).toMatchObject({ code: "NO_PHONE_ON_FILE" });
    expect((await call(f.sales, quickLog.POST, "/quick-log", { body: { contactId: contact.id, channel: "SMS", outcome: "REACHED" } })).status).toBe(400);
    expect((await call(f.sales, quickLog.POST, "/quick-log", { body: { contactId: contact.id, channel: "CALL", outcome: "REACHED", leadId: lead.id } })).status).toBe(400); // two targets
    expect((await call(f.finance, quickLog.POST, "/quick-log", { body: { contactId: contact.id, channel: "CALL", outcome: "REACHED" } })).status).toBe(403);
    expect((await call(null, quickLog.POST, "/quick-log", { body })).status).toBe(401);
  });
});

describe("reports and the company and contact lists over HTTP", () => {
  it("serves the reports with the same numbers in the table and the chart, exports them, and keeps My metrics personal", async () => {
    const f = await setup();
    await adminDb.lead.create({ data: { organizationId: f.org.id, leadStatusId: await getLeadStatusId(f.org.id), ownerMembershipId: f.sales.membershipId, createdAt: daysFrom(new Date(), -2) } });
    const all = await call(f.management, reportsAll.GET, "/reports/v2");
    expect(all.status).toBe(200);
    expect(all.body.reports.map((r: { key: string }) => r.key)).toContain("LEAD_SOURCES");
    for (const report of all.body.reports as { chart: { series: { label: string }[] }; table: { rows: { label: string }[] } }[]) {
      expect(report.chart.series.map((s) => s.label)).toEqual(report.table.rows.map((r) => String(r.label)));
    }
    const one = await call(f.management, reportOne.GET, "/reports/v2/LEAD_SOURCES", { params: { report: "LEAD_SOURCES" } });
    expect(one.body).toMatchObject({ key: "LEAD_SOURCES", scope: "organisation" });
    expect(one.body.table.totals.leads).toBe(1);
    expect((await call(f.management, reportOne.GET, "/reports/v2/SECRET", { params: { report: "SECRET" } })).status).toBe(400);
    expect((await call(f.sales, reportOne.GET, "/reports/v2/LEAD_SOURCES", { params: { report: "LEAD_SOURCES" } })).status).toBe(403);
    expect((await call(f.sales, reportsAll.GET, "/reports/v2")).status).toBe(403);

    const csv = await call(f.management, reportExport.GET, "/reports/v2/LEAD_SOURCES/export", { params: { report: "LEAD_SOURCES" } });
    expect(csv.res.headers.get("content-type")).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toBe("Source,Leads");

    const mine = await call(f.sales, myMetrics.GET, "/reports/v2/my-metrics");
    expect(mine.status).toBe(200);
    expect(mine.body.scope).toBe("own");
    expect(mine.body.cards.find((c: { key: string }) => c.key === "leads").value).toBe(1);
    expect((await call(f.delivery, myMetrics.GET, "/reports/v2/my-metrics")).body.cards.find((c: { key: string }) => c.key === "leads")).toBeUndefined();
    expect((await call(f.technical, myMetrics.GET, "/reports/v2/my-metrics")).status).toBe(403);
    expect((await call(f.sales, myMetricsExport.GET, "/reports/v2/my-metrics/export")).text.split("\n")[0]).toBe("Measure,Value");
  });

  it("lists companies and contacts by tab and quality filter with counts, and exports them under the export permission", async () => {
    const f = await setup();
    await createCompanyRow(f.org.id, { name: "Sleepy Co", lifecycleKey: "DORMANT_CUSTOMER" });
    const archived = await createCompanyRow(f.org.id, { name: "Gone Co" });
    await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await adminDb.contact.create({ data: { organizationId: f.org.id, firstName: "Solo", email: null, phone: null } });
    await adminDb.contact.create({ data: { organizationId: f.org.id, firstName: "Employed", email: "e@x.test", phone: "0700", companyId: f.company.id } });

    const all = await call(f.management, companyDirectory.GET, "/companies/directory");
    expect(all.body.tabCounts).toEqual({ ALL: 2, DORMANT: 1, ARCHIVED: 1 });
    expect(all.body.items.map((c: { name: string }) => c.name).sort()).toEqual(["Api Ltd", "Sleepy Co"]);
    expect((await call(f.management, companyDirectory.GET, "/companies/directory?tab=DORMANT")).body.items.map((c: { name: string }) => c.name)).toEqual(["Sleepy Co"]);
    expect((await call(f.management, companyDirectory.GET, "/companies/directory?tab=ARCHIVED")).body.total).toBe(1);
    expect((await call(f.management, companyDirectory.GET, "/companies/directory?lifecycle=NOPE")).status).toBe(400);
    expect((await call(f.technical, companyDirectory.GET, "/companies/directory")).status).toBe(403);

    const contacts = await call(f.management, contactDirectory.GET, "/contacts/directory?standalone=true&missingEmail=true");
    expect(contacts.body.items.map((c: { firstName: string }) => c.firstName)).toEqual(["Solo"]);
    expect(contacts.body.counts).toMatchObject({ all: 2, standalone: 1, missingEmail: 1, missingPhone: 1 });

    const exported = await call(f.management, companyDirectoryExport.GET, "/companies/directory/export?tab=DORMANT");
    expect(exported.res.headers.get("content-type")).toContain("text/csv");
    expect(exported.text).toContain("Sleepy Co");
    expect(exported.text).not.toContain("Api Ltd");
    expect((await call(f.delivery, companyDirectoryExport.GET, "/companies/directory/export")).status).toBe(403);
    const contactCsv = await call(f.management, contactDirectoryExport.GET, "/contacts/directory/export?standalone=true");
    expect(contactCsv.text).toContain("Solo");
    expect(contactCsv.text).not.toContain("Employed");
  });
});
