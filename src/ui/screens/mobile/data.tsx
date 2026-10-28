"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { connectivity } from "../../data/connectivity";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { getQueue, type OfflineQueue, type QueueItem, type QueueKind, type SendBatch, type SyncResultItem } from "./queue";

const NONE: readonly QueueItem[] = [];

/** The person's offline queue on this device, live. `waiting` also feeds the offline banner through the connectivity service. */
export function useQueue(): { queue: OfflineQueue; items: readonly QueueItem[]; waiting: number; attention: number } {
  const { orgSlug, membershipId } = useMember();
  const queue = useMemo(() => getQueue(orgSlug, membershipId, (n) => connectivity.setQueued(n)), [orgSlug, membershipId]);
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => NONE);
  return {
    queue,
    items,
    waiting: items.filter((i) => i.state === "WAITING").length,
    attention: items.filter((i) => i.state !== "WAITING").length,
  };
}

/** Sends the waiting entries to `POST /sync/batch`. Resolves with what happened; never throws. */
export function useSyncNow() {
  const api = useApi();
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  const { queue } = useQueue();
  return useCallback(async () => {
    const send: SendBatch = async (mutations) => {
      const res = await api.call("applySyncBatch", { params: { orgSlug }, body: { mutations: mutations.map((m) => ({ ...m })) } });
      return { results: (res.results ?? []) as unknown as SyncResultItem[] };
    };
    const out = await queue.flush(send);
    if (out.applied > 0) await qc.invalidateQueries();
    return out;
  }, [api, orgSlug, queue, qc]);
}

export type WriteOutcome = { status: "applied"; item: QueueItem } | { status: "queued"; item: QueueItem } | { status: "attention"; item: QueueItem };

/**
 * One way to save in the field. The action is written to the queue first (with its client id) and sent at once when the phone is online, so
 * online and offline are the same path and the server's client-id claim is the only thing that decides "once": a dropped connection after
 * the server applied it cannot make a second copy.
 */
export function useFieldWrite() {
  const { queue } = useQueue();
  const sync = useSyncNow();
  return useCallback(
    async (kind: QueueKind, payload: Record<string, unknown>, label: string): Promise<WriteOutcome> => {
      const item = queue.add({ kind, payload, label });
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "queued", item };
      await sync();
      const now = queue.list().find((i) => i.clientId === item.clientId);
      if (!now) return { status: "applied", item };
      return now.state === "WAITING" ? { status: "queued", item: now } : { status: "attention", item: now };
    },
    [queue, sync],
  );
}

/** True when a failure means "no connection" rather than "the server said no". */
export function isNetworkFailure(err: unknown): boolean {
  return describeError(err).kind === "offline";
}

/** Local time helpers for the phone's short labels ("Today", "Tomorrow", "Overdue 2 days"). */
export function dueLabel(iso: string | null | undefined, now = new Date()): { text: string; tone: "overdue" | "today" | "later" } {
  if (!iso) return { text: "No due date", tone: "later" };
  const due = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / 86_400_000);
  const time = due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days < 0) return { text: days === -1 ? "Overdue since yesterday" : `Overdue ${-days} days`, tone: "overdue" };
  if (days === 0) return { text: due.getHours() === 0 && due.getMinutes() === 0 ? "Today" : `Today ${time}`, tone: "today" };
  if (days === 1) return { text: "Tomorrow", tone: "later" };
  return { text: due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), tone: "later" };
}

export function ago(iso: string, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
