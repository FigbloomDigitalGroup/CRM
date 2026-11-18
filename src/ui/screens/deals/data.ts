"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import type { DealItem, HandoffRow, RefData } from "./model";

/** Every deals read hangs off this key prefix, so a move or an edit can refresh them all at once. */
export const DEALS_KEY = "dl";
const PAGE = 100;
/** A board holds the first 500 deals; beyond that the screen says so and the filters narrow it. */
const MAX_PAGES = 5;

export function useRefData(): { data: RefData | undefined; isLoading: boolean; error: unknown } {
  const { orgSlug } = useMember();
  const q = useApiQuery("getReferenceData", { params: { orgSlug } }, { staleTime: 5 * 60_000 });
  const data = useMemo<RefData | undefined>(() => {
    if (!q.data) return undefined;
    const r = q.data as unknown as {
      pipelineStages: RefData["stages"];
      lostReasons: RefData["lostReasons"];
      services: RefData["services"];
      members: RefData["members"];
    };
    return {
      stages: [...r.pipelineStages].filter((s) => s.isActive !== false).sort((a, b) => a.sequence - b.sequence),
      lostReasons: r.lostReasons,
      services: r.services,
      members: r.members,
    };
  }, [q.data]);
  return { data, isLoading: q.isLoading, error: q.error };
}

export interface DealsPage {
  items: DealItem[];
  total: number;
  truncated: boolean;
}

export function dealsKey(orgSlug: string, includeArchived: boolean) {
  return [DEALS_KEY, "all", orgSlug, includeArchived] as const;
}

/** All deals the person may see, a hundred at a time, newest activity first. The board and the list are both drawn from this one read. */
export function useAllDeals(includeArchived: boolean) {
  const api = useApi();
  const { orgSlug } = useMember();
  return useQuery<DealsPage>({
    queryKey: dealsKey(orgSlug, includeArchived),
    queryFn: async ({ signal }) => {
      const items: DealItem[] = [];
      let total = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = (await api.call("getDeals", {
          params: { orgSlug },
          query: { pageSize: String(PAGE), page: String(page), includeArchived: includeArchived ? "true" : "false" },
          signal,
        })) as unknown as { items: DealItem[]; total: number };
        items.push(...res.items);
        total = res.total;
        if (items.length >= total) break;
      }
      return { items, total, truncated: items.length < total };
    },
  });
}

/** The handoff status of each won deal, for the "Handed off" and "Needs delivery owner" flags. A role that may not see handoffs simply gets none. */
export function useHandoffStatuses(enabled: boolean) {
  const api = useApi();
  const { orgSlug } = useMember();
  return useQuery<Map<string, HandoffRow["status"]>>({
    queryKey: [DEALS_KEY, "handoff-status", orgSlug],
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const map = new Map<string, HandoffRow["status"]>();
      try {
        const res = (await api.call("getHandoffs", { params: { orgSlug }, query: { pageSize: String(PAGE) }, signal })) as unknown as { items: HandoffRow[] };
        for (const h of res.items) map.set(h.dealId, h.status);
      } catch {
        /* not part of this role's view */
      }
      return map;
    },
  });
}

export function useRefreshDeals() {
  const qc = useQueryClient();
  // A deal's page draws from several reads (the deal, proposals, timeline, tasks, handoff); any change can touch each, so every active read is refreshed.
  return () => {
    void qc.invalidateQueries();
  };
}

/**
 * Who a membership is, in words. The member list is only given to roles that may see it (Management), so a salesperson's own deals name
 * themselves, and anyone else's falls back to a plain "Team member" rather than a guess.
 */
export function useMemberName(): (membershipId: string | null | undefined) => string {
  const me = useMember();
  const ref = useRefData();
  return (membershipId) => {
    if (!membershipId) return "Unassigned";
    if (membershipId === me.membershipId) return me.userName;
    return ref.data?.members.find((m) => m.membershipId === membershipId)?.userName ?? "Team member";
  };
}
