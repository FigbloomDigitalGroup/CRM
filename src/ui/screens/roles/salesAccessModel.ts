import { buildNav } from "../../shell/navigation";
import { CAPABILITIES, OWN_TOOLS, type Capability } from "./demo/data";

/**
 * Sales access (UC-C4): the pure rules behind the 13 switches and the live preview. The sidebar preview is `buildNav` over the derived key set, the same
 * function the real shell uses, so it cannot drift from the real navigation. Only the keys that exist today change the sidebar; the proposed keys
 * (UC-C3) change the lists of actions in the lead and deal drawers, which are described here, not drawn by real screens.
 */

const byN = (n: number): Capability => CAPABILITIES.find((c) => c.n === n)!;

/** Why a switch cannot be turned on right now (a switch it needs is off), or null. */
export function lockedReason(n: number, on: readonly number[]): string | null {
  const missing = byN(n).needs.filter((m) => !on.includes(m));
  return missing.length ? `Needs ${missing.map((m) => byN(m).label.toLowerCase()).join(" and ")} switched on first.` : null;
}

/** Turning a switch off also turns off everything that depends on it, so the set is always consistent. */
export function setSwitch(on: readonly number[], n: number, value: boolean): number[] {
  if (value) return lockedReason(n, on) ? [...on] : [...new Set([...on, n])].sort((a, b) => a - b);
  let next = on.filter((x) => x !== n);
  for (let changed = true; changed; ) {
    const before = next.length;
    next = next.filter((x) => byN(x).needs.every((m) => next.includes(m)));
    changed = next.length !== before;
  }
  return next;
}

export function derivedKeys(on: readonly number[]): string[] {
  const keys = new Set(OWN_TOOLS);
  for (const n of on) {
    const c = byN(n);
    if (c.exists) keys.add(c.key);
  }
  // Working a deal needs a way to see it (a view key rides along with ownership or assistance).
  if (on.includes(7) || on.includes(8) || on.includes(6)) keys.add("deals.view.own");
  if (on.includes(10)) keys.add("quotes.view");
  return [...keys];
}

export function previewNav(on: readonly number[]): { section: string; items: string[] }[] {
  return buildNav({ permissionKeys: derivedKeys(on), membershipId: "preview" }).map((s) => ({ section: s.label, items: s.items.map((i) => i.label) }));
}

export interface HomeTile {
  label: string;
  value: string;
}

/** The home tiles. With financial visibility off, "My pipeline value" is left out and "Won this month" shows a count, not KES. */
export function homeTiles(on: readonly number[]): HomeTile[] {
  const money = on.includes(13);
  const works = on.includes(6) || on.includes(7) || on.includes(8);
  const tiles: HomeTile[] = [{ label: "My tasks today", value: "6" }, { label: "New leads this week", value: on.includes(1) || on.includes(2) ? "14" : "—" }];
  if (works) {
    if (money) tiles.push({ label: "My pipeline value", value: "KES 4.2M" });
    tiles.push({ label: "Won this month", value: money ? "KES 1.8M" : "3 deals" });
  }
  return tiles.filter((t) => t.value !== "—");
}

export function drawerActions(on: readonly number[]): { lead: string[]; deal: string[] } {
  const lead: string[] = [];
  if (on.includes(1)) lead.push("Add lead");
  if (on.includes(2)) lead.push("Set the source");
  if (on.includes(3)) lead.push("Qualify");
  if (on.includes(4)) lead.push("Assign to a person");
  if (on.includes(5)) lead.push("Transfer to Sales");
  const deal: string[] = [];
  if (on.includes(6)) deal.push("Open a deal");
  if (on.includes(7)) deal.push("Edit own deals");
  if (on.includes(8)) deal.push("Join as assistant");
  if (on.includes(9)) deal.push("Add scoping notes");
  if (on.includes(10)) deal.push("Create a quote");
  if (on.includes(11)) deal.push("Move stage");
  if (on.includes(12)) deal.push("Close won or lost");
  return { lead, deal };
}
