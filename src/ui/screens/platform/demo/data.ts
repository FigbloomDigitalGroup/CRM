/**
 * DEMO DATA for the Platform console (M10, FIG-1160 to FIG-1164 and the platform half of FIG-1192). Nothing here is real: the records are the
 * ones in design-spec/crm-store.js, dated relative to "now" so the screens always look current. When the console is wired to the real API (M13/M14)
 * this folder is replaced by calls through `src/ui/data/client.ts` and the store in ../store.tsx reads from there instead. See docs/RESTRUCTURE_LOG.md.
 */

export type OrgStatus = "Active" | "Suspended" | "Offboarding";
export type HealthStatus = "Healthy" | "Degraded" | "Down";
export type RequestStatus = "Received" | "In review" | "Approved" | "Completed" | "Rejected";
export type RequestKind = "offboard" | "delete" | "export";
export type SupportStatus = "Pending organisation approval" | "Active" | "Ended" | "Denied" | "Expired";
export type Adoption = "High" | "Medium" | "Low";

export interface OrgFlags {
  assistant: boolean;
  integrations: boolean;
  importLimit: number;
  seats: number;
}

export interface DemoOrg {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  members: number;
  last: Date;
  created: Date;
  tz: string;
  cur: string;
  owner: string;
  adoption: Adoption;
  roles: [string, number][];
  people: [string, string, string][];
  web: { last: string; ok: number; bad: number };
  mail: string;
  usage: { views: string; users: string; volume: string };
  flags: OrgFlags;
  sandbox?: boolean;
}

export interface DemoRequest {
  id: string;
  org: string;
  type: string;
  subject: string;
  requester: string;
  status: RequestStatus;
  received: Date;
  due: Date;
  notes: string;
  steps: [string, boolean][];
  approvals: string[];
  kind: RequestKind;
}

export interface DemoSupport {
  id: string;
  org: string;
  by: string;
  reason: string;
  ticket: string;
  scope: string;
  mins: number;
  mask: boolean;
  status: SupportStatus;
  at: Date;
  endsAt?: Date;
  endedBy?: string;
  pages?: string[];
}

export interface DemoAdmin {
  id: string;
  name: string;
  email: string;
  tfa: string;
  last: string;
  by: string;
}

export interface DemoHealth {
  k: string;
  l: string;
  status: HealthStatus;
  d: string;
  hint: string;
  tl: (1 | 2 | 3)[];
}

export interface DemoAnnouncement {
  id: string;
  title: string;
  body: string;
  orgs: string[];
  kind: "Maintenance" | "New feature" | "Incident";
  start: Date;
  end: Date;
  status: "Scheduled" | "Live" | "Expired";
}

export interface DemoAudit {
  at: Date;
  by: string;
  org: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  device: string;
}

export type FlagHistoryRow = [when: string, who: string, org: string, flag: string, change: string];

export interface PlatformState {
  orgs: DemoOrg[];
  requests: DemoRequest[];
  support: DemoSupport[];
  admins: DemoAdmin[];
  health: DemoHealth[];
  announcement: DemoAnnouncement;
  flagHistory: FlagHistoryRow[];
  audit: DemoAudit[];
  /** Release shown in the console: V2 adds Support access, Flags and limits and Announcements to the navigation. */
  release: "v11" | "v2";
  me: string;
  security: { verify: true; ip: boolean; newdev: boolean; failed: boolean; sessLen: string };
  activeSupport: string | null;
}

export const DAY = 864e5;

export const DEFAULT_LISTS: Record<string, string[]> = {
  "Lead sources": ["Website", "Referral", "Walk-in", "Social media", "Event", "Cold outreach"],
  "Lead statuses": ["New", "Contacted", "Qualified", "Unqualified"],
  "Pipeline stages": ["Discovery", "Proposal", "Negotiation", "Won", "Lost"],
  "Lost reasons": ["Price", "Timing", "Went with a competitor", "No response"],
  Services: ["Website design", "Hosting", "Branding", "Social media management"],
  "Customer lifecycle": ["Onboarding", "Active", "At risk", "Churned"],
};

/** The demo records, dated relative to `now`. */
export function seedPlatform(now: Date = new Date()): PlatformState {
  const at = (daysAgo: number, h = 9, m = 0) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const minsAgo = (n: number) => new Date(now.getTime() - n * 60000);

  const orgs: DemoOrg[] = [
    {
      id: "o1", name: "FigBloom Digital Group", slug: "figbloom", status: "Active", members: 7, last: minsAgo(2), created: at(47), tz: "Africa/Nairobi", cur: "KES",
      owner: "Dev Management · management@figbloom.co.ke", adoption: "High",
      roles: [["Management", 1], ["Sales", 2], ["Delivery", 1], ["Finance", 1], ["Restricted Technical", 1], ["Customer Support (proposed)", 1]],
      people: [["Dev Management", "management@figbloom.co.ke", "Management"], ["Dev Sales", "sales@figbloom.co.ke", "Sales"], ["Dev Sales Two", "sales2@figbloom.co.ke", "Sales"], ["Dev Delivery", "delivery@figbloom.co.ke", "Delivery"], ["Dev Finance", "finance@figbloom.co.ke", "Finance"], ["Dev Restricted Technical", "tech@figbloom.co.ke", "Restricted Technical"], ["Dev Customer Support", "support@figbloom.co.ke", "Customer Support (proposed)"]],
      web: { last: "5 h ago", ok: 42, bad: 3 }, mail: "Today 07:12", usage: { views: "3,410", users: "5 of 7", volume: "38 MB" }, flags: { assistant: true, integrations: true, importLimit: 5000, seats: 15 },
    },
    {
      id: "o2", name: "Figbloom Sandbox", slug: "sandbox", status: "Active", members: 2, last: at(2, 11), created: at(29), tz: "Africa/Nairobi", cur: "KES",
      owner: "Dev Management · management@figbloom.co.ke", adoption: "Low", roles: [["Management", 1], ["Sales", 1]],
      people: [["Dev Management", "management@figbloom.co.ke", "Management"], ["Dev Sales", "sales@figbloom.co.ke", "Sales"]],
      web: { last: "never", ok: 0, bad: 0 }, mail: "Not connected", usage: { views: "212", users: "1 of 2", volume: "2 MB" }, flags: { assistant: false, integrations: false, importLimit: 1000, seats: 5 }, sandbox: true,
    },
    {
      id: "o3", name: "Pilot · Westlands Clinics", slug: "westlands-pilot", status: "Offboarding", members: 3, last: at(17, 10), created: at(80), tz: "Africa/Nairobi", cur: "KES",
      owner: "Amina Yusuf · amina@westlandsclinics.co.ke", adoption: "Medium", roles: [["Management", 1], ["Sales", 2]],
      people: [["Amina Yusuf", "amina@westlandsclinics.co.ke", "Management"], ["Kevin Otieno", "kevin@westlandsclinics.co.ke", "Sales"], ["Ruth Njeri", "ruth@westlandsclinics.co.ke", "Sales"]],
      web: { last: "16 days ago", ok: 8, bad: 0 }, mail: "Not connected", usage: { views: "640", users: "0 of 3", volume: "5 MB" }, flags: { assistant: true, integrations: true, importLimit: 1000, seats: 5 },
    },
  ];

  const requests: DemoRequest[] = [
    {
      id: "dr1", org: "o3", type: "Tenant offboarding", subject: "Whole organisation", requester: "Amina Yusuf (Management)", status: "In review", received: at(7), due: new Date(now.getTime() + 23 * DAY),
      notes: "Pilot ended. Export sent; deletion after the 30-day retention period.",
      steps: [["Confirm requester is the organisation admin", true], ["Export all data and share download link (expires in 7 days)", true], ["Suspend sign-in", true], ["30-day retention period", false], ["Delete organisation data (needs a second platform admin)", false], ["Issue completion certificate", false]],
      approvals: ["pa"], kind: "offboard",
    },
    {
      id: "dr2", org: "o1", type: "Data deletion", subject: "Peter Ochieng (contact)", requester: "Dev Management (Management)", status: "Approved", received: at(10), due: new Date(now.getTime() - 3 * DAY),
      notes: "Data-subject request by email. Identity checked by Management.",
      steps: [["Confirm the request with the organisation", true], ["Find every record about the person", true], ["Second platform admin approves deletion", true], ["Delete and keep an anonymised audit entry", false], ["Send completion certificate to the organisation", false]],
      approvals: ["pa", "pg"], kind: "delete",
    },
    {
      id: "dr3", org: "o1", type: "Data export", subject: "Leads and deals (CSV)", requester: "Dev Management (Management)", status: "Completed", received: at(17), due: at(10),
      notes: "Quarterly backup copy for the board.", steps: [["Prepare export", true], ["Share download link (expired)", true]], approvals: ["pa"], kind: "export",
    },
  ];

  const support: DemoSupport[] = [
    { id: "ss2", org: "o1", by: "pa", reason: "Website leads rejected since 08:00. Check website integration settings.", ticket: "FIG-812", scope: "Settings and health (read-only)", mins: 60, mask: true, status: "Pending organisation approval", at: minsAgo(22) },
    { id: "ss1", org: "o1", by: "pg", reason: "Help configure the onboarding template.", ticket: "FIG-770", scope: "Settings and health (read-only)", mins: 30, mask: true, status: "Ended", at: at(11, 11), endedBy: "Dev Management", pages: ["Settings › Onboarding template", "Settings › Reference data"] },
  ];

  const admins: DemoAdmin[] = [
    { id: "pa", name: "Dev Super Admin", email: "superadmin@platform.figbloom.co.ke", tfa: "On (dev: skipped)", last: "Today 15:02", by: "Setup script" },
    { id: "pg", name: "Given", email: "given@platform.figbloom.co.ke", tfa: "On", last: "Yesterday 18:40", by: "Setup script" },
    { id: "pm", name: "Michael", email: "michael@platform.figbloom.co.ke", tfa: "On", last: "12 Oct 09:15", by: "Given" },
  ];

  const ok: (1 | 2 | 3)[] = [1, 1, 1, 1, 1, 1, 1, 1];
  const health: DemoHealth[] = [
    { k: "web", l: "Website lead endpoint", status: "Degraded", d: "3 rejected submissions from figbloom.co.ke in 24 h (invalid key after rotation).", hint: "Ask FigBloom Digital Group to update the key on their website, or request support access to check.", tl: [1, 1, 1, 1, 1, 1, 2, 2] },
    { k: "jobs", l: "Scheduled jobs · notification sweep", status: "Healthy", d: "Runs every 15 minutes. Last run 15:00, 1.2 s.", hint: "", tl: ok },
    { k: "mail", l: "Email delivery", status: "Healthy", d: "412 sent in 24 h, 0 bounced.", hint: "", tl: ok },
    { k: "auth", l: "Sign-in and rate limits", status: "Healthy", d: "5 failed sign-ins blocked in 24 h; 1 lockout.", hint: "", tl: [1, 1, 1, 2, 1, 1, 1, 1] },
    { k: "err", l: "Application errors", status: "Healthy", d: "Error rate 0.08 %. 2 new issues in error tracking.", hint: "", tl: ok },
    { k: "db", l: "Database and backups", status: "Healthy", d: "Last backup today 02:00 (verified). Point-in-time recovery 7 days.", hint: "", tl: ok },
    { k: "ver", l: "App version and migrations", status: "Healthy", d: "v1.1.3 · migration 0042 applied.", hint: "", tl: ok },
  ];

  const announcement: DemoAnnouncement = {
    id: "an1", title: "Planned maintenance Saturday, 22:00–23:00", body: "Figbloom CRM may be unavailable for up to an hour. Nothing you saved will be lost.",
    orgs: ["o1", "o2"], kind: "Maintenance", start: new Date(now.getTime() + 2 * DAY), end: new Date(now.getTime() + 5 * DAY), status: "Scheduled",
  };

  const audit: DemoAudit[] = [
    { at: minsAgo(10), by: "pa", org: "—", action: "Signed in", target: "Platform console", detail: "Dev chip · verification skipped", ip: "127.0.0.1", device: "Chrome · Windows" },
    { at: minsAgo(22), by: "pa", org: "FigBloom Digital Group", action: "Support access requested", target: "Settings and health (read-only)", detail: "FIG-812 · 60 min", ip: "41.90.64.12", device: "Chrome · Windows" },
    { at: at(6, 10, 5), by: "pg", org: "Pilot · Westlands Clinics", action: "Organisation export created", target: "Full export", detail: "Link expires in 7 days", ip: "41.90.64.20", device: "Safari · macOS" },
    { at: at(7, 9, 30), by: "pg", org: "Pilot · Westlands Clinics", action: "Offboarding started", target: "Organisation", detail: "Requested by Amina Yusuf", ip: "41.90.64.20", device: "Safari · macOS" },
    { at: at(11, 11, 26), by: "pg", org: "FigBloom Digital Group", action: "Support view ended", target: "2 pages viewed", detail: "Ended by Dev Management", ip: "41.90.64.20", device: "Safari · macOS" },
    { at: at(8, 9, 30), by: "pm", org: "FigBloom Digital Group", action: "Flag changed", target: "Import size limit", detail: "2,000 → 5,000", ip: "105.163.2.8", device: "Chrome · Android" },
  ];

  return {
    orgs, requests, support, admins, health, announcement, audit,
    flagHistory: [["Yesterday 10:12", "Given", "Figbloom Sandbox", "Assistant", "On → Off"], ["8 days ago 09:30", "Michael", "FigBloom Digital Group", "Import size limit", "2,000 → 5,000"]],
    release: "v2", me: "pa", security: { verify: true, ip: false, newdev: true, failed: true, sessLen: "30" }, activeSupport: null,
  };
}
