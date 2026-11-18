/** The API's real response shapes for the Conversations hub and Renewals (src/services/conversationService.ts, retentionService.ts). */
const NOW = Date.now();
export const iso = (daysAgo: number, hours = 0) => new Date(NOW - daysAgo * 86_400_000 - hours * 3_600_000).toISOString();

export function convo(over: Record<string, unknown> & { id: string }) {
  return {
    kind: "COMMUNICATION",
    channel: "WHATSAPP",
    direction: "INBOUND",
    occurredAt: iso(0, 1),
    subject: null,
    summary: "Asking about the Starlink kit",
    durationSeconds: null,
    counterparty: { name: "Chebet Kiprono", email: null, phone: "+254712345605" },
    link: { companyId: "c-1", companyName: "Brookside Dairy", contactId: "p-1", contactName: "Chebet Kiprono", leadId: null, dealId: null },
    ownerMembershipId: "m-1",
    needsLinking: false,
    linkedAt: null,
    dismissedAt: null,
    dismissReason: null,
    ...over,
  };
}

export function waiting(over: Record<string, unknown> & { id: string }) {
  return convo({
    channel: "EMAIL",
    subject: "Quote for CCTV at our depot",
    summary: "Hello, we would like a quote for six cameras.",
    counterparty: { name: "Wanjiru Kamau", email: "wanjiru@depot.co.ke", phone: null },
    link: { companyId: null, companyName: null, contactId: null, contactName: null, leadId: null, dealId: null },
    ownerMembershipId: null,
    needsLinking: true,
    ...over,
  });
}

export const ACCESS_ACT: { canView: boolean; canAct: boolean; readOnly: boolean; notice: string | null } = { canView: true, canAct: true, readOnly: false, notice: null };
export const ACCESS_READ = { canView: true, canAct: false, readOnly: true, notice: "You can read these messages. Linking one to a record, or turning it into a lead, is for Sales and Management." };

export function convoPage(items: unknown[], access: Record<string, unknown> = ACCESS_ACT, extra: Record<string, unknown> = {}) {
  return {
    items,
    page: 1,
    pageSize: 50,
    total: items.length,
    pageCount: 1,
    nextCursor: null,
    tab: "ALL",
    tabCounts: { ALL: items.length, EMAIL: 1, WHATSAPP: 2, CALLS: 0, MEETINGS: 0, NOTES: 0 },
    access,
    ...extra,
  };
}

export function row(over: Record<string, unknown> & { companyId: string; companyName: string; list: string }) {
  return {
    reason: "",
    ownerMembershipId: "m-1",
    lifecycleKey: "ACTIVE_CUSTOMER",
    suggestedAction: { type: "OPEN_COMPANY", label: "Open", path: "/companies/x" },
    service: null,
    proposal: null,
    quietDays: null,
    suggestions: [],
    alsoMatches: [],
    ...over,
  };
}

export function retention(over: Record<string, unknown> = {}) {
  const lists = {
    LAPSED: [],
    DUE_30: [],
    UNANSWERED_PROPOSALS: [
      row({ companyId: "c-2", companyName: "Kileleshwa Property Managers", list: "UNANSWERED_PROPOSALS", reason: "Proposal P-2026-014 was sent 7 days ago and has had no answer.", proposal: { id: "pr-1", number: "P-2026-014", daysSinceSent: 7, dealId: "d-9" }, ownerMembershipId: "m-1" }),
    ],
    GOING_QUIET: [
      row({ companyId: "c-3", companyName: "Hillcrest Preparatory School", list: "GOING_QUIET", reason: "No contact for 52 days; the customer becomes dormant after 90 days.", quietDays: 52, ownerMembershipId: "m-dl" }),
    ],
    CROSS_SELL: [
      row({ companyId: "c-4", companyName: "Greenfield Farms", list: "CROSS_SELL", reason: "3 similar customers in Agriculture use CCTV.", suggestions: [{ serviceId: "sv-9", serviceName: "CCTV", similarCustomers: 3 }, { serviceId: "sv-8", serviceName: "Automation Systems", similarCustomers: 2 }] }),
    ],
  } as Record<string, unknown[]>;
  const page = (items: unknown[]) => ({ items, page: 1, pageSize: 50, total: items.length, pageCount: 1, nextCursor: null });
  const counts = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length]));
  return {
    scope: "organisation",
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    lists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, page(v)])),
    thresholds: { dormancyDays: 90, goingQuietFromDays: 45, proposalFollowUpDays: 5, dueWithinDays: 30, graceDays: 14 },
    ...over,
  };
}

export function service(over: Record<string, unknown> & { id: string }) {
  return {
    companyId: "c-1",
    companyName: "Brookside Dairy",
    serviceId: "sv-1",
    serviceName: "Hosting",
    billingCycle: "YEARLY",
    value: "120000",
    valueMasked: false,
    currency: "KES",
    startsOn: "2025-11-15T00:00:00.000Z",
    renewsOn: new Date(NOW + 12 * 86_400_000).toISOString(),
    daysToRenewal: 12,
    state: "DUE_SOON",
    stateSource: "rule",
    ownerMembershipId: "m-1",
    ...over,
  };
}
