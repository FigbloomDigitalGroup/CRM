import { callUncontracted, getCsvText } from "@/ui/data/client";
import { DEFAULT_FLAGS } from "./demo/local";
import type { AuditRow, HealthComponentView, HealthStatus, HomeData, IncidentView, LifecycleRow, OrgStatus, PlatformAdminRow, PlatformInvite, PlatformOrg, PlatformRequest, RequestStatus } from "./model";

/**
 * The Platform console's data layer: calls to `/api/platform/*` (docs/PLATFORM_CONSOLE_API.md) and the mapping of their answers to what the screens show.
 * A platform screen never calls a tenant route; `platformCall` refuses any other path. The platform routes are outside the frozen V1 contract, so they
 * go through the uncontracted call in `@/ui/data/client` (the one place that calls `fetch`).
 */

export type PlatformCall = <T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<T>;
export type CsvCall = (path: string, query?: Record<string, string | undefined>) => Promise<string>;

export const platformCall: PlatformCall = (method, path, body) => {
  if (!path.startsWith("/api/platform/")) throw new Error("A platform screen may only call /api/platform routes.");
  return callUncontracted(method, path, body);
};

export const platformCsv: CsvCall = (path, query) => {
  if (!path.startsWith("/api/platform/")) throw new Error("A platform screen may only call /api/platform routes.");
  return getCsvText(path, query);
};

export function qs(query: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/* Raw shapes ------------------------------------------------------------------------------------------------------------------ */

export interface RawOrgSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  counts: { members: number; activeMembers: number; companies: number; contacts: number; leads: number; deals: number };
}
export interface RawAuditEvent {
  seq: number;
  id: string;
  occurredAt: string;
  actorIdentityId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
}
export interface RawOrgDetail extends RawOrgSummary {
  timezone: string | null;
  defaultCurrency: string | null;
  owner: { name: string | null; email: string; invitePending: boolean } | null;
  lifecycle: { id: string; action: string; from: string | null; to: string | null; reason: string | null; at: string }[];
  dataRequests: { id: string; kind: string; status: string }[];
  recentAudit: RawAuditEvent[];
}
export interface RawRequest {
  id: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  kind: "EXPORT" | "DELETE";
  status: "SUBMITTED" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";
  note: string | null;
  requestedBy: string;
  submittedAt: string;
  approvalsRequired: number;
  approvals: { approverIdentityId: string; approver: string; decision: string; comment: string | null }[];
  retentionDays: number;
  deleteAfter: string | null;
  export: { status: PlatformRequest["exportStatus"]; expiresAt: string | null };
  closedReason: string | null;
}
export interface RawAdmin {
  id: string;
  email: string;
  name: string;
  status: string;
  twoStepEnabled: boolean;
  lastSignInAt: string | null;
  locked: boolean;
  isYou: boolean;
}

/* Mapping --------------------------------------------------------------------------------------------------------------------- */

const ORG_STATUS: Record<string, OrgStatus> = { ACTIVE: "Active", INACTIVE: "Inactive", SUSPENDED: "Suspended", OFFBOARDING: "Offboarding", OFFBOARDED: "Offboarded" };

export function humanise(action: string): string {
  const t = action.replace(/[._]+/g, " ").replace("organization", "organisation").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function mapAudit(e: RawAuditEvent): AuditRow {
  const detail = e.reason ?? Object.entries(e.metadata ?? {}).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
  return {
    id: e.id,
    seq: e.seq,
    at: new Date(e.occurredAt),
    by: e.actorLabel,
    byId: e.actorIdentityId,
    org: e.organizationSlug ?? "—",
    orgId: e.organizationId,
    action: humanise(e.action),
    rawAction: e.action,
    target: e.targetType,
    detail,
    requestId: e.requestId,
  };
}

export function mapOrg(r: RawOrgSummary, d?: RawOrgDetail): PlatformOrg {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: ORG_STATUS[r.status] ?? "Inactive",
    created: new Date(r.createdAt),
    members: r.counts.members,
    activeMembers: r.counts.activeMembers,
    companies: r.counts.companies,
    contacts: r.counts.contacts,
    leads: r.counts.leads,
    deals: r.counts.deals,
    tz: d?.timezone ?? null,
    cur: d?.defaultCurrency ?? null,
    owner: d?.owner ? `${d.owner.name ? `${d.owner.name} · ` : ""}${d.owner.email}` : null,
    invitePending: d?.owner?.invitePending ?? false,
    flags: DEFAULT_FLAGS,
    lifecycle: (d?.lifecycle ?? []).map((l): LifecycleRow => ({ id: l.id, action: l.action, from: l.from, to: l.to, reason: l.reason, at: new Date(l.at) })),
    recentAudit: (d?.recentAudit ?? []).map(mapAudit),
    requestIds: d?.dataRequests ?? [],
  };
}

export function mapRequest(r: RawRequest, now: Date = new Date()): PlatformRequest {
  const approved = r.approvals.filter((a) => a.decision === "APPROVE");
  const received = new Date(r.submittedAt);
  const deleteAfter = r.deleteAfter ? new Date(r.deleteAfter) : null;
  const del = r.kind === "DELETE";
  const status: RequestStatus =
    r.status === "SUBMITTED" ? (approved.length > 0 ? "In review" : "Received") : r.status === "APPROVED" ? "Approved" : r.status === "COMPLETED" ? "Completed" : r.status === "REJECTED" ? "Rejected" : "Cancelled";
  const packaged = r.export.status === "READY" || r.export.status === "EXPIRED";
  const steps: [string, boolean][] = del
    ? [
        ["Request received from the organisation", true],
        ["First platform admin approves", approved.length >= 1],
        ["Second platform admin approves", approved.length >= 2],
        ["Export packaged for the organisation", packaged],
        [`Retention period (${r.retentionDays} days)${deleteAfter ? ` ends ${deleteAfter.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}`, !!deleteAfter && deleteAfter <= now && r.status !== "SUBMITTED"],
        ["Delete organisation data", r.status === "COMPLETED"],
        ["Completion certificate issued", r.status === "COMPLETED"],
      ]
    : [
        ["Request received from the organisation", true],
        ["A platform admin approves", approved.length >= 1],
        ["Export packaged for the organisation", packaged],
      ];
  return {
    id: r.id,
    org: r.organizationId,
    orgName: r.organizationName,
    orgSlug: r.organizationSlug,
    type: del ? "Organisation deletion" : "Data export",
    subject: del ? "Whole organisation" : "Full organisation export",
    requester: r.requestedBy,
    status,
    received,
    due: del ? deleteAfter : null,
    notes: r.note ?? r.closedReason ?? "",
    steps,
    approvals: approved.map((a) => a.approverIdentityId),
    approvalLabels: approved.map((a) => a.approver),
    approvalsRequired: r.approvalsRequired,
    kind: del ? "offboard" : "export",
    exportStatus: r.export.status,
    exportExpiresAt: r.export.expiresAt ? new Date(r.export.expiresAt) : null,
    retentionDays: r.retentionDays,
  };
}

export function mapAdmin(a: RawAdmin): PlatformAdminRow {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    status: a.status,
    tfa: a.twoStepEnabled ? "On" : "Not set up",
    last: a.lastSignInAt ? new Date(a.lastSignInAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never",
    locked: a.locked,
    isYou: a.isYou,
  };
}

export function mapInvite(i: { id: string; email: string; expiresAt: string }): PlatformInvite {
  return { id: i.id, email: i.email, expiresAt: new Date(i.expiresAt) };
}

const HEALTH: Record<string, HealthStatus> = { OPERATIONAL: "Healthy", DEGRADED: "Degraded", DOWN: "Down" };
const COMPONENT_LABEL: Record<string, string> = { API: "API", DATABASE: "Database", JOBS: "Scheduled jobs", EMAIL: "Email delivery", STORAGE: "File storage" };
export const componentLabel = (c: string) => COMPONENT_LABEL[c] ?? humanise(c);
export const healthStatus = (s: string): HealthStatus => HEALTH[s] ?? "Down";

export interface RawHealth {
  overall: string;
  checkedAt: string;
  components: { component: string; status: string; detail: string; latencyMs: number | null; checkedAt: string }[];
  openIncidents: { id: string; component: string; severity: string; title: string; note: string | null; startedAt: string; open: boolean }[];
}

export function mapHealth(h: RawHealth): { components: HealthComponentView[]; incidents: IncidentView[]; checkedAt: Date } {
  return {
    checkedAt: new Date(h.checkedAt),
    components: h.components.map((c) => ({ k: c.component, l: componentLabel(c.component), status: healthStatus(c.status), d: c.detail, latencyMs: c.latencyMs, checkedAt: new Date(c.checkedAt) })),
    incidents: h.openIncidents.map((i) => ({ ...i, startedAt: new Date(i.startedAt) })),
  };
}

/* Fetching -------------------------------------------------------------------------------------------------------------------- */

async function allPages<T>(call: PlatformCall, path: string, query: Record<string, string | number>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call<{ items: T[]; pageCount: number }>("GET", `${path}${qs({ ...query, page, pageSize: 100 })}`);
    out.push(...r.items);
    if (page >= r.pageCount) break;
  }
  return out;
}

export const fetchOrgs = async (call: PlatformCall) => (await allPages<RawOrgSummary>(call, "/api/platform/organizations", { sort: "name" })).map((r) => mapOrg(r));
export const fetchRequests = async (call: PlatformCall) => (await allPages<RawRequest>(call, "/api/platform/data-requests", {})).map((r) => mapRequest(r));
export const fetchOrgDetail = async (call: PlatformCall, id: string) => {
  const d = await call<RawOrgDetail>("GET", `/api/platform/organizations/${encodeURIComponent(id)}`);
  return mapOrg(d, d);
};
export const fetchAdmins = async (call: PlatformCall) => {
  const r = await call<{ items: RawAdmin[]; invitations: { id: string; email: string; expiresAt: string }[]; activeCount: number; minimumActive: number }>("GET", "/api/platform/admins");
  return { admins: r.items.map(mapAdmin), invitations: r.invitations.map(mapInvite), activeCount: r.activeCount, minimumActive: r.minimumActive };
};
export const fetchHome = (call: PlatformCall) => call<HomeData>("GET", "/api/platform/home");
export const fetchMe = (call: PlatformCall) => call<{ id: string; email: string; name: string; permissionKeys: string[] }>("GET", "/api/platform/me");
export const fetchHealth = async (call: PlatformCall) => mapHealth(await call<RawHealth>("GET", "/api/platform/health"));

export interface AuditFilters {
  action?: string;
  organizationId?: string;
  actorIdentityId?: string;
}
export async function fetchAudit(call: PlatformCall, f: AuditFilters, before?: number) {
  const r = await call<{ items: RawAuditEvent[]; nextCursor: number | null }>("GET", `/api/platform/audit${qs({ ...f, before, limit: 50 })}`);
  return { items: r.items.map(mapAudit), nextCursor: r.nextCursor };
}

export interface SecuritySettings {
  settings: Record<string, number>;
  limits: Record<string, { label: string; min: number; max: number; default: number }>;
}
export const fetchSecurity = (call: PlatformCall) => call<SecuritySettings>("GET", "/api/platform/security/settings");

/** Whether the API refused because the admin must verify again (`ReverificationRequiredError`). */
export function needsReverify(error: unknown): boolean {
  const e = error as { status?: number; envelope?: { message?: string } };
  return e?.status === 403 && /^Verify it.s you/i.test(e.envelope?.message ?? "");
}

export function errorText(error: unknown): string {
  const e = error as { status?: number; envelope?: { message?: string } };
  if (e?.status === 403 && !needsReverify(error)) return "Your platform role can’t do that. Ask another platform admin who holds the permission.";
  if (e?.status === 401) return "Your platform session ended. Sign in again.";
  return e?.envelope?.message || "That didn’t work. Try again in a moment.";
}
