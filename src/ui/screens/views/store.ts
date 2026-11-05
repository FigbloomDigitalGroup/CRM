"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import type { SavedView, ViewPage } from "./model";

/**
 * Saved views on the real API (FIG-1148, docs/SAVED_VIEWS.md): `/views` for the list and the writes, `/views/{id}/pin` and `/views/pinned-order` for
 * the person's own sidebar. The server decides who sees a view, removes parts a role may not use and answers 404 for the rest; this module only maps
 * its answers to the shapes the bar draws (`model.ts` keeps the pure rules).
 */

export interface ViewDto {
  id: string;
  entity: string;
  name: string;
  scope: "PERSONAL" | "SHARED";
  filters?: Record<string, string | number | boolean | null | (string | number | boolean)[]>;
  hiddenParts?: unknown[];
  mine: boolean;
  ownerName: string | null;
  canEdit: boolean;
  pinned: boolean;
  pinPosition: number | null;
}

/** What goes to the server for a list set-up: the tab and the filters that are set (an empty filter is not stored). */
export function toFilters(state: SavedView["state"]): Record<string, string> {
  const out: Record<string, string> = { tab: state.tab };
  for (const [k, v] of Object.entries(state.filters)) if (v !== "" && v !== undefined && k !== "tab") out[k] = v;
  return out;
}

export function fromDto(v: ViewDto, membershipId: string, index: number): SavedView {
  const { tab, ...rest } = (v.filters ?? {}) as Record<string, unknown>;
  const filters: Record<string, string> = {};
  for (const [k, val] of Object.entries(rest)) if (typeof val === "string") filters[k] = val;
  return {
    id: v.id,
    page: v.entity as ViewPage,
    name: v.name,
    state: { tab: typeof tab === "string" ? tab : "all", filters },
    shared: v.scope === "SHARED",
    pinned: v.pinned,
    by: v.mine ? membershipId : `other:${v.ownerName ?? "colleague"}`,
    byName: v.ownerName ?? "A colleague",
    order: v.pinPosition ?? 1000 + index,
  };
}

/** The views this person may use for one list (or only the pinned ones, for the sidebar). */
export function useSavedViews(options: { entity?: string; pinned?: boolean; enabled?: boolean } = {}) {
  const member = useMember();
  const q = useApiQuery(
    "getViews",
    { params: { orgSlug: member.orgSlug }, query: { ...(options.entity ? { entity: options.entity } : {}), ...(options.pinned ? { pinned: "true" as const } : {}) } },
    { enabled: options.enabled ?? true, retry: false, staleTime: 15_000 },
  );
  const views = useMemo(() => ((q.data as { items?: ViewDto[] } | undefined)?.items ?? []).map((v, i) => fromDto(v, member.membershipId, i)), [q.data, member.membershipId]);
  return { views, query: q };
}

/** The writes. Each resolves when the server has answered and refreshes every view list; each throws the API's error (a taken name, a hidden part, no right to share). */
export function useViewActions() {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const done = async <T,>(p: Promise<T>) => {
    const r = await p;
    await qc.invalidateQueries({ queryKey: ["getViews"] });
    return r;
  };
  const params = (viewId: string) => ({ orgSlug, viewId });
  return {
    create: (input: { page: ViewPage; name: string; state: SavedView["state"] }) =>
      done(api.call("postViews", { params: { orgSlug }, body: { entity: input.page, name: input.name.trim(), filters: toFilters(input.state) } as never })),
    rename: (id: string, name: string) => done(api.call("patchViewsByViewId", { params: params(id), body: { name: name.trim() } as never })),
    setShared: (id: string, shared: boolean) => done(api.call("patchViewsByViewId", { params: params(id), body: { scope: shared ? "SHARED" : "PERSONAL" } as never })),
    setPinned: (id: string, pinned: boolean) => done(api.call("putViewsByViewIdPin", { params: params(id), body: { pinned } as never })),
    remove: (id: string) => done(api.call("deleteViewsByViewId", { params: params(id) })),
    reorderPinned: (ids: string[]) => done(api.call("putViewsPinnedOrder", { params: { orgSlug }, body: { ids } as never })),
  };
}
