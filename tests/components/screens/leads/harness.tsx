import axe from "axe-core";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ApiRequestError, type ApiClient } from "../../../../src/api-client";
import { ApiProvider, MemberProvider, ToastProvider, testMember } from "../../../../src/ui";
import { makeQueryClient } from "../../../../src/ui/data/hooks";

/**
 * Shared set-up for the Leads screens' component tests: the screens are drawn against a stub of the typed client whose answers are written
 * out here, so each test states exactly what the API said and what the screen must do about it.
 */

type Handler = (args: Record<string, unknown>) => unknown;
export type Handlers = Record<string, Handler | object | string | number | boolean | null>;

export const statusRow = (key: string, name: string, sequence: number) => ({ id: `st-${key}`, organizationId: "o", key, name, sequence, isActive: true, createdAt: "", updatedAt: "" });

export const REFERENCE = {
  leadStatuses: [
    statusRow("NEW", "New", 1),
    statusRow("CONTACTED", "Contacted", 2),
    statusRow("NEEDS_IDENTIFIED", "Needs Identified", 3),
    statusRow("QUALIFIED", "Qualified", 4),
    statusRow("UNQUALIFIED", "Unqualified", 5),
    statusRow("CONVERTED", "Converted", 6),
    statusRow("LOST", "Lost", 7),
    statusRow("INACTIVE", "Inactive", 8),
  ],
  leadSources: [statusRow("WEBSITE", "Website", 1), statusRow("PHONE", "Phone", 2)].map((s) => ({ ...s, id: `src-${s.key}` })),
  pipelineStages: [],
  lifecycleStates: [],
  lostReasons: [statusRow("PRICE", "Price", 1), statusRow("NO_RESPONSE", "No response", 2)].map((s) => ({ ...s, id: `lr-${s.key}` })),
  services: [
    { ...statusRow("CCTV", "CCTV", 1), id: "svc-cctv", category: "Security" },
    { ...statusRow("FLEET", "Fleet / GPS", 2), id: "svc-fleet", category: "Tracking" },
  ],
  members: [
    { membershipId: "m-sales", userName: "Dev Sales", userEmail: "s@x", roleKey: "SALES", roleName: "Sales", initials: "DS" },
    { membershipId: "m-mgmt", userName: "Dev Management", userEmail: "m@x", roleKey: "MANAGEMENT", roleName: "Management", initials: "DM" },
    { membershipId: "m-fin", userName: "Dev Finance", userEmail: "f@x", roleKey: "FINANCE", roleName: "Finance", initials: "DF" },
  ],
};

export function leadRow(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? "lead-1";
  return {
    id,
    organizationId: "o",
    companyId: "co-1",
    contactId: "ct-1",
    leadSourceId: "src-PHONE",
    leadStatusId: "st-NEW",
    temperature: "WARM",
    serviceInterestId: "svc-cctv",
    ownerMembershipId: "m-sales",
    qualificationData: null,
    customFields: {},
    tags: [],
    score: { score: 42, band: "WARM", factors: [], computedAt: null },
    lostReasonId: null,
    nextFollowUpAt: null,
    lastContactedAt: null,
    convertedAt: null,
    notes: null,
    createdByMembershipId: "m-sales",
    importSessionId: null,
    archivedAt: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    company: { id: "co-1", name: "Wafula Ltd" },
    contact: { id: "ct-1", firstName: "Amina", lastName: "Wafula", email: "amina@wafula.example", phone: "+254700000001", jobTitle: "Owner" },
    leadStatus: { id: "st-NEW", name: "New", key: "NEW" },
    leadSource: { id: "src-PHONE", name: "Phone", key: "PHONE" },
    archived: false,
    archive: null,
    archivedByMembershipId: null,
    archiveReason: null,
    masked: false,
    scope: "own",
    provisional: false,
    ...over,
  };
}

export function page<T>(items: T[], total = items.length) {
  return { items, page: 1, pageSize: 25, total, pageCount: Math.max(1, Math.ceil(total / 25)), nextCursor: null };
}

export const SALES_KEYS = ["leads.view.own", "leads.view.shared", "leads.claim", "leads.create", "leads.edit.own", "leads.convert", "leads.archive.own", "leads.import", "activities.create", "activities.view", "tasks.create", "tasks.view.own", "companies.create", "deals.view.own"];
export const MGMT_KEYS = ["leads.view.all", "leads.create", "leads.edit.all", "leads.assign", "leads.convert", "leads.archive.all", "leads.import", "leads.export", "export.bulk", "activities.create", "activities.view", "audit.view", "tasks.create", "tasks.view.all", "tasks.assign.any", "companies.create", "deals.view.all", "deals.view.value", "tags.manage"];

/** A stub client: answers from `handlers` (a value, or a function of the call's arguments); anything unlisted answers with a safe empty shape. */
export function stubClient(handlers: Handlers = {}) {
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  const defaults: Handlers = {
    getReferenceData: REFERENCE,
    listLeads: page([]),
    getLeadsPool: page([]),
    getTags: { items: [] },
    getActivities: page([]),
    getTasks: page([]),
    getAudit: [],
    getDeals: page([]),
    listExportApprovals: page([]),
  };
  const call = vi.fn(async (id: string, args: Record<string, unknown> = {}) => {
    calls.push({ id, args });
    const h = id in handlers ? handlers[id] : defaults[id];
    if (h === undefined) return {};
    const out = typeof h === "function" ? await (h as Handler)(args) : h;
    if (out instanceof Error) throw out;
    return out;
  });
  return { client: { call, operations: {} } as unknown as ApiClient, calls, call };
}

export function apiError(status: number, envelope: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { error: "x", code: "X", message: "error", fieldErrors: [], requestId: "req_1", ...envelope } as never, "op");
}

export function renderScreen(ui: React.ReactNode, { keys, handlers, roleName = "Sales", membershipId = "m-sales" }: { keys: string[]; handlers?: Handlers; roleName?: string; membershipId?: string }) {
  const stub = stubClient(handlers);
  const queryClient = makeQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 0 }, mutations: { retry: false } });
  const view = render(
    <ApiProvider client={stub.client} queryClient={queryClient}>
      <ToastProvider>
        <MemberProvider value={testMember({ orgSlug: "figbloom", permissionKeys: keys, roleName, membershipId, userName: roleName === "Sales" ? "Dev Sales" : "Dev Management" })}>{ui}</MemberProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return { ...view, ...stub, queryClient };
}

/** axe over the rendered screen; jsdom has no layout, so colour contrast (covered by the theme engine's own tests) is switched off. */
export async function axeViolations(root: Element): Promise<string[]> {
  const result = await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(" | ")})`);
}
