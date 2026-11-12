import { localParts, zonedTimeToUtc } from "./timeZone";

/**
 * Team activity notifications (FIG-1600, P2-17): what Management is told when a team member adds or changes
 * something, the delivery modes, how similar items are grouped, and when a digest is due. Pure: no database, so
 * the grouping and the digest timing are unit tested on their own. The sending lives in
 * `src/services/teamActivityNotifier.ts`; the decisions are in `docs/TEAM_ACTIVITY_NOTIFICATIONS.md`.
 *
 * Notifications inform; nothing here moves a deal, sets a discount or approves anything (CLAUDE.md rule 9).
 */

export const TEAM_EVENT_KEYS = [
  "LEAD_CREATED",
  "DEAL_CREATED",
  "DEAL_CLOSED",
  "COMPANY_CREATED",
  "CONTACT_CREATED",
  "DATA_RUN",
  "MEMBER_CHANGE",
  "DISCOUNT_REQUESTED",
] as const;
export type TeamEventKey = (typeof TEAM_EVENT_KEYS)[number];

export type DeliveryMode = "INSTANT" | "HOURLY" | "DAILY";
export const DELIVERY_MODES: readonly DeliveryMode[] = ["INSTANT", "HOURLY", "DAILY"];

export interface TeamEventDef {
  key: TeamEventKey;
  label: string;
  description: string;
  defaultMode: DeliveryMode;
  /** Words used when several items are grouped: "added 12 leads". */
  verb: string;
  noun: { one: string; many: string };
  /** Page that lists these records, for the one link of a grouped notification. */
  listPath: string;
}

export const TEAM_EVENT_DEFS: readonly TeamEventDef[] = [
  { key: "LEAD_CREATED", label: "A team member adds a lead", description: "Grouped into a digest by default, so a busy hour is one notification.", defaultMode: "HOURLY", verb: "added", noun: { one: "a lead", many: "leads" }, listPath: "leads" },
  { key: "DEAL_CREATED", label: "A team member adds a deal", description: "Shows the deal value only if your role may see values.", defaultMode: "INSTANT", verb: "added", noun: { one: "a deal", many: "deals" }, listPath: "deals" },
  { key: "DEAL_CLOSED", label: "A deal is marked won or lost", description: "Instant by default. Shows the deal value only if your role may see values.", defaultMode: "INSTANT", verb: "closed", noun: { one: "a deal", many: "deals" }, listPath: "deals" },
  { key: "COMPANY_CREATED", label: "A team member adds a company", description: "Grouped into a digest by default.", defaultMode: "HOURLY", verb: "added", noun: { one: "a company", many: "companies" }, listPath: "companies" },
  { key: "CONTACT_CREATED", label: "A team member adds a contact", description: "Grouped into a digest by default.", defaultMode: "HOURLY", verb: "added", noun: { one: "a contact", many: "contacts" }, listPath: "contacts" },
  { key: "DATA_RUN", label: "A lead, contact, company or deal import or export runs", description: "When an import or export finishes.", defaultMode: "INSTANT", verb: "finished", noun: { one: "an import or export", many: "imports and exports" }, listPath: "settings" },
  { key: "MEMBER_CHANGE", label: "A member is invited or removed", description: "When someone joins the invite list or leaves the team.", defaultMode: "INSTANT", verb: "changed", noun: { one: "a team member", many: "team members" }, listPath: "settings" },
  { key: "DISCOUNT_REQUESTED", label: "A large discount is requested", description: "When a quote discount goes above the approval limit and waits for a decision.", defaultMode: "INSTANT", verb: "asked approval for", noun: { one: "a discount", many: "discounts" }, listPath: "approvals" },
];

export function findTeamEventDef(key: string): TeamEventDef | undefined {
  return TEAM_EVENT_DEFS.find((d) => d.key === key);
}

/** Without a saved choice: in-app on, email and push off, and the event's own delivery mode. */
export const TEAM_ACTIVITY_DEFAULT_CHANNELS = { inApp: true, email: false, push: false } as const;

/** Per person: after this many instant team-activity notifications in an hour, further instant ones wait for the hourly digest. */
export const TEAM_ACTIVITY_HOURLY_CAP = 20;
export const DAILY_DIGEST_HOUR = 8;
const HOUR_MS = 60 * 60_000;

export function isOverRateCap(sentInLastHour: number, cap: number = TEAM_ACTIVITY_HOURLY_CAP): boolean {
  return sentInLastHour >= cap;
}

/** When a held item is due for its digest. Hourly: an hour after it was held. Daily: the next 08:00 on the person's own clock. */
export function digestDueAt(mode: Exclude<DeliveryMode, "INSTANT">, heldAt: Date, timeZone: string): Date {
  if (mode === "HOURLY") return new Date(heldAt.getTime() + HOUR_MS);
  const p = localParts(heldAt, timeZone);
  let due = zonedTimeToUtc(p.year, p.month, p.day, DAILY_DIGEST_HOUR, 0, timeZone);
  if (due.getTime() <= heldAt.getTime()) {
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    due = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), DAILY_DIGEST_HOUR, 0, timeZone);
  }
  return due;
}

export function windowLabel(mode: Exclude<DeliveryMode, "INSTANT">): string {
  return mode === "HOURLY" ? "in the last hour" : "since the last daily summary";
}

export interface TeamItem {
  eventKey: TeamEventKey;
  actorMembershipId: string | null;
  entityType: string;
  entityId: string;
  label: string;
  path: string;
  detail?: { value?: number | string | null; currency?: string | null; outcome?: "WON" | "LOST"; action?: "INVITED" | "REMOVED"; summary?: string; mode?: DeliveryMode } | null;
  createdAt: Date;
}

export interface TeamGroup {
  eventKey: TeamEventKey;
  actorMembershipId: string | null;
  items: TeamItem[];
}

/** One group per event and person: twelve leads from Amina become one group of twelve; Amina's and Brian's stay apart. */
export function groupItems(items: readonly TeamItem[]): TeamGroup[] {
  const groups = new Map<string, TeamGroup>();
  for (const item of items) {
    const key = `${item.eventKey}|${item.actorMembershipId ?? ""}`;
    const g = groups.get(key) ?? { eventKey: item.eventKey, actorMembershipId: item.actorMembershipId, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return [...groups.values()];
}

/** "KES 1,200,000": the shape the redaction in `src/auth/masking.ts` also recognises, so a missed case still gets redacted. */
export function formatMoney(value: number | string, currency: string | null | undefined): string {
  const n = Number(value);
  return `${currency ?? "KES"} ${Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value}`;
}

export interface ComposeOptions {
  /** Only true for recipients whose role may see deal values (`deals.view.value`). */
  canSeeValue: boolean;
  /** Set for a digest ("in the last hour"); left out for an instant notification. */
  window?: string;
}

function names(labels: string[]): string {
  const shown = labels.slice(0, 3);
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function valueSuffix(item: TeamItem, canSeeValue: boolean): string {
  const v = item.detail?.value;
  return canSeeValue && v !== undefined && v !== null && v !== "" ? ` · ${formatMoney(v, item.detail?.currency)}` : "";
}

/** The sentence and the line under it, for one group. Never contains a payment figure; a deal value only when `canSeeValue`. */
export function composeText(group: TeamGroup, actorName: string, opts: ComposeOptions): { title: string; body: string } {
  const def = findTeamEventDef(group.eventKey)!;
  const items = group.items;
  const n = items.length;
  const window = opts.window ? ` ${opts.window}` : "";
  const first = items[0]!;

  if (group.eventKey === "MEMBER_CHANGE") {
    const invited = items.filter((i) => i.detail?.action !== "REMOVED").length;
    const removed = n - invited;
    if (n === 1) return { title: `${actorName} ${removed ? "removed" : "invited"} ${first.label} ${removed ? "from" : "to"} the team`, body: first.label };
    const parts = [invited ? `invited ${invited}` : "", removed ? `removed ${removed}` : ""].filter(Boolean).join(" and ");
    return { title: `${actorName} ${parts} team members${window}`, body: names(items.map((i) => i.label)) };
  }
  if (group.eventKey === "DATA_RUN") {
    if (n === 1) return { title: `${actorName} finished ${first.label}`, body: first.detail?.summary ?? first.label };
    return { title: `${actorName} finished ${n} imports and exports${window}`, body: names(items.map((i) => i.label)) };
  }
  if (group.eventKey === "DEAL_CLOSED") {
    if (n === 1) {
      const won = first.detail?.outcome !== "LOST";
      return { title: `${actorName} marked a deal ${won ? "won" : "lost"}: ${first.label}`, body: `${first.label}${valueSuffix(first, opts.canSeeValue)}` };
    }
    const won = items.filter((i) => i.detail?.outcome !== "LOST").length;
    return { title: `${actorName} closed ${n} deals${window}`, body: `${won} won, ${n - won} lost. ${names(items.map((i) => i.label))}` };
  }
  if (group.eventKey === "DISCOUNT_REQUESTED") {
    if (n === 1) return { title: `${actorName} asked approval for a discount: ${first.label}`, body: first.detail?.summary ?? first.label };
    return { title: `${actorName} asked approval for ${n} discounts${window}`, body: names(items.map((i) => i.label)) };
  }
  // Added leads, deals, companies, contacts.
  if (n === 1) {
    return { title: `${actorName} ${def.verb} ${def.noun.one}: ${first.label}`, body: `${first.label}${group.eventKey === "DEAL_CREATED" ? valueSuffix(first, opts.canSeeValue) : ""}` };
  }
  return { title: `${actorName} ${def.verb} ${n} ${def.noun.many}${window}`, body: names(items.map((i) => i.label)) };
}
