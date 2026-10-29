/**
 * Demo data for the organisation-side V1.1 and V2 screens (FIG-1165, 1166, 1167, 1192). Sample records from the design's store
 * (design-spec/crm-store.js), read through `store.ts` only. Wiring a screen to the API (M13/M14) means replacing that module.
 */

export interface DemoMembership {
  id: string;
  name: string;
  role: string;
  last: string;
  unread: number;
  suspended?: string;
  invite?: boolean;
  current?: boolean;
}

export const DEMO_MEMBERSHIPS: DemoMembership[] = [
  { id: "o1", name: "FigBloom Digital Group", role: "Your current role", last: "Now", unread: 0, current: true },
  { id: "b2", name: "Brookside Ltd", role: "Sales", last: "2 days ago", unread: 3 },
  { id: "b3", name: "Kilimani Property Group", role: "Management", last: "Last week", unread: 0 },
  { id: "b4", name: "Westlands Clinics", role: "Sales", last: "—", unread: 0, suspended: "Suspended by Figbloom on 14 Oct" },
  { id: "b5", name: "Nyeri Coffee Co-op", role: "Delivery", last: "—", unread: 0, invite: true },
];

export type SupportStatus = "Pending organisation approval" | "Active" | "Denied" | "Ended";

export interface DemoSupportSession {
  id: string;
  by: string;
  reason: string;
  ticket: string;
  scope: string;
  mins: number;
  masked: boolean;
  status: SupportStatus;
  at: string;
  expires?: string;
  endedAt?: string;
  endedBy?: string;
  pages?: string[];
}

export const DEMO_SUPPORT: DemoSupportSession[] = [
  {
    id: "ss2",
    by: "Dev Super Admin",
    reason: "Website leads rejected since 08:00. Check website integration settings.",
    ticket: "FIG-812",
    scope: "Settings and health (read-only)",
    mins: 60,
    masked: true,
    status: "Pending organisation approval",
    at: "Today, 14:50",
    expires: "16:50",
  },
  {
    id: "ss1",
    by: "Given",
    reason: "Help configure the onboarding template.",
    ticket: "FIG-770",
    scope: "Settings and health (read-only)",
    mins: 30,
    masked: true,
    status: "Ended",
    at: "11 Oct, 11:00",
    endedAt: "11 Oct, 11:26",
    endedBy: "Dev Management",
    pages: ["Settings › Onboarding template", "Settings › Reference data"],
  },
];

export interface DemoAnnouncement {
  id: string;
  title: string;
  body: string;
}

export const DEMO_ANNOUNCEMENT: DemoAnnouncement = {
  id: "an1",
  title: "Planned maintenance on Saturday 24 Oct, 02:00 to 03:00 EAT.",
  body: "The CRM stays readable; saving is paused for about ten minutes.",
};

export type DataRequestStatus = "Received" | "In review" | "Approved" | "Completed" | "Rejected";

export interface DemoDataRequest {
  id: string;
  type: "Data export" | "Data deletion" | "Tenant offboarding";
  subject: string;
  received: string;
  due: string;
  status: DataRequestStatus;
}

export const DEMO_DATA_REQUESTS: DemoDataRequest[] = [
  { id: "dr2", type: "Data deletion", subject: "Peter Ochieng (contact)", received: "9 Oct 2026", due: "9 Nov 2026", status: "Approved" },
  { id: "dr3", type: "Data export", subject: "Leads and deals (CSV)", received: "2 Oct 2026", due: "9 Oct 2026", status: "Completed" },
];

export interface DemoDevice {
  id: string;
  label: string;
  meta: string;
}

export const DEMO_TRUSTED_DEVICES: DemoDevice[] = [
  { id: "td1", label: "Chrome on Windows", meta: "Nairobi · trusted until 18 Nov · last used today" },
  { id: "td2", label: "Safari on iPhone", meta: "Nairobi · trusted until 2 Nov · last used 2 days ago" },
];

export const DEMO_ANOMALIES = [
  { id: "an1", label: "Sign-in from a new device in Mombasa", meta: "Yesterday 21:14 · code asked, passed" },
  { id: "an2", label: "5 wrong codes for Wanjiru Kamau", meta: "12 Oct 08:41 · locked for 30 minutes" },
];

export const DEMO_BACKUP_CODES = ["7K3M-PQ9X", "A82D-LF4R", "XW5T-N6HB", "Q9ZC-2VJE", "M4RY-8UGA", "T7BD-K3SN", "H2LP-W5FQ", "E6XA-9CMV"];
