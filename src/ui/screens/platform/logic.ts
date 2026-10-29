import { DAY, DEFAULT_LISTS, type DemoOrg, type DemoRequest, type DemoSupport, type OrgStatus, type PlatformState, type RequestStatus } from "./demo/data";

/**
 * The console's rules, as pure functions over the demo state (so they are unit-tested, and so wiring to the real API in M13 means replacing
 * `apply` with calls, not rewriting screens). The rules come from the design (design-spec/CrmPlatform.dc.html) and the issues:
 *  - at least two platform admins always exist (FIG-1163);
 *  - deleting data needs two different platform admins (FIG-1162);
 *  - suspend, reactivate and offboard need a reason and the organisation's name typed back (PL5);
 *  - support access is read-only, time-limited and ends on its own (FIG-1192).
 */

export const MIN_ADMINS = 2;
export const TAKEN_SLUGS = ["figbloom", "sandbox", "westlands-pilot"];
export const INVITED_EMAILS = ["amina@westlandsclinics.co.ke", "management@figbloom.co.ke"];

export type Tone = { bg: string; fg: string };

const TONES: Record<string, Tone> = {
  Active: { bg: "var(--pl-primary-soft)", fg: "var(--pl-primary-text)" },
  Suspended: { bg: "var(--pl-red-soft)", fg: "var(--pl-red)" },
  Offboarding: { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  Healthy: { bg: "var(--pl-primary-soft)", fg: "var(--pl-primary-text)" },
  Degraded: { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  Down: { bg: "var(--pl-red-soft)", fg: "var(--pl-red)" },
  Received: { bg: "var(--pl-blue-soft)", fg: "var(--pl-blue)" },
  "In review": { bg: "var(--pl-orange-soft)", fg: "var(--pl-orange-text)" },
  Approved: { bg: "var(--pl-blue-soft)", fg: "var(--pl-blue)" },
  Completed: { bg: "var(--pl-primary-soft)", fg: "var(--pl-primary-text)" },
  Rejected: { bg: "var(--pl-surface-3)", fg: "var(--pl-text-2)" },
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

export function slugState(slug: string, taken: readonly string[] = TAKEN_SLUGS): SlugState {
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
  tz: string;
  cur: string;
  email: string;
}

export const EMPTY_WIZARD: WizardForm = { name: "", slug: "", tz: "Africa/Nairobi", cur: "KES", email: "" };
export const WIZARD_STEPS = ["Name", "Region", "First admin", "Defaults", "Keys", "Review"] as const;

/** Editing the name keeps the slug in step until the person edits the slug themselves. */
export function applyWizardField(form: WizardForm, key: keyof WizardForm, value: string): WizardForm {
  const next = { ...form, [key]: value };
  if (key === "name" && (!form.slug || form.slug === slugify(form.name))) next.slug = slugify(value);
  return next;
}

export function emailIsInvited(email: string): boolean {
  return INVITED_EMAILS.includes(email.trim().toLowerCase());
}

/** The message for a wizard step that cannot continue, or "" (the design's exact wording). */
export function wizardStepError(step: number, form: WizardForm, takenSlugs: readonly string[] = TAKEN_SLUGS): string {
  if (step === 0) {
    if (!form.name.trim()) return "Give the organisation a name.";
    const s = slugState(form.slug, takenSlugs);
    if (s === "empty" || s === "invalid") return "Slugs use lowercase letters, numbers and hyphens (3+).";
    if (s === "taken") return "That slug is taken. Choose another.";
  }
  if (step === 2) {
    if (!/.+@.+\..+/.test(form.email)) return "Enter the first admin’s email.";
    if (emailIsInvited(form.email)) return "That email already has a pending invite or belongs to another organisation’s admin.";
  }
  return "";
}

/* Admins ---------------------------------------------------------------------------------------------------------------------- */

export type Check = { ok: true } | { ok: false; reason: string };

/** "At least two platform admins are required" and "ask another admin to remove you" (FIG-1163: the second-last admin cannot be removed). */
export function canRemoveAdmin(admins: readonly { id: string }[], meId: string, targetId: string): Check {
  if (admins.length <= MIN_ADMINS) return { ok: false, reason: "Blocked: at least two platform admins are required." };
  if (targetId === meId) return { ok: false, reason: "Ask another admin to remove you." };
  return { ok: true };
}

export function adminEmailOk(email: string): boolean {
  return /@platform\.figbloom\.co\.ke$/.test(email);
}

export function initials(name: string): string {
  return name.replace("Dev ", "").split(" ").map((w) => w[0] ?? "").join("").slice(0, 2);
}

/* Data requests and the two-person rule --------------------------------------------------------------------------------------- */

export const isPending = (r: DemoRequest) => ["Received", "In review", "Approved"].includes(r.status);
export const needsTwoAdmins = (r: DemoRequest) => r.kind !== "export";
export const hasTwoApprovals = (r: DemoRequest) => new Set(r.approvals).size >= 2;
/** Requests that still wait for a second, different platform admin. */
export const awaitingSecond = (r: DemoRequest) => needsTwoAdmins(r) && r.status !== "Completed" && r.status !== "Rejected" && !hasTwoApprovals(r);

export function canApprove(r: DemoRequest, adminId: string): Check {
  if (!needsTwoAdmins(r)) return { ok: false, reason: "Exports do not need a second admin." };
  if (hasTwoApprovals(r)) return { ok: false, reason: "Already approved by two admins." };
  if (r.approvals.includes(adminId)) return { ok: false, reason: "You already approved this. A different admin must approve it." };
  return { ok: true };
}

/** The step that deletes data stays locked until two admins approved (PL6). */
export function stepLocked(r: DemoRequest, label: string, done: boolean): boolean {
  return /second platform admin|Delete/i.test(label) && !hasTwoApprovals(r) && !done;
}

export function retentionDaysLeft(r: DemoRequest, now: Date): number {
  return Math.max(0, 30 - Math.floor((now.getTime() - r.received.getTime()) / DAY));
}

export function dueLabel(due: Date, now: Date): string {
  const days = Math.round((due.getTime() - now.getTime()) / DAY);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/* Organisations ---------------------------------------------------------------------------------------------------------------- */

export type OrgSort = "last" | "name" | "created";

export function filterOrgs(orgs: readonly DemoOrg[], q: string, status: string, sort: OrgSort): DemoOrg[] {
  const needle = q.toLowerCase();
  const rows = orgs.filter((o) => (!needle || `${o.name}${o.slug}`.toLowerCase().includes(needle)) && (!status || o.status === status));
  return [...rows].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.created.getTime() - a.created.getTime() : b.last.getTime() - a.last.getTime()));
}

/** Search in the top bar covers organisation names only. */
export function searchOrgs(orgs: readonly DemoOrg[], q: string): DemoOrg[] {
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
    effects: ["Sign-in is suspended and a full export is prepared.", "Data is deleted after the 30-day retention period, with a second admin’s approval.", "A request appears in Data requests to track each step."],
    cta: "Start offboarding", danger: true, to: "Offboarding",
  },
};

/** A dialog confirms only with a reason and the organisation's exact name typed back (PL5). */
export function dialogValid(reason: string, typed: string, orgName: string): boolean {
  return reason.trim().length > 0 && typed === orgName;
}

/* Home ------------------------------------------------------------------------------------------------------------------------ */

export interface AttentionItem {
  key: string;
  title: string;
  sub: string;
  dot: "orange" | "red" | "blue";
  go: { page: "health" | "data-requests" | "support-access"; requestId?: string };
  mobileTab: "health" | "approvals";
}

export function attentionItems(s: PlatformState, now: Date): AttentionItem[] {
  const orgName = (id: string) => s.orgs.find((o) => o.id === id)?.name ?? "—";
  const out: AttentionItem[] = [];
  for (const c of s.health.filter((h) => h.status !== "Healthy")) out.push({ key: `h-${c.k}`, title: `${c.l} · ${c.status}`, sub: c.d, dot: "orange", go: { page: "health" }, mobileTab: "health" });
  for (const r of s.requests.filter(awaitingSecond)) out.push({ key: `r-${r.id}`, title: `${r.type} · ${orgName(r.org)}`, sub: `Waiting for a second platform admin · ${dueLabel(r.due, now)}`, dot: "red", go: { page: "data-requests", requestId: r.id }, mobileTab: "approvals" });
  for (const x of s.support.filter((p) => p.status === "Pending organisation approval")) out.push({ key: `s-${x.id}`, title: `Support access pending · ${orgName(x.org)}`, sub: x.reason, dot: "blue", go: { page: "support-access" }, mobileTab: "approvals" });
  return out;
}

export function homeTiles(s: PlatformState) {
  const count = (st: string) => s.orgs.filter((o) => o.status === st).length;
  const pend = s.requests.filter(isPending).length;
  const pendSupport = s.support.filter((x) => x.status === "Pending organisation approval").length;
  return [
    { key: "orgs", l: "Organisations", v: String(s.orgs.length), sub: `${count("Active")} active · ${count("Suspended")} suspended · ${count("Offboarding")} offboarding`, dot: "purple", go: "organisations" },
    { key: "users", l: "Active users · 7 days", v: "6", sub: "of 12 members", dot: "primary", go: "organisations" },
    { key: "jobs", l: "Failed scheduled jobs", v: "0", sub: "notification sweep healthy", dot: "primary", go: "health" },
    { key: "leads", l: "Failed website leads · 24 h", v: "3", sub: "FigBloom Digital Group", dot: "orange", warn: true, go: "health" },
    { key: "err", l: "Error rate", v: "0.08%", sub: "last 24 h", dot: "primary", go: "health" },
    { key: "backup", l: "Last backup", v: "02:00", sub: "today · verified", dot: "primary", go: "health" },
    { key: "pending", l: "Pending requests", v: String(pend + pendSupport), sub: `${pend} data · ${pendSupport} support access`, dot: "blue", go: "data-requests" },
  ];
}

export const TRENDS = [
  { l: "Active users", now: "6", values: [4, 5, 5, 6, 3, 2, 5, 6] },
  { l: "Website leads accepted", now: "42", values: [5, 7, 6, 4, 8, 3, 6, 3] },
  { l: "Errors per day", now: "2", values: [1, 3, 2, 1, 4, 1, 2, 2] },
];

export function barHeights(values: readonly number[]): number[] {
  const mx = Math.max(...values);
  return values.map((v) => Math.max(6, (v / mx) * 100));
}

/* Support sessions ------------------------------------------------------------------------------------------------------------ */

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

export function verifyCode(raw: string, backup: boolean): boolean {
  const c = raw.replace(/\s/g, "");
  const ok = backup ? /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(c) : /^\d{6}$/.test(c);
  // The demo's one wrong code, so the "wrong code" state can be shown: 000000.
  return ok && c !== "000000";
}

/* The store's actions --------------------------------------------------------------------------------------------------------- */

export type Action =
  | { type: "release"; value: "v11" | "v2" }
  | { type: "org-status"; id: string; kind: "suspend" | "reactivate" | "offboard"; reason: string; notify: boolean }
  | { type: "org-note"; id: string; action: string; target?: string; detail?: string }
  | { type: "provision"; form: WizardForm; lists: Record<string, string[]>; keys: { web: boolean; mail: boolean } }
  | { type: "request-approve"; id: string; as?: string }
  | { type: "request-status"; id: string; status: RequestStatus }
  | { type: "request-step"; id: string; index: number }
  | { type: "request-notes"; id: string; notes: string }
  | { type: "support-request"; org: string; reason: string; ticket: string; mins: number; scope: string; mask: boolean }
  | { type: "support-approve"; id: string }
  | { type: "support-end"; id: string }
  | { type: "support-expire"; id: string }
  | { type: "admin-remove"; id: string }
  | { type: "admin-invite"; email: string }
  | { type: "admin-recover"; id: string }
  | { type: "security"; key: "ip" | "newdev" | "failed"; label: string }
  | { type: "session-length"; value: string }
  | { type: "flag"; org: string; flag: "assistant" | "integrations" }
  | { type: "limit"; org: string; limit: "importLimit" | "seats"; value: number }
  | { type: "announcement"; patch: Partial<PlatformState["announcement"]> }
  | { type: "announcement-publish" }
  | { type: "announcement-expire" }
  | { type: "audit"; action: string; org?: string; target?: string; detail?: string };

export type Result = { ok: true; message?: string; id?: string } | { ok: false; message: string };

const orgNameOf = (s: PlatformState, id: string) => s.orgs.find((o) => o.id === id)?.name ?? "—";
const adminNameOf = (s: PlatformState, id: string) => s.admins.find((a) => a.id === id)?.name ?? id;

function log(s: PlatformState, now: Date, action: string, org = "—", target = "—", detail = ""): PlatformState {
  return { ...s, audit: [{ at: now, by: s.me, org, action, target, detail, ip: "41.90.64.12", device: "Chrome · Windows" }, ...s.audit] };
}

function mapOrg(s: PlatformState, id: string, fn: (o: DemoOrg) => DemoOrg): PlatformState {
  return { ...s, orgs: s.orgs.map((o) => (o.id === id ? fn(o) : o)) };
}

function mapRequest(s: PlatformState, id: string, fn: (r: DemoRequest) => DemoRequest): PlatformState {
  return { ...s, requests: s.requests.map((r) => (r.id === id ? fn(r) : r)) };
}

/** One state change. Returns the new state and what to tell the person (a toast), or a refusal with the reason. Never mutates `s`. */
export function apply(s: PlatformState, a: Action, now: Date = new Date()): { state: PlatformState; result: Result } {
  const refuse = (message: string) => ({ state: s, result: { ok: false, message } as Result });
  const done = (state: PlatformState, message?: string, id?: string) => ({ state, result: { ok: true, message, id } as Result });

  switch (a.type) {
    case "release":
      return done({ ...s, release: a.value });

    case "audit":
      return done(log(s, now, a.action, a.org, a.target, a.detail));

    case "org-note":
      return done(log(s, now, a.action, orgNameOf(s, a.id), a.target, a.detail));

    case "org-status": {
      const org = s.orgs.find((o) => o.id === a.id);
      if (!org) return refuse("That organisation no longer exists.");
      const d = ORG_DIALOGS[a.kind];
      if (!a.reason.trim()) return refuse("Add a reason first.");
      if (a.kind === "offboard" && org.status === "Offboarding") return refuse("Offboarding has already started.");
      let next = mapOrg(s, a.id, (o) => ({ ...o, status: d.to }));
      if (a.kind === "offboard") {
        const req: DemoRequest = {
          id: `dr${now.getTime()}`, org: a.id, type: "Tenant offboarding", subject: "Whole organisation", requester: "Dev Super Admin (platform)", status: "Received", received: now,
          due: new Date(now.getTime() + 30 * DAY), notes: a.reason,
          steps: [["Confirm with the organisation admin", false], ["Export all data and share download link", false], ["Suspend sign-in", true], ["30-day retention period", false], ["Delete organisation data (needs a second platform admin)", false], ["Issue completion certificate", false]],
          approvals: [], kind: "offboard",
        };
        next = { ...next, requests: [req, ...next.requests] };
      }
      next = log(next, now, d.cta, org.name, "Organisation", a.reason + (a.notify ? " · admins emailed" : ""));
      return done(next, `${org.name} is now ${d.to}${a.notify ? ". Management was emailed." : "."}`);
    }

    case "provision": {
      const err = wizardStepError(0, a.form) || wizardStepError(2, a.form);
      if (err) return refuse(err);
      const id = `o${now.getTime()}`;
      const org: DemoOrg = {
        id, name: a.form.name, slug: a.form.slug, status: "Active", members: 0, last: now, created: now, tz: a.form.tz, cur: a.form.cur, owner: `Invite pending · ${a.form.email}`, adoption: "Low",
        roles: [["Management (invited)", 1]], people: [["Invite pending", a.form.email, "Management"]], web: { last: "never", ok: 0, bad: 0 }, mail: a.keys.mail ? "Key created" : "Not connected",
        usage: { views: "0", users: "0 of 1", volume: "0 MB" }, flags: { assistant: true, integrations: true, importLimit: 1000, seats: 5 },
      };
      void a.lists;
      return done(log({ ...s, orgs: [...s.orgs, org] }, now, "Organisation provisioned", a.form.name, `Slug ${a.form.slug}`, `Admin invite to ${a.form.email}`), undefined, id);
    }

    case "request-approve": {
      const r = s.requests.find((x) => x.id === a.id);
      if (!r) return refuse("That request no longer exists.");
      // `as` lets the demo act as another platform admin (there is only one sign-in in the demo); the real API takes the admin from the session.
      const admin = a.as ?? s.me;
      const c = canApprove(r, admin);
      if (!c.ok) return refuse(c.reason);
      const next = mapRequest(s, a.id, (x) => ({ ...x, approvals: [...x.approvals, admin] }));
      const two = hasTwoApprovals(next.requests.find((x) => x.id === a.id)!);
      return done(log(next, now, "Deletion approved", orgNameOf(s, r.org), r.subject, `Approved by ${adminNameOf(s, admin)}`), `Approved. ${two ? "Deletion can run." : "One more admin needed."}`);
    }

    case "request-status":
      return done(log(mapRequest(s, a.id, (r) => ({ ...r, status: a.status })), now, "Data request status changed", orgNameOf(s, s.requests.find((r) => r.id === a.id)?.org ?? ""), s.requests.find((r) => r.id === a.id)?.type, a.status));

    case "request-step": {
      const r = s.requests.find((x) => x.id === a.id);
      const step = r?.steps[a.index];
      if (!r || !step) return refuse("That step no longer exists.");
      if (stepLocked(r, step[0], step[1])) return refuse("This step needs a second platform admin to approve first.");
      const next = mapRequest(s, a.id, (x) => {
        const steps = x.steps.map((st, i) => (i === a.index ? ([st[0], !st[1]] as [string, boolean]) : st));
        return { ...x, steps, status: steps.every((st) => st[1]) ? "Completed" : x.status };
      });
      return done(next);
    }

    case "request-notes":
      return done(mapRequest(s, a.id, (r) => ({ ...r, notes: a.notes })));

    case "support-request": {
      if (!a.reason.trim()) return refuse("Add a reason first");
      const req: DemoSupport = { id: `ss${now.getTime()}`, org: a.org, by: s.me, reason: a.reason, ticket: a.ticket || "—", scope: a.scope, mins: a.mins, mask: a.mask, status: "Pending organisation approval", at: now };
      return done(log({ ...s, support: [req, ...s.support] }, now, "Support access requested", orgNameOf(s, a.org), a.scope, `${a.ticket || ""} · ${a.mins} min`), "Sent. The organisation’s Management users must approve.");
    }

    case "support-approve": {
      const x = s.support.find((p) => p.id === a.id);
      if (!x || x.status !== "Pending organisation approval") return refuse("That request is not waiting for approval.");
      const next = { ...s, activeSupport: a.id, support: s.support.map((p) => (p.id === a.id ? { ...p, status: "Active" as const, endsAt: new Date(now.getTime() + p.mins * 60000), pages: [] } : p)) };
      return done(log(next, now, "Support access approved", orgNameOf(s, x.org), x.scope, "Approved by Dev Management"));
    }

    case "support-end": {
      const x = s.support.find((p) => p.id === a.id);
      if (!x) return refuse("That session no longer exists.");
      const next = { ...s, activeSupport: s.activeSupport === a.id ? null : s.activeSupport, support: s.support.map((p) => (p.id === a.id ? { ...p, status: "Ended" as const, endedBy: "Dev Super Admin" } : p)) };
      return done(log(next, now, "Support view ended", orgNameOf(s, x.org), `${(x.pages ?? []).length} pages viewed`, "Ended by admin"));
    }

    case "support-expire": {
      const next = { ...s, activeSupport: s.activeSupport === a.id ? null : s.activeSupport, support: s.support.map((p) => (p.id === a.id ? { ...p, status: "Expired" as const } : p)) };
      return done(next);
    }

    case "admin-remove": {
      const target = s.admins.find((x) => x.id === a.id);
      if (!target) return refuse("That admin no longer exists.");
      const c = canRemoveAdmin(s.admins, s.me, a.id);
      if (!c.ok) return refuse(c.reason);
      return done(log({ ...s, admins: s.admins.filter((x) => x.id !== a.id) }, now, "Platform admin removed", "—", target.name), `${target.name} removed`);
    }

    case "admin-invite": {
      if (!adminEmailOk(a.email)) return refuse("Platform admins need a platform.figbloom.co.ke address");
      if (s.admins.some((x) => x.email.toLowerCase() === a.email.toLowerCase())) return refuse("That person is already a platform admin.");
      const admin = { id: `pz${now.getTime()}`, name: a.email.split("@")[0]!, email: a.email, tfa: "Pending setup", last: "Never", by: "Dev Super Admin" };
      return done(log({ ...s, admins: [...s.admins, admin] }, now, "Platform admin invited", "—", a.email), "Invite sent. They must set up verification before first sign-in.");
    }

    case "admin-recover": {
      const target = s.admins.find((x) => x.id === a.id);
      if (!target) return refuse("That admin no longer exists.");
      return done(log(s, now, "Lost-device recovery started", "—", target.name), `Recovery link sent to ${target.email}. Another admin must confirm it.`);
    }

    case "security": {
      const was = s.security[a.key];
      return done(log({ ...s, security: { ...s.security, [a.key]: !was } }, now, "Platform security changed", "—", a.label, was ? "Off" : "On"));
    }

    case "session-length":
      return done({ ...s, security: { ...s.security, sessLen: a.value } });

    case "flag": {
      const org = s.orgs.find((o) => o.id === a.org);
      if (!org) return refuse("That organisation no longer exists.");
      const label = a.flag === "assistant" ? "Assistant" : "Integrations";
      const on = !org.flags[a.flag];
      const next = mapOrg(s, a.org, (o) => ({ ...o, flags: { ...o.flags, [a.flag]: on } }));
      return done(log({ ...next, flagHistory: [["Just now", "Dev Super Admin", org.name, label, on ? "Off → On" : "On → Off"], ...next.flagHistory] }, now, "Flag changed", org.name, label, on ? "On" : "Off"));
    }

    case "limit": {
      const org = s.orgs.find((o) => o.id === a.org);
      if (!org) return refuse("That organisation no longer exists.");
      const value = Math.max(0, Math.round(a.value) || 0);
      const label = a.limit === "importLimit" ? "Import size limit" : "Seat limit";
      const before = org.flags[a.limit];
      if (before === value) return done(s);
      const next = mapOrg(s, a.org, (o) => ({ ...o, flags: { ...o.flags, [a.limit]: value } }));
      return done(log({ ...next, flagHistory: [["Just now", "Dev Super Admin", org.name, label, `${before.toLocaleString("en-US")} → ${value.toLocaleString("en-US")}`], ...next.flagHistory] }, now, "Flag changed", org.name, label, `${before} → ${value}`));
    }

    case "announcement":
      return done({ ...s, announcement: { ...s.announcement, ...a.patch } });

    case "announcement-publish": {
      const an = s.announcement;
      if (!an.title.trim()) return refuse("Add a headline first.");
      if (!an.orgs.length) return refuse("Choose at least one organisation to show it to.");
      return done(log({ ...s, announcement: { ...an, status: "Live" } }, now, "Announcement published", an.orgs.map((id) => orgNameOf(s, id)).join(", "), an.title), `Live for ${an.orgs.length} organisation${an.orgs.length === 1 ? "" : "s"}`);
    }

    case "announcement-expire":
      return done(log({ ...s, announcement: { ...s.announcement, status: "Expired" } }, now, "Announcement expired", "—", s.announcement.title));
  }
}

export { DEFAULT_LISTS, adminNameOf };
