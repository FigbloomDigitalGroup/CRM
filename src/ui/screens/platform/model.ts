import type { DemoAnnouncement, DemoSupport, FlagHistoryRow, OrgFlags } from "./demo/local";

/** The console's view of the platform API's records (mapped in api.ts). */

export type OrgStatus = "Active" | "Inactive" | "Suspended" | "Offboarding" | "Offboarded";
export type HealthStatus = "Healthy" | "Degraded" | "Down";
export type RequestStatus = "Received" | "In review" | "Approved" | "Completed" | "Rejected" | "Cancelled";
export type RequestKind = "offboard" | "export";

export interface LifecycleRow {
  id: string;
  action: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  at: Date;
}

export interface AuditRow {
  id: string;
  seq: number;
  at: Date;
  by: string;
  byId: string | null;
  org: string;
  orgId: string | null;
  action: string;
  rawAction: string;
  target: string;
  detail: string;
  requestId: string | null;
}

export interface PlatformOrg {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  created: Date;
  members: number;
  activeMembers: number;
  companies: number;
  contacts: number;
  leads: number;
  deals: number;
  tz: string | null;
  cur: string | null;
  owner: string | null;
  invitePending: boolean;
  flags: OrgFlags;
  lifecycle: LifecycleRow[];
  recentAudit: AuditRow[];
  requestIds: { id: string; kind: string; status: string }[];
}

export interface PlatformRequest {
  id: string;
  org: string;
  orgName: string;
  orgSlug: string;
  type: string;
  subject: string;
  requester: string;
  status: RequestStatus;
  received: Date;
  /** The date deletion may run (offboarding requests); null when the API gives none. */
  due: Date | null;
  notes: string;
  steps: [string, boolean][];
  /** Identity ids of the platform admins who approved. */
  approvals: string[];
  approvalLabels: string[];
  approvalsRequired: number;
  kind: RequestKind;
  exportStatus: "NONE" | "PACKAGING" | "READY" | "FAILED" | "EXPIRED";
  exportExpiresAt: Date | null;
  retentionDays: number;
}

export interface PlatformAdminRow {
  id: string;
  name: string;
  email: string;
  status: string;
  tfa: string;
  last: string;
  locked: boolean;
  isYou: boolean;
}

export interface PlatformInvite {
  id: string;
  email: string;
  expiresAt: Date;
}

export interface HomeData {
  organisations: { total: number; active: number; suspended: number; offboarding: number; offboarded: number; activeMembers: number };
  requests: { open: number; awaitingApproval: number; approved: number };
  health: { overall: string; components: { component: string; status: string }[]; openIncidents: number };
  auditLog: { runAt: string; ok: boolean; rowsChecked: number; problem: string | null } | null;
  generatedAt: string;
}

export interface HealthComponentView {
  k: string;
  l: string;
  status: HealthStatus;
  d: string;
  latencyMs: number | null;
  checkedAt: Date;
}

export interface IncidentView {
  id: string;
  component: string;
  severity: string;
  title: string;
  note: string | null;
  startedAt: Date;
  open: boolean;
}

export interface PlatformState {
  orgs: PlatformOrg[];
  requests: PlatformRequest[];
  admins: PlatformAdminRow[];
  invitations: PlatformInvite[];
  home: HomeData | null;
  /** The signed-in platform admin's identity id. */
  me: string;
  /** V2 pages shown in the navigation. */
  release: "v11" | "v2";
  // Still in memory (no platform API yet): see demo/local.ts.
  support: DemoSupport[];
  announcement: DemoAnnouncement;
  flagHistory: FlagHistoryRow[];
  activeSupport: string | null;
}
