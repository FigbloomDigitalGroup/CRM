import axe from "axe-core";
import { render } from "@testing-library/react";
import { configure } from "@testing-library/react";
import { vi } from "vitest";

import { ApiRequestError, type ApiClient } from "../../../../src/api-client";
import { ApiProvider, MemberProvider, ToastProvider, makeQueryClient, testMember, type Member } from "../../../../src/ui";

// The first render of a screen can be slow on a busy machine; waiting longer never hides a failure, it only stops a slow start being one.
configure({ asyncUtilTimeout: 10_000 });

/**
 * The deals and handoff screens are driven against a stubbed API client: each test says what the API answers per operation, and sees which calls
 * the screen made. (The types come from the frozen contract; this stub only replaces the network.)
 */

export type Handler = (args: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown;

export function stubClient(handlers: Record<string, Handler>) {
  const calls: { id: string; args: Parameters<Handler>[0] }[] = [];
  const call = vi.fn(async (id: string, args: Parameters<Handler>[0] = {}) => {
    calls.push({ id, args });
    const h = handlers[id];
    if (!h) throw apiError(403, "No stub", { code: "FORBIDDEN" });
    const out = await h(args);
    if (out instanceof ApiRequestError) throw out;
    return out;
  });
  return { client: { call, operations: {} } as unknown as ApiClient, calls, call };
}

export function apiError(status: number, message = "Nope", extra: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { error: message, code: status === 403 ? "FORBIDDEN" : "SERVER_ERROR", message, fieldErrors: [], requestId: "req-1", ...extra }, "test");
}

export function renderScreen(ui: React.ReactNode, client: ApiClient, member: Partial<Member> = {}) {
  // No automatic retries in tests: a refusal or a failure should show at once, not after the production back-off.
  const queryClient = makeQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } });
  return render(
    <ApiProvider client={client} queryClient={queryClient}>
      <ToastProvider>
        <MemberProvider value={testMember({ permissionKeys: [], timeZone: "UTC", ...member })}>
          <main>{ui}</main>
        </MemberProvider>
      </ToastProvider>
    </ApiProvider>,
  );
}

export async function violations(root: Element) {
  const result = await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("; ")})`);
}

/* Fixtures ---------------------------------------------------------------------------------------------------------------------- */

export const STAGES = [
  { id: "st-1", key: "SOLUTION_PRESENTED", name: "Solution Presented", sequence: 1, isWon: false, isLost: false, isActive: true },
  { id: "st-2", key: "PROPOSAL_SENT", name: "Proposal Sent", sequence: 2, isWon: false, isLost: false, isActive: true },
  { id: "st-3", key: "NEGOTIATION", name: "Negotiation", sequence: 3, isWon: false, isLost: false, isActive: true },
  { id: "st-won", key: "CLOSED_WON", name: "Closed Won", sequence: 4, isWon: true, isLost: false, isActive: true },
  { id: "st-lost", key: "CLOSED_LOST", name: "Closed Lost", sequence: 5, isWon: false, isLost: true, isActive: true },
];

export const REFERENCE = {
  pipelineStages: STAGES,
  lostReasons: [
    { id: "lr-1", name: "Price" },
    { id: "lr-2", name: "Timing" },
  ],
  services: [{ id: "sv-1", name: "Inventory", isActive: true }],
  members: [
    { membershipId: "m-1", userName: "Dev Sales", userEmail: "s@x", roleKey: "SALES", roleName: "Sales", initials: "DS" },
    { membershipId: "m-dl", userName: "Dev Delivery", userEmail: "d@x", roleKey: "DELIVERY", roleName: "Delivery", initials: "DD" },
    { membershipId: "m-mg", userName: "Dev Management", userEmail: "m@x", roleKey: "MANAGEMENT", roleName: "Management", initials: "DM" },
  ],
};

export function deal(over: Record<string, unknown> & { id: string; stage: (typeof STAGES)[number]; company: string }) {
  const { stage, company, ...rest } = over;
  const s = stage as (typeof STAGES)[number];
  return {
    organizationId: "o-1",
    companyId: `c-${over.id}`,
    primaryContactId: null,
    leadId: null,
    serviceId: "sv-1",
    ownerMembershipId: "m-1",
    pipelineStageId: s.id,
    value: "450000",
    currency: "KES",
    expectedCloseDate: "2026-12-01T00:00:00.000Z",
    outcome: s.isWon ? "WON" : s.isLost ? "LOST" : "OPEN",
    lostReasonId: null,
    notes: "Inventory system for 3 depots.",
    archivedAt: null,
    lastActivityAt: "2026-10-20T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    company: { id: `c-${over.id}`, name: company },
    pipelineStage: s,
    service: { id: "sv-1", name: "Inventory" },
    valueMasked: false,
    signals: { stalled: false, daysSinceActivity: 3, stalledAfterDays: 10, closeDatePassed: false, closeDateOverdueDays: 0 },
    ...rest,
  };
}

export function page(items: unknown[]) {
  return { items, page: 1, pageSize: 100, total: items.length, pageCount: 1, nextCursor: null };
}
