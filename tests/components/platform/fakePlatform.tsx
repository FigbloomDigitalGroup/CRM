import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Toasts } from "../../../src/ui/screens/platform/kit";
import { ReverifyHost } from "../../../src/ui/screens/platform/Verify";
import { PlatformStoreProvider } from "../../../src/ui/screens/platform/store";
import type { PlatformCall } from "../../../src/ui/screens/platform/api";

/** A stand-in for /api/platform/*: answers the console's reads from fixtures, records every call, and lets a test change any answer. */

export const NOW = new Date("2026-11-05T12:00:00Z");
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 864e5).toISOString();

const counts = (members: number) => ({ members, activeMembers: members, companies: 4, contacts: 9, leads: 3, deals: 2 });

export const fixtures = {
  me: { id: "pa", email: "a@platform.test", name: "Alex Admin", permissionKeys: ["platform.console.view", "platform.organizations.view", "platform.organizations.provision", "platform.organizations.suspend", "platform.data_requests.manage", "platform.admins.manage", "platform.security.manage", "platform.health.manage", "platform.audit.view"] },
  home: {
    organisations: { total: 3, active: 2, suspended: 0, offboarding: 1, offboarded: 0, activeMembers: 9 },
    requests: { open: 2, awaitingApproval: 1, approved: 1 },
    health: { overall: "DEGRADED", components: [{ component: "API", status: "OPERATIONAL" }, { component: "EMAIL", status: "DEGRADED" }], openIncidents: 1 },
    auditLog: { runAt: iso(0), ok: true, rowsChecked: 120, problem: null },
    generatedAt: iso(0),
  },
  orgs: [
    { id: "o1", slug: "figbloom", name: "FigBloom Digital Group", status: "ACTIVE", createdAt: iso(47), counts: counts(7) },
    { id: "o2", slug: "sandbox", name: "Figbloom Sandbox", status: "ACTIVE", createdAt: iso(29), counts: counts(2) },
    { id: "o3", slug: "westlands-pilot", name: "Pilot Westlands Clinics", status: "OFFBOARDING", createdAt: iso(80), counts: counts(3) },
  ],
  requests: [
    {
      id: "dr1", organizationId: "o3", organizationSlug: "westlands-pilot", organizationName: "Pilot Westlands Clinics", kind: "DELETE", status: "SUBMITTED", note: "Pilot ended.", requestedBy: "Amina Yusuf", submittedAt: iso(7),
      approvalsRequired: 2, approvals: [{ approverIdentityId: "pg", approver: "given@platform.test", decision: "APPROVE", comment: null }], retentionDays: 30, deleteAfter: null, export: { status: "NONE", expiresAt: null }, closedReason: null,
    },
    {
      id: "dr2", organizationId: "o1", organizationSlug: "figbloom", organizationName: "FigBloom Digital Group", kind: "EXPORT", status: "SUBMITTED", note: "Backup copy.", requestedBy: "Dev Management", submittedAt: iso(2),
      approvalsRequired: 1, approvals: [], retentionDays: 30, deleteAfter: null, export: { status: "NONE", expiresAt: null }, closedReason: null,
    },
  ],
  admins: {
    items: [
      { id: "pa", email: "a@platform.test", name: "Alex Admin", status: "ACTIVE", twoStepEnabled: true, lastSignInAt: iso(0), locked: false, isYou: true },
      { id: "pg", email: "given@platform.test", name: "Given", status: "ACTIVE", twoStepEnabled: true, lastSignInAt: iso(1), locked: false, isYou: false },
      { id: "pm", email: "michael@platform.test", name: "Michael", status: "ACTIVE", twoStepEnabled: false, lastSignInAt: null, locked: false, isYou: false },
    ],
    invitations: [{ id: "iv1", kind: "INVITE", email: "new@platform.test", expiresAt: new Date(NOW.getTime() + 5 * 864e5).toISOString(), createdAt: iso(1) }],
    activeCount: 3,
    minimumActive: 2,
  },
  health: {
    overall: "DEGRADED", checkedAt: iso(0),
    components: [
      { component: "API", status: "OPERATIONAL", detail: "The API is answering requests.", latencyMs: 4, checkedAt: iso(0) },
      { component: "EMAIL", status: "DEGRADED", detail: "No email provider is configured.", latencyMs: 9, checkedAt: iso(0) },
    ],
    openIncidents: [{ id: "in1", component: "EMAIL", severity: "DEGRADED", title: "Mail provider slow", note: null, startedAt: iso(0), open: true }],
  },
  security: {
    settings: { idleHours: 4, absoluteHours: 12, reverifyMinutes: 15, maxFailedAttempts: 5, lockoutMinutes: 15 },
    limits: {
      idleHours: { label: "Idle sign-out (hours)", min: 1, max: 8, default: 4 },
      absoluteHours: { label: "Longest session (hours)", min: 4, max: 24, default: 12 },
      reverifyMinutes: { label: "How long a verification counts (minutes)", min: 5, max: 60, default: 15 },
      maxFailedAttempts: { label: "Wrong attempts before a lock", min: 3, max: 10, default: 5 },
      lockoutMinutes: { label: "Lock duration (minutes)", min: 5, max: 240, default: 15 },
    },
  },
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly envelope: { message: string; code?: string }) {
    super(envelope.message);
  }
}

export type Handler = (method: string, path: string, body: unknown) => unknown;

export function makeCall(overrides: Handler = () => undefined) {
  const calls: [string, string, unknown][] = [];
  const call = (async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body]);
    const o = overrides(method, path, body);
    if (o !== undefined) {
      if (o instanceof Error) throw o;
      return o;
    }
    const p = path.split("?")[0]!;
    if (p === "/api/platform/me") return fixtures.me;
    if (p === "/api/platform/home") return fixtures.home;
    if (p === "/api/platform/organizations" && method === "GET") return { items: fixtures.orgs, page: 1, pageSize: 100, total: 3, pageCount: 1 };
    if (p === "/api/platform/data-requests" && method === "GET") return { items: fixtures.requests, page: 1, pageSize: 100, total: 2, pageCount: 1 };
    if (p === "/api/platform/admins" && method === "GET") return fixtures.admins;
    if (p === "/api/platform/health") return fixtures.health;
    if (p === "/api/platform/security/settings" && method === "GET") return fixtures.security;
    if (p === "/api/platform/audit") return { items: [], nextCursor: null };
    return {};
  }) as PlatformCall;
  return { call, calls };
}

export function renderConsole(ui: ReactNode, call: PlatformCall) {
  return render(
    <PlatformStoreProvider call={call}>
      {ui}
      <Toasts />
      <ReverifyHost />
    </PlatformStoreProvider>,
  );
}
