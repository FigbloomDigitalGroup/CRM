/**
 * What is still on demo data in the Platform console: Support access, Flags and limits and Announcements (V2, FIG-1192 platform half). The platform
 * API has no routes for them yet (docs/M13_CLOSEOUT.md), so they keep working in memory for the length of the visit, over the real organisations.
 * Everything else in the console reads `/api/platform/*` (see ../api.ts). See docs/RESTRUCTURE_LOG.md.
 */

export type SupportStatus = "Pending organisation approval" | "Active" | "Ended" | "Denied" | "Expired";

export interface OrgFlags {
  assistant: boolean;
  integrations: boolean;
  importLimit: number;
  seats: number;
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

export type FlagHistoryRow = [when: string, who: string, org: string, flag: string, change: string];

export const DAY = 864e5;
export const DEFAULT_FLAGS: OrgFlags = { assistant: true, integrations: true, importLimit: 1000, seats: 5 };

export interface LocalState {
  support: DemoSupport[];
  announcement: DemoAnnouncement;
  flagHistory: FlagHistoryRow[];
  activeSupport: string | null;
  release: "v11" | "v2";
  flags: Record<string, OrgFlags>;
}

export function emptyLocal(now: Date = new Date()): LocalState {
  return {
    support: [],
    announcement: { id: "an1", title: "", body: "", orgs: [], kind: "Maintenance", start: new Date(now.getTime() + 2 * DAY), end: new Date(now.getTime() + 5 * DAY), status: "Scheduled" },
    flagHistory: [],
    activeSupport: null,
    release: "v2",
    flags: {},
  };
}
