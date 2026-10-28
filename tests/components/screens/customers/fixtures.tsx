/** The real response shapes of the Stage 3 API (see src/services/customer360Service.ts and directoryService.ts), for the customers tests. */

export const STATES = [
  { id: "ls-prospect", key: "PROSPECT", name: "Prospect", sequence: 1, isActive: true },
  { id: "ls-customer", key: "CUSTOMER", name: "Customer", sequence: 2, isActive: true },
  { id: "ls-onboarding", key: "ONBOARDING", name: "Onboarding", sequence: 3, isActive: true },
  { id: "ls-active", key: "ACTIVE_CUSTOMER", name: "Active Customer", sequence: 4, isActive: true },
  { id: "ls-renewal", key: "RENEWAL", name: "Renewal", sequence: 5, isActive: true },
  { id: "ls-dormant", key: "DORMANT_CUSTOMER", name: "Dormant Customer", sequence: 6, isActive: true },
];

export const MEMBERS = [
  { membershipId: "m-sales", userName: "Dev Sales", userEmail: "s@x", roleKey: "SALES", roleName: "Sales", initials: "DS" },
  { membershipId: "m-mg", userName: "Dev Management", userEmail: "m@x", roleKey: "MANAGEMENT", roleName: "Management", initials: "DM" },
];

export const REFERENCE = { lifecycleStates: STATES, members: MEMBERS, services: [], leadStatuses: [], leadSources: [], pipelineStages: [], lostReasons: [] };

export function company(over: Record<string, unknown> = {}) {
  const key = (over.stateKey as string | undefined) ?? "ACTIVE_CUSTOMER";
  const state = STATES.find((s) => s.key === key)!;
  const { stateKey: _unused, ...rest } = over;
  void _unused;
  return {
    id: "c-1",
    organizationId: "o-1",
    name: "Brookside Dairy",
    industry: "Dairy",
    website: "https://brookside.example",
    location: "Nakuru",
    phone: "+254700111222",
    email: "info@brookside.example",
    notes: null,
    ownerMembershipId: "m-sales",
    owner: { id: "m-sales", user: { name: "Dev Sales" } },
    lifecycleStateId: state.id,
    lifecycleState: { id: state.id, key: state.key, name: state.name },
    archivedAt: null,
    mergedIntoId: null,
    _count: { contacts: 2 },
    contacts: [],
    ...rest,
  };
}

export function directory(items: unknown[], over: Record<string, unknown> = {}) {
  return { items, page: 1, pageSize: 25, total: items.length, pageCount: 1, nextCursor: null, tab: "ALL", tabCounts: { ALL: items.length, DORMANT: 1, ARCHIVED: 2 }, ...over };
}

const ok = <T,>(data: T, scope = "organisation") => ({ status: "ok" as const, scope, data });
const denied = (reason: string, ownerRoles: string[] = ["Management"], yourRole = "Sales") => ({ status: "no_access" as const, requires: ["x"], reason, yourRole, ownerRoles });

export interface Three60Options {
  role: "management" | "sales" | "delivery" | "finance";
  archived?: boolean;
  stateKey?: string;
  manual?: boolean;
}

/** What Customer 360 answers for each role (docs/CUSTOMER_360_AND_CONVERSATIONS.md). */
export function threeSixty({ role, archived = false, stateKey = "ACTIVE_CUSTOMER", manual = false }: Three60Options) {
  const state = STATES.find((s) => s.key === stateKey)!;
  const deal = (id: string, stage: string, outcome: string, value: string | null) => ({
    id,
    stage,
    outcome,
    service: "Inventory",
    value,
    valueMasked: value === null,
    currency: "KES",
    expectedCloseDate: null,
    wonAt: outcome === "WON" ? "2026-09-01T00:00:00.000Z" : null,
    lostAt: null,
    archived: false,
    owner: { membershipId: "m-sales", name: "Dev Sales" },
  });
  const maskedValues = role === "delivery";
  const deals =
    role === "finance" || role === "delivery"
      ? ok({ total: 1, items: [deal("d-won", "Closed Won", "WON", maskedValues ? null : "980000")] }, "read-only")
      : ok({ total: 2, items: [deal("d-open", "Proposal Sent", "OPEN", "450000"), deal("d-won", "Closed Won", "WON", "980000")] });
  return {
    company: { id: "c-1", name: "Brookside Dairy", archived, readOnly: archived },
    requested: [],
    sections: {
      profile: ok({
        id: "c-1",
        name: "Brookside Dairy",
        industry: "Dairy",
        website: null,
        location: "Nakuru",
        phone: "+254700111222",
        email: "info@brookside.example",
        notes: null,
        archived,
        archivedAt: archived ? "2026-10-20T00:00:00.000Z" : null,
        archiveReason: null,
        mergedIntoId: null,
        owner: { membershipId: "m-sales", name: "Dev Sales" },
        lifecycle: { state: { id: state.id, key: state.key, name: state.name }, changedAt: "2026-10-01T00:00:00.000Z", manual },
        contacts: [{ id: "p-1", name: "Wanjiru Kamau", email: "w@brookside.example", phone: "+254700333444", jobTitle: "Operations" }],
        tags: [],
        health: { score: 72, band: "HEALTHY", factors: [] },
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      services: ok({
        services: [{ id: "cs-1", serviceId: "sv-1", name: "Inventory", status: "ACTIVE", startDate: "2026-09-02T00:00:00.000Z", endDate: null, notes: "3 depots" }],
        recurring: [{ id: "rs-1", serviceName: "Hosting", billingCycle: "YEARLY", value: role === "finance" || role === "management" ? "60000" : null, valueMasked: !(role === "finance" || role === "management"), currency: "KES", startsOn: "2025-11-20T00:00:00.000Z", renewsOn: "2026-11-20T00:00:00.000Z", daysToRenewal: 23, state: "DUE_SOON", cancelledAt: null, autoRenew: false }],
      }),
      deals,
      tasks:
        role === "finance"
          ? denied("Your role does not work tasks. Finance keeps follow-up notes instead.", ["Management", "Sales"], "Finance")
          : ok({ total: 1, items: [{ id: "t-1", title: "Send revised quote", priority: "HIGH", status: "OPEN", dueAt: "2026-10-27T09:00:00.000Z", assignee: { membershipId: "m-sales", name: "Dev Sales" }, dealId: "d-open" }] }, "own"),
      timeline:
        role === "finance"
          ? denied("Your role cannot read the customer's history.", ["Management", "Sales"], "Finance")
          : ok({ items: [{ kind: "ACTIVITY", id: "a-1", at: "2026-10-26T09:00:00.000Z", title: "Call", detail: "Asked for a revised quote", type: "CALL", outcome: "Reached", authorMembershipId: "m-sales", dealId: null, leadId: null }], nextCursor: null, limit: 25 }),
      handoffs: ok({ items: [{ id: "h-1", dealId: "d-won", status: "ONBOARDING", startDate: null, deliveryOwner: null }] }, "read-only"),
      payments:
        role === "finance" || role === "management"
          ? ok({ totals: { invoiced: "980000", received: "400000", outstanding: "580000", overdueInvoices: 1 }, items: [{ id: "i-1", number: "INV-1042", dealId: "d-won", status: "OVERDUE", amount: "580000", currency: "KES", paid: "0", balance: "580000", dueOn: "2026-10-10T00:00:00.000Z" }], followUpNotes: [{ dealId: "d-won", note: "Chase after the 30th", ownerMembershipId: "m-mg", nextOn: "2026-10-30T00:00:00.000Z" }] })
          : denied("Payments are visible to Finance and Management only.", ["Finance", "Management"], role === "delivery" ? "Delivery" : "Sales"),
      nextFollowUp: role === "finance" ? ok({ next: null }) : ok({ next: { source: "TASK", id: "t-1", title: "Send revised quote", at: "2026-10-27T09:00:00.000Z", overdue: false } }, "own"),
      tickets: { status: "not_available" as const, reason: "Tickets and the satisfaction survey arrive with the Customer Support role (V1.1)." },
    },
  };
}

export const KEYS = {
  management: ["companies.view", "companies.edit", "companies.create", "companies.archive", "companies.merge", "companies.export", "companies.import", "membership.manage", "activities.create", "contacts.create", "tasks.create", "deals.create", "finance.view.payments", "contacts.view"],
  sales: ["companies.view", "companies.edit", "companies.create", "companies.archive", "companies.merge", "activities.create", "contacts.create", "tasks.create", "deals.create"],
  delivery: ["companies.view"],
  finance: ["companies.view", "finance.view.payments"],
};
