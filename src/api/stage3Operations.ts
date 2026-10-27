import { z } from "zod";
import type { OperationDef } from "./openapi";

/**
 * Stage 3 (M3) endpoints in the OpenAPI document (FIG-1057, B3.11): payments, recurring services and renewals, lifecycle,
 * reminders, retention, Customer 360, conversations, quick-log, reports v2 and the company and contact lists.
 *
 * The services behind these routes mask, scope and page their answers by role, so the response schemas describe the
 * shape clients rely on and stay deliberately loose about fields that vary by role (a payments section is `no_access`
 * metadata for a role that may not read it).
 */

const ORG = "/api/orgs/{orgSlug}";
const flag = z.enum(["true", "false"]).optional();
const pageQuery = { page: z.string().optional(), pageSize: z.string().optional(), cursor: z.string().optional() };
const page = (item: z.ZodType) =>
  z.looseObject({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    pageCount: z.number().int(),
    nextCursor: z.string().nullable(),
  });
const money = z.string().describe("A decimal string with two places, such as 1250.50.");
const amount = z.union([z.number(), z.string()]);

const InvoiceSchema = z.looseObject({
  id: z.string(),
  number: z.string(),
  status: z.enum(["DRAFT", "SENT", "PART_PAID", "PAID", "OVERDUE", "VOID"]).describe("OVERDUE is derived from the due date and the unpaid balance, never stored."),
  storedStatus: z.enum(["DRAFT", "SENT", "PART_PAID", "PAID", "VOID"]),
  dealId: z.string().nullable(),
  companyId: z.string(),
  companyName: z.string(),
  amount: money,
  currency: z.string(),
  paidAmount: money,
  balance: money,
  overpaid: money,
  overdue: z.boolean(),
  daysOverdue: z.number().int(),
  issuedOn: z.string(),
  dueOn: z.string(),
  allowOverpayment: z.boolean(),
});

const RecurringServiceSchema = z.looseObject({
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  serviceName: z.string(),
  billingCycle: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  value: money.nullable(),
  valueMasked: z.boolean(),
  renewsOn: z.string(),
  daysToRenewal: z.number().int(),
  state: z.enum(["ACTIVE", "DUE_SOON", "LAPSED", "STARTS_LATER", "CANCELLED"]),
  stateSource: z.enum(["rule", "override"]),
});

const ConversationItemSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(["COMMUNICATION", "ACTIVITY"]),
  channel: z.string(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).nullable(),
  occurredAt: z.string(),
  subject: z.string().nullable(),
  summary: z.string().nullable(),
  needsLinking: z.boolean(),
});

const ConversationAccessSchema = z.looseObject({ canView: z.boolean(), canAct: z.boolean(), readOnly: z.boolean(), notice: z.string().nullable() });

const SectionSchema = z.union([
  z.looseObject({ status: z.literal("ok"), scope: z.string(), data: z.unknown() }),
  z.looseObject({ status: z.literal("no_access"), requires: z.array(z.string()), reason: z.string(), yourRole: z.string(), ownerRoles: z.array(z.string()) }),
  z.looseObject({ status: z.literal("not_available"), reason: z.string() }),
]);

const ReportSchema = z.looseObject({
  key: z.string(),
  title: z.string(),
  definition: z.string(),
  scope: z.enum(["organisation", "own"]),
  valueMasked: z.boolean(),
  chart: z.looseObject({ type: z.enum(["bar", "donut"]), metric: z.string(), series: z.array(z.looseObject({ label: z.string(), value: z.number().nullable() })) }),
  table: z.looseObject({ columns: z.array(z.looseObject({ key: z.string(), label: z.string(), type: z.string() })), rows: z.array(z.record(z.string(), z.unknown())), totals: z.record(z.string(), z.unknown()).nullable() }),
});

const dates = z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() });
const reason = z.strictObject({ reason: z.string() });
const csv = z.string().describe("text/csv");

export const STAGE3_OPERATIONS: OperationDef[] = [
  // --- Payments tracker (FIG-1049, FIG-1050)
  {
    method: "get",
    path: `${ORG}/invoices`,
    operationId: "listInvoices",
    summary: "Payments tracker list with totals by status (Finance and Management only). Overdue is derived from the due date.",
    tags: ["Payments"],
    query: z.object({ status: z.string().optional(), overdue: flag, companyId: z.string().optional(), dealId: z.string().optional(), dueFrom: z.string().optional(), dueTo: z.string().optional(), q: z.string().optional(), sort: z.string().optional(), ...pageQuery }),
    response: page(InvoiceSchema).extend({ totals: z.looseObject({ byStatus: z.record(z.string(), z.looseObject({ count: z.number().int(), amount: money, outstanding: money })), outstanding: money, nothingToCollect: z.boolean() }) }),
    errors: [400, 401, 403],
  },
  {
    method: "post",
    path: `${ORG}/invoices`,
    operationId: "createInvoice",
    summary: "Create an invoice for a company or a won deal. Status only: nothing is processed.",
    tags: ["Payments"],
    body: z.strictObject({ number: z.string(), amount, currency: z.string().optional(), issuedOn: z.string(), dueOn: z.string(), companyId: z.string().optional(), dealId: z.string().optional(), recurringServiceId: z.string().optional(), notes: z.string().optional(), sent: z.boolean().optional() }),
    response: InvoiceSchema,
    idempotent: true,
    errors: [400, 401, 403, 404, 409, 422],
  },
  { method: "get", path: `${ORG}/invoices/{invoiceId}`, operationId: "getInvoice", summary: "One invoice with its payments", tags: ["Payments"], response: InvoiceSchema.extend({ payments: z.array(z.looseObject({ id: z.string(), amount: money, reversed: z.boolean() })) }), errors: [401, 403, 404] },
  { method: "patch", path: `${ORG}/invoices/{invoiceId}`, operationId: "updateInvoice", summary: "Edit an invoice (audited before and after); the amount cannot fall below what was received", tags: ["Payments"], body: z.strictObject({ number: z.string().optional(), amount: amount.optional(), dueOn: z.string().optional(), issuedOn: z.string().optional(), notes: z.string().nullable().optional() }), response: InvoiceSchema, errors: [400, 401, 403, 404] },
  { method: "post", path: `${ORG}/invoices/{invoiceId}/send`, operationId: "markInvoiceSent", summary: "Draft to sent; already sent comes back unchanged", tags: ["Payments"], response: InvoiceSchema, errors: [400, 401, 403, 404] },
  { method: "post", path: `${ORG}/invoices/{invoiceId}/void`, operationId: "voidInvoice", summary: "Void with a reason; refused while payments are recorded against it", tags: ["Payments"], body: reason, response: InvoiceSchema, errors: [400, 401, 403, 404] },
  {
    method: "post",
    path: `${ORG}/invoices/{invoiceId}/payments`,
    operationId: "recordPayment",
    summary: "Record money received. The sum can never exceed the invoice unless `allowOverpayment` is sent.",
    tags: ["Payments"],
    body: z.strictObject({ amount, paidOn: z.string().optional(), methodLabel: z.string().optional(), reference: z.string().optional(), allowOverpayment: z.boolean().optional() }),
    response: InvoiceSchema,
    idempotent: true,
    errors: [400, 401, 403, 404, 422],
    errorNotes: { 400: "`OVERPAYMENT`, `INVOICE_NOT_SENT` or `INVOICE_VOID` in `fieldErrors[].code`." },
  },
  { method: "post", path: `${ORG}/payments/{paymentId}/reverse`, operationId: "reversePayment", summary: "Reverse a payment recorded by mistake, with a reason; the record stays", tags: ["Payments"], body: reason, response: InvoiceSchema, errors: [400, 401, 403, 404] },
  { method: "get", path: `${ORG}/invoices/export`, operationId: "exportInvoices", summary: "CSV of the invoices matching the list filters (Finance and Management; over 500 rows needs export.bulk)", tags: ["Payments"], query: z.object({ status: z.string().optional(), overdue: flag, companyId: z.string().optional(), dealId: z.string().optional(), dueFrom: z.string().optional(), dueTo: z.string().optional(), q: z.string().optional() }), response: csv, errors: [401, 403] },
  { method: "get", path: `${ORG}/payments/summary`, operationId: "getPaymentSummary", summary: "Due this week, overdue, collected this month, still owing", tags: ["Payments"], response: z.looseObject({ dueThisWeek: z.looseObject({ count: z.number().int(), outstanding: money }), overdue: z.looseObject({ count: z.number().int(), outstanding: money }), collectedThisMonth: z.looseObject({ count: z.number().int(), amount: money }), outstanding: money, nothingToCollect: z.boolean() }), errors: [401, 403] },
  { method: "get", path: `${ORG}/payments/deals`, operationId: "listWonDealPayments", summary: "Won deals with invoiced and received totals and the next follow-up note", tags: ["Payments"], query: z.object({ companyId: z.string().optional(), ...pageQuery }), response: page(z.looseObject({ dealId: z.string(), state: z.enum(["NOT_INVOICED", "AWAITING_PAYMENT", "OVERDUE", "PAID_IN_FULL"]) })), errors: [401, 403] },
  { method: "get", path: `${ORG}/deals/{dealId}/payment-note`, operationId: "getDealPaymentNote", summary: "The next follow-up note on a won deal (Finance and Management)", tags: ["Payments"], response: z.looseObject({ note: z.looseObject({ note: z.string() }).nullable() }), errors: [401, 403, 404] },
  { method: "put", path: `${ORG}/deals/{dealId}/payment-note`, operationId: "setDealPaymentNote", summary: "Set the note with an owner and a date", tags: ["Payments"], body: z.strictObject({ note: z.string(), ownerMembershipId: z.string().nullable().optional(), nextOn: z.string().nullable().optional() }), response: z.looseObject({ note: z.string() }), errors: [400, 401, 403, 404] },
  { method: "delete", path: `${ORG}/deals/{dealId}/payment-note`, operationId: "clearDealPaymentNote", summary: "Clear the note", tags: ["Payments"], response: z.looseObject({ cleared: z.boolean() }), errors: [401, 403, 404] },

  // --- Recurring services and renewals (FIG-1051)
  { method: "get", path: `${ORG}/recurring-services`, operationId: "listRecurringServices", summary: "Recurring services with their derived renewal state; the value is masked like a deal's", tags: ["Renewals"], query: z.object({ companyId: z.string().optional(), state: z.string().optional(), ownerMembershipId: z.string().optional(), serviceId: z.string().optional(), ...pageQuery }), response: page(RecurringServiceSchema), errors: [400, 401, 403] },
  { method: "post", path: `${ORG}/recurring-services`, operationId: "createRecurringService", summary: "Add a recurring service for a company", tags: ["Renewals"], body: z.strictObject({ companyId: z.string(), serviceId: z.string(), billingCycle: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).optional(), value: amount.nullable().optional(), currency: z.string().optional(), startsOn: z.string(), renewsOn: z.string(), ownerMembershipId: z.string().nullable().optional(), autoRenew: z.boolean().optional(), notes: z.string().nullable().optional() }), response: RecurringServiceSchema, idempotent: true, errors: [400, 401, 403, 404, 422] },
  { method: "get", path: `${ORG}/recurring-services/{serviceId}`, operationId: "getRecurringService", summary: "One recurring service", tags: ["Renewals"], response: RecurringServiceSchema, errors: [401, 403, 404] },
  { method: "patch", path: `${ORG}/recurring-services/{serviceId}`, operationId: "updateRecurringService", summary: "Edit a recurring service", tags: ["Renewals"], body: z.strictObject({ billingCycle: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).optional(), value: amount.nullable().optional(), startsOn: z.string().optional(), renewsOn: z.string().optional(), ownerMembershipId: z.string().nullable().optional(), autoRenew: z.boolean().optional(), notes: z.string().nullable().optional() }), response: RecurringServiceSchema, errors: [400, 401, 403, 404] },
  { method: "post", path: `${ORG}/recurring-services/{serviceId}/renew`, operationId: "renewRecurringService", summary: "Renew for the next period; optionally also create a renewal task and a draft invoice", tags: ["Renewals"], body: z.strictObject({ task: z.strictObject({ title: z.string().optional(), dueOn: z.string().optional(), assigneeMembershipId: z.string().optional() }).optional(), invoice: z.strictObject({ number: z.string(), amount: amount.optional(), dueOn: z.string().optional() }).optional() }), response: z.looseObject({ service: RecurringServiceSchema, taskId: z.string().nullable(), invoiceId: z.string().nullable() }), idempotent: true, errors: [400, 401, 403, 404, 422] },
  { method: "post", path: `${ORG}/recurring-services/{serviceId}/cancel`, operationId: "cancelRecurringService", summary: "Cancel with a reason", tags: ["Renewals"], body: reason, response: RecurringServiceSchema, errors: [400, 401, 403, 404] },
  { method: "put", path: `${ORG}/recurring-services/{serviceId}/state`, operationId: "overrideRenewalState", summary: "Override the derived state with a reason, or send state null to hand it back to the dates", tags: ["Renewals"], body: z.strictObject({ state: z.enum(["ACTIVE", "DUE_SOON", "LAPSED", "STARTS_LATER"]).nullable(), reason: z.string().optional() }), response: RecurringServiceSchema, errors: [400, 401, 403, 404] },
  { method: "get", path: `${ORG}/renewal-settings`, operationId: "getRenewalSettings", summary: "The due window and the lapse grace", tags: ["Renewals"], response: z.looseObject({ dueSoonDays: z.number().int(), graceDays: z.number().int() }), errors: [401, 403] },
  { method: "put", path: `${ORG}/renewal-settings`, operationId: "updateRenewalSettings", summary: "Change the due window and the lapse grace (Management)", tags: ["Renewals"], body: z.strictObject({ dueSoonDays: z.number().optional(), graceDays: z.number().optional() }), response: z.looseObject({ dueSoonDays: z.number().int(), graceDays: z.number().int() }), errors: [400, 401, 403] },

  // --- Lifecycle (FIG-1048) and reminders (FIG-795)
  { method: "get", path: `${ORG}/companies/{companyId}/lifecycle`, operationId: "getCompanyLifecycle", summary: "The lifecycle state of a company and its history", tags: ["Lifecycle"], response: z.looseObject({ state: z.looseObject({ key: z.string().nullable() }).nullable(), manual: z.boolean(), events: z.array(z.looseObject({ id: z.string(), reason: z.string() })) }), errors: [401, 403, 404] },
  { method: "put", path: `${ORG}/companies/{companyId}/lifecycle`, operationId: "setCompanyLifecycle", summary: "Set the state by hand, with a reason; the daily job then leaves the company alone", tags: ["Lifecycle"], body: z.strictObject({ stateId: z.string().optional(), stateKey: z.string().optional(), reason: z.string() }), response: z.looseObject({ manual: z.boolean() }), errors: [400, 401, 403, 404] },
  { method: "delete", path: `${ORG}/companies/{companyId}/lifecycle`, operationId: "releaseCompanyLifecycle", summary: "Hand the company back to the rules", tags: ["Lifecycle"], response: z.looseObject({ manual: z.boolean() }), errors: [401, 403, 404] },
  { method: "get", path: `${ORG}/reminder-settings`, operationId: "getReminderSettings", summary: "Automatic reminders: each rule's switch and threshold (Management)", tags: ["Reminders"], response: z.looseObject({ proposalFollowUp: z.looseObject({ enabled: z.boolean(), days: z.number().int() }) }), errors: [401, 403] },
  { method: "put", path: `${ORG}/reminder-settings`, operationId: "updateReminderSettings", summary: "Switch rules on or off and set their thresholds. Reminders only tell people; they never decide anything.", tags: ["Reminders"], body: z.strictObject({ proposalFollowUp: z.strictObject({ enabled: z.boolean().optional(), days: z.number().optional() }).optional(), renewal: z.strictObject({ enabled: z.boolean().optional(), daysAhead: z.number().optional() }).optional(), dormant: z.strictObject({ enabled: z.boolean().optional() }).optional(), overdueInvoices: z.strictObject({ enabled: z.boolean().optional() }).optional() }), response: z.looseObject({ proposalFollowUp: z.looseObject({ enabled: z.boolean() }) }), errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/retention`, operationId: "getRenewalsAndRetention", summary: "Renewals and retention: LAPSED, DUE_30, UNANSWERED_PROPOSALS, GOING_QUIET, CROSS_SELL. A customer is in exactly one list; counts match the lists.", tags: ["Renewals"], query: z.object({ list: z.string().optional(), ...pageQuery }), response: z.looseObject({ scope: z.enum(["organisation", "own"]), counts: z.record(z.string(), z.number().int()), total: z.number().int(), lists: z.record(z.string(), page(z.looseObject({ companyId: z.string(), reason: z.string(), list: z.string() }))) }), errors: [400, 401, 403] },

  // --- Customer 360 (FIG-1047)
  { method: "get", path: `${ORG}/companies/{companyId}/360`, operationId: "getCustomer360", summary: "Customer 360: independently loadable sections; a section the role may not read is `no_access` with who owns it", tags: ["Customer 360"], query: z.object({ sections: z.string().optional(), cursor: z.string().optional(), limit: z.string().optional() }), response: z.looseObject({ company: z.looseObject({ id: z.string(), archived: z.boolean(), readOnly: z.boolean() }), sections: z.record(z.string(), SectionSchema), requested: z.array(z.string()) }), errors: [400, 401, 403, 404] },

  // --- Conversations hub (FIG-1053) and quick-log (FIG-1054)
  { method: "get", path: `${ORG}/conversations`, operationId: "listConversations", summary: "Conversations hub: tabs ALL, EMAIL, WHATSAPP, CALLS, MEETINGS, NOTES with a count for each; never lists a message linked to a record the caller cannot open", tags: ["Conversations"], query: z.object({ tab: z.string().optional(), direction: z.string().optional(), ownerMembershipId: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional(), ...pageQuery }), response: page(ConversationItemSchema).extend({ tab: z.string(), tabCounts: z.record(z.string(), z.number().int()), access: ConversationAccessSchema }), errors: [400, 401, 403] },
  { method: "post", path: `${ORG}/conversations`, operationId: "logUnlinkedConversation", summary: "Log a call or message that matches no record; it waits in the Needs-linking queue", tags: ["Conversations"], body: z.strictObject({ channel: z.enum(["EMAIL", "PHONE", "WHATSAPP", "SMS", "MEETING", "OTHER"]), direction: z.enum(["INBOUND", "OUTBOUND"]), summary: z.string(), subject: z.string().optional(), occurredAt: z.string().optional(), counterpartyName: z.string().optional(), counterpartyEmail: z.string().optional(), counterpartyPhone: z.string().optional() }), response: ConversationItemSchema, idempotent: true, errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/conversations/needs-linking`, operationId: "listNeedsLinking", summary: "Messages that matched no record. `access` says whether the caller may act or only read (Delivery reads).", tags: ["Conversations"], query: z.object({ q: z.string().optional(), ...pageQuery }), response: page(ConversationItemSchema).extend({ access: ConversationAccessSchema }), errors: [401, 403] },
  { method: "get", path: `${ORG}/conversations/{conversationId}`, operationId: "getConversation", summary: "One message", tags: ["Conversations"], response: ConversationItemSchema, errors: [401, 403, 404] },
  { method: "post", path: `${ORG}/conversations/{conversationId}/link`, operationId: "linkConversation", summary: "Link a waiting message to a record. Idempotent: the same record again succeeds, a different one is refused.", tags: ["Conversations"], body: z.strictObject({ companyId: z.string().optional(), contactId: z.string().optional(), leadId: z.string().optional(), dealId: z.string().optional() }), response: z.looseObject({ item: ConversationItemSchema, alreadyLinked: z.boolean() }), errors: [400, 401, 403, 404] },
  { method: "post", path: `${ORG}/conversations/{conversationId}/create-lead`, operationId: "createLeadFromConversation", summary: "Turn a waiting message into a lead. May answer `duplicateWarning: true` with the matches; send `confirmDuplicate` to go ahead.", tags: ["Conversations"], body: z.strictObject({ companyId: z.string().optional(), serviceInterestId: z.string().optional(), leadStatusId: z.string().optional(), firstName: z.string().optional(), lastName: z.string().optional(), confirmDuplicate: z.boolean().optional() }), response: z.looseObject({ created: z.boolean() }), errors: [400, 401, 403, 404] },
  { method: "post", path: `${ORG}/conversations/{conversationId}/dismiss`, operationId: "dismissConversation", summary: "Take a message out of the queue, with a reason", tags: ["Conversations"], body: reason, response: z.looseObject({ item: ConversationItemSchema, alreadyDismissed: z.boolean() }), errors: [400, 401, 403, 404] },
  { method: "get", path: `${ORG}/quick-log/prompt`, operationId: "getQuickLogPrompt", summary: "What the call or WhatsApp prompt needs: the number and its tel: and wa.me links, or NO_PHONE_ON_FILE", tags: ["Conversations"], query: z.object({ contactId: z.string().optional(), leadId: z.string().optional(), companyId: z.string().optional(), dealId: z.string().optional() }), response: z.looseObject({ hasPhone: z.boolean(), code: z.string().nullable(), telHref: z.string().nullable(), whatsappHref: z.string().nullable() }), errors: [400, 401, 403, 404] },
  { method: "post", path: `${ORG}/quick-log`, operationId: "quickLog", summary: "One-tap log of a call or WhatsApp message. Send an Idempotency-Key: a double tap logs once.", tags: ["Conversations"], body: z.strictObject({ channel: z.enum(["CALL", "WHATSAPP"]), outcome: z.enum(["REACHED", "NO_ANSWER", "LEFT_MESSAGE"]), note: z.string().optional(), durationSeconds: z.number().optional(), phoneUsed: z.string().optional(), followUp: z.strictObject({ title: z.string(), dueOn: z.string().optional() }).optional(), contactId: z.string().optional(), leadId: z.string().optional(), companyId: z.string().optional(), dealId: z.string().optional() }), response: z.looseObject({ activityId: z.string(), communicationId: z.string(), taskId: z.string().nullable() }), idempotent: true, errors: [400, 401, 403, 404, 422], errorNotes: { 400: "`NO_PHONE_ON_FILE` in `fieldErrors[].code` when the record has no number." } },

  // --- Reports v2 and My metrics (FIG-1055)
  { method: "get", path: `${ORG}/reports/v2`, operationId: "getReportsV2", summary: "Every organisation report as a table with chart series from the same rows (Management)", tags: ["Reports"], query: dates, response: z.looseObject({ reports: z.array(ReportSchema) }), errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/reports/v2/my-metrics`, operationId: "getMyMetricsV2", summary: "My metrics: the caller's own figures only, as cards and a table", tags: ["Reports"], query: dates, response: ReportSchema.extend({ cards: z.array(z.looseObject({ key: z.string(), label: z.string(), definition: z.string() })) }), errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/reports/v2/my-metrics/export`, operationId: "exportMyMetrics", summary: "CSV of My metrics", tags: ["Reports"], query: dates, response: csv, errors: [401, 403] },
  { method: "get", path: `${ORG}/reports/v2/{report}`, operationId: "getReportV2", summary: "One report: LEAD_SOURCES, CONVERSION_BY_SOURCE, CONVERSION_BY_STAGE, PIPELINE_BY_STAGE, LOST_REASONS, PER_PERSON, MONTH_VS_LAST, CUSTOMERS or RENEWALS", tags: ["Reports"], query: dates, response: ReportSchema, errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/reports/v2/{report}/export`, operationId: "exportReportV2", summary: "CSV of one report: the same table; above the bulk-export limit it needs export.bulk", tags: ["Reports"], query: dates, response: csv, errors: [400, 401, 403] },

  // --- Company and contact lists (FIG-1056)
  { method: "get", path: `${ORG}/companies/directory`, operationId: "listCompanyDirectory", summary: "Company list with tabs ALL (archived hidden), DORMANT and ARCHIVED, and filters for lifecycle, service, owner and tag. Each tab's count is what it would list.", tags: ["Companies"], query: z.object({ tab: z.string().optional(), q: z.string().optional(), lifecycle: z.string().optional(), serviceId: z.string().optional(), ownerMembershipId: z.string().optional(), tagId: z.string().optional(), ...pageQuery }), response: page(z.looseObject({ id: z.string(), name: z.string() })).extend({ tab: z.string(), tabCounts: z.record(z.string(), z.number().int()) }), errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/companies/directory/export`, operationId: "exportCompanyDirectory", summary: "CSV of one company tab with the same filters (companies.export; bulk-export rule)", tags: ["Companies"], query: z.object({ tab: z.string().optional(), q: z.string().optional(), lifecycle: z.string().optional(), serviceId: z.string().optional(), ownerMembershipId: z.string().optional(), tagId: z.string().optional() }), response: csv, errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/contacts/directory`, operationId: "listContactDirectory", summary: "Contact list with quality filters (standalone, missing email, missing phone), tag, owner and the archived tab, and a count for each", tags: ["Contacts"], query: z.object({ q: z.string().optional(), companyId: z.string().optional(), ownerMembershipId: z.string().optional(), standalone: flag, missingEmail: flag, missingPhone: flag, archived: flag, tagId: z.string().optional(), ...pageQuery }), response: page(z.looseObject({ id: z.string(), firstName: z.string() })).extend({ counts: z.record(z.string(), z.number().int()) }), errors: [400, 401, 403] },
  { method: "get", path: `${ORG}/contacts/directory/export`, operationId: "exportContactDirectory", summary: "CSV of the contacts matching the directory filters (contacts.export; bulk-export rule)", tags: ["Contacts"], query: z.object({ q: z.string().optional(), companyId: z.string().optional(), ownerMembershipId: z.string().optional(), standalone: flag, missingEmail: flag, missingPhone: flag, archived: flag, tagId: z.string().optional() }), response: csv, errors: [401, 403] },
];
