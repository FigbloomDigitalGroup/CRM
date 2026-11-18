import type { Operations } from "@/api-client";

/**
 * What the deals screens read from the API, and the small pure helpers they share (formatting, stage colours, the flags on a card). Everything
 * here is derived from what the API returned; nothing decides a permission or masks a value (the API does, and says so with `valueMasked`).
 */

export type DealItem = Operations["getDeals"]["response"]["items"][number] & {
  valueMasked?: boolean;
  signals?: { stalled: boolean; daysSinceActivity: number; stalledAfterDays: number; closeDatePassed: boolean; closeDateOverdueDays: number } | null;
  tagLinks?: unknown[];
};

export type DealDetail = Operations["getDeal"]["response"];

export interface Stage {
  id: string;
  key: string;
  name: string;
  sequence: number;
  isWon: boolean;
  isLost: boolean;
  isActive?: boolean;
}

export interface Member {
  membershipId: string;
  userName: string;
  initials: string;
  roleKey: string;
  roleName: string;
}

export interface RefData {
  stages: Stage[];
  lostReasons: { id: string; name: string }[];
  services: { id: string; name: string; isActive?: boolean }[];
  members: Member[];
}

export interface MoveCheckResult {
  allowed: boolean;
  blockers: { code: string; message: string; field?: string }[];
  needsLostReason: boolean;
  handoffPrompt: boolean;
  reopens: boolean;
}

export interface MoveResult {
  deal: unknown;
  move: { id: string; undoExpiresAt: string; undoable: boolean };
}

export type HandoffStatus = "AWAITING_OWNER" | "ONBOARDING" | "DELIVERED";

export interface HandoffRow {
  id: string;
  dealId: string;
  status: HandoffStatus;
  company: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
  deliveryOwner: { membershipId: string; name: string | null } | null;
  startDate: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deliverables: { title: string; done: boolean }[];
}

export interface HandoffView {
  id: string;
  dealId: string;
  status: HandoffStatus;
  deliveryOwner: { membershipId: string; name: string | null } | null;
  team: { membershipId: string; name: string | null }[];
  startDate: string | null;
  scope: string | null;
  requirements: string | null;
  deliverables: { title: string; done: boolean }[];
  createdAt: string;
  ownerTakenAt: string | null;
  deliveredAt: string | null;
  deliveredBy: { membershipId: string; name: string | null } | null;
  company: { id: string; name: string; industry?: string | null; location?: string | null; phone?: string | null; email?: string | null } | null;
  tasks: { id: string; title: string; status: string; dueAt: string | null; assigneeMembershipId: string | null }[];
  can: { take: boolean; edit: boolean; markDelivered: boolean; reopen: boolean };
}

export function extract<T>(data: unknown): T {
  return data as T;
}

/* Formatting ------------------------------------------------------------------------------------------------------------------- */

const NUM = new Intl.NumberFormat("en-KE");

export function kes(amount: number, currency = "KES"): string {
  return `${currency} ${NUM.format(Math.round(amount))}`;
}

export function num(amount: number): string {
  return NUM.format(Math.round(amount));
}

/** The design writes dates as "19 Oct 2026"; the person's own time zone decides the day. */
export function dateLong(iso: string | null | undefined, zone?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: zone ?? undefined });
}

export function dateShort(iso: string | null | undefined, zone?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: zone ?? undefined });
}

export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const s = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function when(iso: string | null | undefined, zone?: string | null, hour12 = false, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12, timeZone: zone ?? undefined });
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: zone ?? undefined });
  if (day(d) === day(now)) return `Today, ${time}`;
  if (day(d) === day(new Date(now.getTime() + 86400000))) return `Tomorrow, ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86400000))) return `Yesterday, ${time}`;
  return `${dateShort(iso, zone)}, ${time}`;
}

export function initials(name: string): string {
  const words = name.replace(/^Dev\s+/i, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/* Stages and cards ------------------------------------------------------------------------------------------------------------- */

/** The colour beside a stage name: blue, orange and green for the open stages, green for won, red for lost (the design's `stageTone`). */
export function stageTone(stage: Pick<Stage, "key" | "isWon" | "isLost" | "sequence">): string {
  if (stage.isLost) return "var(--red)";
  if (stage.isWon) return "var(--primary)";
  switch (stage.key) {
    case "SOLUTION_PRESENTED":
      return "var(--blue)";
    case "PROPOSAL_SENT":
      return "var(--orange)";
    case "NEGOTIATION":
      return "var(--primary)";
    default:
      return ["var(--blue)", "var(--orange)", "var(--primary)"][stage.sequence % 3]!;
  }
}

/**
 * The card's second line. A deal has no title of its own in the API: the first line of its notes reads like one ("Cold-chain inventory
 * tracking across 3 depots."), so that is used, and the service name when there are no notes.
 */
export function dealTitle(d: { notes?: unknown; service?: unknown }): string {
  const first = typeof d.notes === "string" ? d.notes.split(/\r?\n/)[0]!.trim() : "";
  if (first) return first.length > 72 ? `${first.slice(0, 69)}…` : first.replace(/\.$/, "");
  return (d.service as { name?: string } | null | undefined)?.name ?? "Deal";
}

/** True when the API hid the value for this role (as opposed to a deal that simply has none yet). */
export function isMasked(d: Pick<DealItem, "valueMasked">): boolean {
  return d.valueMasked === true;
}

export function dealValue(d: Pick<DealItem, "value" | "currency" | "valueMasked">): number | null {
  if (d.valueMasked || d.value === null || d.value === undefined) return null;
  const n = Number(d.value);
  return Number.isFinite(n) ? n : null;
}

export interface Flag {
  key: string;
  label: string;
  icon: "clock" | "alert" | "send" | "archive" | "package" | "ban";
  tone: "orange" | "red" | "blue" | "neutral";
}

export function flagsFor(d: DealItem, handoff: HandoffStatus | undefined, lostReason?: string | null): Flag[] {
  const flags: Flag[] = [];
  const open = d.outcome === "OPEN";
  if (open && d.signals?.stalled) flags.push({ key: "stalled", label: `Stalled · ${d.signals.daysSinceActivity}d`, icon: "clock", tone: "orange" });
  if (open && d.signals?.closeDatePassed) flags.push({ key: "closePassed", label: "Close date passed", icon: "alert", tone: "red" });
  if (d.archivedAt) flags.push({ key: "archived", label: "Archived", icon: "archive", tone: "neutral" });
  if (d.outcome === "WON" && handoff) flags.push({ key: "handoff", label: handoff === "AWAITING_OWNER" ? "Needs delivery owner" : "Handed off", icon: "package", tone: "blue" });
  if (d.outcome === "LOST" && lostReason) flags.push({ key: "lost", label: lostReason, icon: "ban", tone: "red" });
  return flags;
}
