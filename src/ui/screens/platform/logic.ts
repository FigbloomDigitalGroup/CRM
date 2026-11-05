import { componentLabel, healthStatus } from "./api";
import { DAY, DEFAULT_FLAGS, type DemoSupport } from "./demo/local";
import type { OrgStatus, PlatformOrg, PlatformRequest, PlatformState } from "./model";

/**
 * The console's rules, as pure functions (so they are unit-tested). Reads and writes that touch the platform go through `./api.ts` and the store;
 * what stays here is what the design and the issues fix:
 *  - at least two platform admins always exist (FIG-1163; the API enforces it too);
 *  - deleting data needs two different platform admins (FIG-1162; the API enforces it too);
 *  - suspend, reactivate and offboard need a reason and the organisation's name typed back (PL5);
 *  - support access is read-only, time-limited and ends on its own (FIG-1192, still in memory: no platform API yet).
 */

export const MIN_ADMINS = 2;

export type Tone = { bg: string; fg: string };

const TONES: Record<string, Tone> = {
  Active: { bg: "var(--pl-primary-soft)", fg: "var(--pl-primary-text)" },
  Suspended: { bg: "var(--pl-red-soft)", fg: "var(--pl-red)" },
  Offboarding: { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  Offboarded: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
  Inactive: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
  Healthy: { bg: "var(--pl-primary-soft)", fg: "var(--pl-primary-text)" },
  Degraded: { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  Down: { bg: "var(--pl-red-soft)", fg: "var(--pl-red)" },
  Received: { bg: "var(--pl-blue-soft)", fg: "var(--pl-blue)" },
  "In review": { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  Approved: { bg: "var(--pl-blue-soft)", fg: "var(--pl-blue)" },
  Completed: { bg: "var(--pl-primary-soft)", fg: "var(--pl-primary-text)" },
  Rejected: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
  Cancelled: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
  "Pending organisation approval": { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  ActiveSession: { bg: "#ff9400", fg: "#1b1d1a" },
  Ended: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
  Denied: { bg: "var(--pl-red-soft)", fg: "var(--pl-red)" },
  Expired: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
};

export function tone(status: string): Tone {
  return TONES[status] ?? { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" };
}

/** A support session that is running uses its own (amber) tone, not the green "Active" of an organisation. */
export function supportTone(s: DemoSupport): Tone {
  return s.status === "Active" ? TONES.ActiveSession! : tone(s.status);
}

/* Slugs and the provisioning wizard ------------------------------------------------------------------------------------------- */

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type SlugState = "empty" | "invalid" | "taken" | "ok";

export function slugState(slug: string, taken: readonly string[] = []): SlugState {
  if (!slug) return "empty";
  if (!/^[a-z0-9-]{3,}$/.test(slug)) return "invalid";
  return taken.includes(slug) ? "taken" : "ok";
}

export const SLUG_MESSAGES: Record<SlugState, string> = {
  empty: "Used in the address: crm.figbloom.co.ke/<slug>",
  invalid: "Lowercase letters, numbers and hyphens only",
  taken: "Taken. Try another.",
  ok: "Available",
};

export interface WizardForm {
  name: string;
  slug: string;
  ownerName: string;
  email: string;
}

export const EMPTY_WIZARD: WizardForm = { name: "", slug: "", ownerName: "", email: "" };
export const WIZARD_STEPS = ["Name", "First admin", "Defaults", "Review"] as const;

/** Editing the name keeps the slug in step until the person edits the slug themselves. */
export function applyWizardField(form: WizardForm, key: keyof WizardForm, value: string): WizardForm {
  const next = { ...form, [key]: value };
  if (key === "name" && (!form.slug || form.slug === slugify(form.name))) next.slug = slugify(value);
  return next;
}

/** The message for a wizard step that cannot continue, or "" (the design's exact wording). */
export function wizardStepError(step: number, form: WizardForm, takenSlugs: readonly string[] = []): string {
  if (step === 0) {
    if (!form.name.trim()) return "Give the organisation a name.";
    const s = slugState(form.slug, takenSlugs);
    if (s === "empty" || s === "invalid") return "Slugs use lowercase letters, numbers and hyphens (3+).";
    if (s === "taken") return "That slug is taken. Choose another.";
  }
  if (step === 1) {
    if (!form.ownerName.trim()) return "Enter the first admin’s name.";
    if (!/.+@.+\..+/.test(form.email)) return "Enter the first admin’s email.";
  }
  return "";
}

/* Admins ---------------------------------------------------------------------------------------------------------------------- */

export type Check = { ok: true } | { ok: false; reason: string };

/** "At least two platform admins are required" and "ask another admin to remove you" (FIG-1163: the second-last admin cannot be removed). */
export function canRemoveAdmin(admins: readonly { id: string; status?: string }[], meId: string, targetId: string): Check {
  const target = admins.find((a) => a.id === targetId);
  const active = admins.filter((a) => !a.status || a.status === "ACTIVE").length;
  if (targetId === meId) return { ok: false, reason: "Ask another admin to remove you." };
  if ((!target?.status || target.status === "ACTIVE") && active <= MIN_ADMINS) return { ok: false, reason: "Blocked: at least two platform admins are required." };
  return { ok: true };
}

export function adminEmailOk(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

/** The name an invite carries when the form asks for the email only: the part before the @, in words. */
export function nameFromEmail(email: string): string {
  return email.split("@")[0]!.split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || email;
}

export function initials(name: string): string {
  return name.replace("Dev ", "").split(" ").map((w) => w[0] ?? "").join("").slice(0, 2);
}

/* Data requests and the approval rule ------------------------------------------------------------------------------------------ */

export const isPending = (r: PlatformRequest) => ["Received", "In review", "Approved"].includes(r.status);
/** A request that has not yet reached the number of approvals it needs (an export needs one, a deletion two different admins). */
export const hasAllApprovals = (r: PlatformRequest) => new Set(r.approvals).size >= r.approvalsRequired;
export const awaitingApproval = (r: PlatformRequest) => (r.status === "Received" || r.status === "In review") && !hasAllApprovals(r);

export function canApprove(r: PlatformRequest, adminId: string): Check {
  if (r.status !== "Received" && r.status !== "In review") return { ok: false, reason: "This request is no longer waiting for a decision." };
  if (hasAllApprovals(r)) return { ok: false, reason: "Already approved." };
  if (r.approvals.includes(adminId)) return { ok: false, reason: "You already approved this. A different admin must approve it." };
  return { ok: true };
}

export function retentionDaysLeft(r: PlatformRequest, now: Date): number {
  if (!r.due) return r.retentionDays;
  return Math.max(0, Math.ceil((r.due.getTime() - now.getTime()) / DAY));
}

/** Deletion can run once approved, the retention period is over and the export is packaged. */
export function canRunDeletion(r: PlatformRequest, now: Date): Check {
  if (r.kind !== "offboard" || r.status !== "Approved") return { ok: false, reason: "Only an approved deletion request can run." };
  if (r.due && r.due > now) return { ok: false, reason: `Retention period: ${retentionDaysLeft(r, now)} more days.` };
  if (r.exportStatus !== "READY" && r.exportStatus !== "EXPIRED") return { ok: false, reason: "The export is not packaged yet." };
  return { ok: true };
}

export function dueLabel(due: Date | null, now: Date): string {
  if (!due) return "";
  const days = Math.round((due.getTime() - now.getTime()) / DAY);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/* Organisations ---------------------------------------------------------------------------------------------------------------- */

export type OrgSort = "name" | "created" | "members";

export function filterOrgs(orgs: readonly PlatformOrg[], q: string, status: string, sort: OrgSort): PlatformOrg[] {
  const needle = q.toLowerCase();
  const rows = orgs.filter((o) => (!needle || `${o.name}${o.slug}`.toLowerCase().includes(needle)) && (!status || o.status === status));
  return [...rows].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "members" ? b.members - a.members : b.created.getTime() - a.created.getTime()));
}

/** Search in the top bar covers organisation names only. */
export function searchOrgs(orgs: readonly PlatformOrg[], q: string): PlatformOrg[] {
  const needle = q.trim().toLowerCase();
  return needle ? orgs.filter((o) => o.name.toLowerCase().includes(needle)) : [];
}

export interface OrgDialogKind {
  title: (name: string) => string;
  effects: string[];
  cta: string;
  danger: boolean;
  to: OrgStatus;
}

export const ORG_DIALOGS: Record<"suspend" | "reactivate" | "offboard", OrgDialogKind> = {
  suspend: {
    title: (n) => `Suspend ${n}?`,
    effects: ["All sessions end now and members can’t sign in.", "Data is kept exactly as it is.", "Website enquiries are rejected with a polite “try again later” reply.", "You can reactivate at any time."],
    cta: "Suspend organisation", danger: true, to: "Suspended",
  },
  reactivate: {
    title: (n) => `Reactivate ${n}?`,
    effects: ["Members can sign in again straight away.", "The website endpoint accepts enquiries again."],
    cta: "Reactivate", danger: false, to: "Active",
  },
  offboard: {
    title: (n) => `Start offboarding ${n}?`,
    effects: ["Sign-in is suspended for the organisation.", "Data is deleted only after a deletion request is approved by two platform admins and the retention period has passed.", "The organisation’s Management users can request their export and deletion from their own settings."],
    cta: "Start offboarding", danger: true, to: "Offboarding",
  },
};

/** A dialog confirms only with a reason (5 to 500 characters, as the API requires) and the organisation's exact name typed back (PL5). */
export function dialogValid(reason: string, typed: string, orgName: string): boolean {
  const r = reason.trim();
  return r.length >= 5 && r.length <= 500 && typed === orgName;
}

/* Home ------------------------------------------------------------------------------------------------------------------------ */

export interface AttentionItem {
  key: string;
  title: string;
  sub: string;
  dot: "orange" | "red" | "blue";
  go: { page: "health" | "data-requests" | "audit"; requestId?: string };
  mobileTab: "health" | "approvals";
}

export function attentionItems(s: PlatformState): AttentionItem[] {
  const out: AttentionItem[] = [];
  const home = s.home;
  if (home) {
    for (const c of home.health.components.filter((x) => x.status !== "OPERATIONAL")) {
      const st = healthStatus(c.status);
      out.push({ key: `h-${c.component}`, title: `${componentLabel(c.component)} · ${st}`, sub: "Open System health for the detail.", dot: st === "Down" ? "red" : "orange", go: { page: "health" }, mobileTab: "health" });
    }
    if (home.health.openIncidents > 0) out.push({ key: "incidents", title: `${home.health.openIncidents} open incident${home.health.openIncidents === 1 ? "" : "s"}`, sub: "Marked on System health.", dot: "orange", go: { page: "health" }, mobileTab: "health" });
    if (home.auditLog && !home.auditLog.ok) out.push({ key: "audit", title: "Audit log verification failed", sub: home.auditLog.problem ?? "The chain did not verify.", dot: "red", go: { page: "audit" }, mobileTab: "health" });
  }
  for (const r of s.requests.filter(awaitingApproval)) {
    out.push({ key: `r-${r.id}`, title: `${r.type} · ${r.orgName}`, sub: `Waiting for ${r.approvalsRequired - r.approvals.length} more approval${r.approvalsRequired - r.approvals.length === 1 ? "" : "s"} from a different platform admin`, dot: "red", go: { page: "data-requests", requestId: r.id }, mobileTab: "approvals" });
  }
  return out;
}

export function homeTiles(s: PlatformState) {
  const h = s.home;
  if (!h) return [];
  const bad = h.health.components.filter((c) => c.status !== "OPERATIONAL").length;
  const log = h.auditLog;
  return [
    { key: "orgs", l: "Organisations", v: String(h.organisations.total), sub: `${h.organisations.active} active · ${h.organisations.suspended} suspended · ${h.organisations.offboarding} offboarding`, dot: "purple", go: "organisations" },
    { key: "users", l: "Active members", v: String(h.organisations.activeMembers), sub: "across active organisations", dot: "primary", go: "organisations" },
    { key: "pending", l: "Open data requests", v: String(h.requests.open), sub: `${h.requests.awaitingApproval} awaiting approval · ${h.requests.approved} approved`, dot: "blue", go: "data-requests" },
    { key: "health", l: "System health", v: healthStatus(h.health.overall), sub: bad ? `${bad} component${bad === 1 ? "" : "s"} need attention` : "all components answering", dot: bad ? "orange" : "primary", warn: bad > 0, go: "health" },
    { key: "inc", l: "Open incidents", v: String(h.health.openIncidents), sub: "marked on System health", dot: h.health.openIncidents ? "orange" : "primary", warn: h.health.openIncidents > 0, go: "health" },
    { key: "audit", l: "Audit log", v: log ? (log.ok ? "Intact" : "Check failed") : "Not checked", sub: log ? `${log.rowsChecked.toLocaleString("en-GB")} entries checked` : "no verification yet", dot: log && !log.ok ? "red" : "primary", warn: !!log && !log.ok, go: "audit" },
  ];
}

/* Support sessions (in memory: no platform API yet) --------------------------------------------------------------------------- */

export const SUPPORT_SCOPES = ["Settings and health (read-only)", "Leads (read-only)", "Deals (read-only)", "Companies and contacts (read-only)"];

export function supportMsLeft(s: DemoSupport | undefined, now: Date): number {
  return s?.endsAt ? Math.max(0, s.endsAt.getTime() - now.getTime()) : 0;
}

export function countdown(ms: number): string {
  const m = Math.floor(ms / 60000);
  const sec = Math.floor(ms / 1000) % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* Verify it's you (PL14) ------------------------------------------------------------------------------------------------------ */

export const VERIFY_ATTEMPTS = 5;

/** The shape check before a code is sent: 6 digits, or a backup code like XXXX-XXXX. The API decides whether it is right. */
export function verifyShapeOk(raw: string, backup: boolean): boolean {
  const c = raw.replace(/\s/g, "");
  return backup ? /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(c) : /^\d{6}$/.test(c);
}

/** The demo rule of the stand-alone verify page (no real platform sign-in yet): any well-formed code except 000000. */
export function verifyCode(raw: string, backup: boolean): boolean {
  return verifyShapeOk(raw, backup) && raw.replace(/\s/g, "") !== "000000";
}

/* The in-memory actions (support access, flags and limits, announcements) ------------------------------------------------------ */

export type Action =
  | { type: "release"; value: "v11" | "v2" }
  | { type: "support-request"; org: string; reason: string; ticket: string; mins: number; scope: string; mask: boolean }
  | { type: "support-approve"; id: string }
  | { type: "support-end"; id: string }
  | { type: "support-expire"; id: string }
  | { type: "flag"; org: string; flag: "assistant" | "integrations" }
  | { type: "limit"; org: string; limit: "importLimit" | "seats"; value: number }
  | { type: "announcement"; patch: Partial<PlatformState["announcement"]> }
  | { type: "announcement-publish" }
  | { type: "announcement-expire" };

export type Result = { ok: true; message?: string; id?: string } | { ok: false; message: string };

function mapOrg(s: PlatformState, id: string, fn: (o: PlatformOrg) => PlatformOrg): PlatformState {
  return { ...s, orgs: s.orgs.map((o) => (o.id === id ? fn(o) : o)) };
}

/** One in-memory state change. Returns the new state and what to tell the person (a toast), or a refusal with the reason. Never mutates `s`. */
export function apply(s: PlatformState, a: Action, now: Date = new Date()): { state: PlatformState; result: Result } {
  const refuse = (message: string) => ({ state: s, result: { ok: false, message } as Result });
  const done = (state: PlatformState, message?: string, id?: string) => ({ state, result: { ok: true, message, id } as Result });

  switch (a.type) {
    case "release":
      return done({ ...s, release: a.value });

    case "support-request": {
      if (!a.reason.trim()) return refuse("Add a reason first");
      const req: DemoSupport = { id: `ss${now.getTime()}`, org: a.org, by: s.me, reason: a.reason, ticket: a.ticket || "—", scope: a.scope, mins: a.mins, mask: a.mask, status: "Pending organisation approval", at: now };
      return done({ ...s, support: [req, ...s.support] }, "Sent. The organisation’s Management users must approve.");
    }

    case "support-approve": {
      const x = s.support.find((p) => p.id === a.id);
      if (!x || x.status !== "Pending organisation approval") return refuse("That request is not waiting for approval.");
      return done({ ...s, activeSupport: a.id, support: s.support.map((p) => (p.id === a.id ? { ...p, status: "Active" as const, endsAt: new Date(now.getTime() + p.mins * 60000), pages: [] } : p)) });
    }

    case "support-end": {
      const x = s.support.find((p) => p.id === a.id);
      if (!x) return refuse("That session no longer exists.");
      return done({ ...s, activeSupport: s.activeSupport === a.id ? null : s.activeSupport, support: s.support.map((p) => (p.id === a.id ? { ...p, status: "Ended" as const, endedBy: "You" } : p)) });
    }

    case "support-expire":
      return done({ ...s, activeSupport: s.activeSupport === a.id ? null : s.activeSupport, support: s.support.map((p) => (p.id === a.id ? { ...p, status: "Expired" as const } : p)) });

    case "flag": {
      const org = s.orgs.find((o) => o.id === a.org);
      if (!org) return refuse("That organisation no longer exists.");
      const label = a.flag === "assistant" ? "Assistant" : "Integrations";
      const on = !org.flags[a.flag];
      const next = mapOrg(s, a.org, (o) => ({ ...o, flags: { ...o.flags, [a.flag]: on } }));
      return done({ ...next, flagHistory: [["Just now", "You", org.name, label, on ? "Off → On" : "On → Off"], ...next.flagHistory] });
    }

    case "limit": {
      const org = s.orgs.find((o) => o.id === a.org);
      if (!org) return refuse("That organisation no longer exists.");
      const value = Math.max(0, Math.round(a.value) || 0);
      const label = a.limit === "importLimit" ? "Import size limit" : "Seat limit";
      const before = org.flags[a.limit];
      if (before === value) return done(s);
      const next = mapOrg(s, a.org, (o) => ({ ...o, flags: { ...o.flags, [a.limit]: value } }));
      return done({ ...next, flagHistory: [["Just now", "You", org.name, label, `${before.toLocaleString("en-US")} → ${value.toLocaleString("en-US")}`], ...next.flagHistory] });
    }

    case "announcement":
      return done({ ...s, announcement: { ...s.announcement, ...a.patch } });

    case "announcement-publish": {
      const an = s.announcement;
      if (!an.title.trim()) return refuse("Add a headline first.");
      if (!an.orgs.length) return refuse("Choose at least one organisation to show it to.");
      return done({ ...s, announcement: { ...an, status: "Live" } }, `Live for ${an.orgs.length} organisation${an.orgs.length === 1 ? "" : "s"}`);
    }

    case "announcement-expire":
      return done({ ...s, announcement: { ...s.announcement, status: "Expired" } });
  }
}

export { DEFAULT_FLAGS };
