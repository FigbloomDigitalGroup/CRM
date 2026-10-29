/**
 * Saved views (X4, FIG-1173): the pure rules. Personal and shared views, pinned in the sidebar, renamed, reordered. Every function takes a list and
 * returns a new one, so the rules are unit tests and the store is only storage. A shared view is visible to a colleague only if their role may
 * open the list it filters (the same keys as the page itself), so sharing never widens what anyone can see.
 */

export type ViewPage = "leads";

export interface SavedView {
  id: string;
  page: ViewPage;
  name: string;
  /** What the list page needs to restore the view: its tab and filters. Opaque here. */
  state: { tab: string; filters: Record<string, string> };
  shared: boolean;
  pinned: boolean;
  /** Who made it. */
  by: string;
  byName: string;
  order: number;
}

const PAGE_KEYS: Record<ViewPage, string[]> = { leads: ["leads.view.own", "leads.view.all", "leads.view.shared"] };

export function canOpenPage(page: ViewPage, permissionKeys: readonly string[]): boolean {
  return PAGE_KEYS[page].some((k) => permissionKeys.includes(k));
}

/** The views this person sees: their own, and the shared ones for pages their role may open. Sorted by order. */
export function visibleViews(views: SavedView[], me: { membershipId: string; permissionKeys: readonly string[] }, page?: ViewPage): SavedView[] {
  return views
    .filter((v) => (page ? v.page === page : true))
    .filter((v) => canOpenPage(v.page, me.permissionKeys))
    .filter((v) => v.by === me.membershipId || v.shared)
    .sort((a, b) => a.order - b.order);
}

export function pinnedViews(views: SavedView[], me: { membershipId: string; permissionKeys: readonly string[] }): SavedView[] {
  return visibleViews(views, me).filter((v) => v.pinned);
}

const nextOrder = (views: SavedView[]) => views.reduce((m, v) => Math.max(m, v.order), 0) + 1;

export function nameProblem(name: string, views: SavedView[], ignoreId?: string): string | null {
  const n = name.trim();
  if (!n) return "Give the view a name.";
  if (n.length > 40) return "Keep the name under 40 characters.";
  if (views.some((v) => v.id !== ignoreId && v.name.toLowerCase() === n.toLowerCase())) return "You already have a view with that name.";
  return null;
}

export function addView(views: SavedView[], input: { name: string; page: ViewPage; state: SavedView["state"]; by: string; byName: string; id?: string }): SavedView[] {
  const problem = nameProblem(input.name, views.filter((v) => v.by === input.by));
  if (problem) throw new Error(problem);
  return [...views, { id: input.id ?? `v${Date.now().toString(36)}${views.length}`, page: input.page, name: input.name.trim(), state: input.state, shared: false, pinned: false, by: input.by, byName: input.byName, order: nextOrder(views) }];
}

export function renameView(views: SavedView[], id: string, name: string): SavedView[] {
  const v = views.find((x) => x.id === id);
  if (!v) return views;
  const problem = nameProblem(name, views.filter((x) => x.by === v.by), id);
  if (problem) throw new Error(problem);
  return views.map((x) => (x.id === id ? { ...x, name: name.trim() } : x));
}

export const setShared = (views: SavedView[], id: string, shared: boolean) => views.map((v) => (v.id === id ? { ...v, shared } : v));
export const setPinned = (views: SavedView[], id: string, pinned: boolean) => views.map((v) => (v.id === id ? { ...v, pinned } : v));
export const removeView = (views: SavedView[], id: string) => views.filter((v) => v.id !== id);

/** Moves a view one place up or down among the views this person sees, and renumbers so the order stays clean. */
export function moveView(views: SavedView[], id: string, delta: -1 | 1, me: { membershipId: string; permissionKeys: readonly string[] }): SavedView[] {
  const seen = visibleViews(views, me);
  const from = seen.findIndex((v) => v.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= seen.length) return views;
  const next = [...seen];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const order = new Map(next.map((v, i) => [v.id, i + 1]));
  return views.map((v) => (order.has(v.id) ? { ...v, order: order.get(v.id)! } : v));
}

/** Only the person who made a view may rename, share, pin or delete it. A shared, pinned view appears in every permitted colleague's sidebar. */
export const mayEdit = (v: SavedView, membershipId: string) => v.by === membershipId;
