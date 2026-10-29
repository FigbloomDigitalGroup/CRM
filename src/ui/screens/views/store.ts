"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SavedView } from "./model";

/**
 * Where saved views are kept for the demo: this device's storage, per organisation. Sharing is therefore simulated (a shared view is simply one
 * flagged shared, and a seeded colleague's view shows how it appears). B6.16 replaces this module with the API; the model and screens stay.
 * Demo data: docs/RESTRUCTURE_LOG.md.
 */

const key = (org: string) => `figbloom-saved-views:${org}`;
const EVENT = "figbloom-saved-views";

const SEED = (): SavedView[] => [
  { id: "demo-sv1", page: "leads", name: "Hot, not yet contacted", state: { tab: "all", filters: { temp: "HOT" } }, shared: true, pinned: false, by: "demo-colleague", byName: "Wanjiru", order: 1 },
];

const cache = new Map<string, { raw: string | null; value: SavedView[] }>();

export function readViews(org: string): SavedView[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(org));
  } catch {
    /* blocked storage: show the seeded demo view only */
  }
  const hit = cache.get(org);
  if (hit && hit.raw === raw) return hit.value;
  let value: SavedView[];
  try {
    value = raw ? (JSON.parse(raw) as SavedView[]) : SEED();
  } catch {
    value = SEED();
  }
  cache.set(org, { raw, value });
  return value;
}

export function writeViews(org: string, views: SavedView[]): void {
  try {
    localStorage.setItem(key(org), JSON.stringify(views));
  } catch {
    cache.set(org, { raw: null, value: views });
  }
  window.dispatchEvent(new Event(EVENT));
}

const EMPTY: SavedView[] = [];

export function useSavedViews(org: string): [SavedView[], (next: SavedView[]) => void] {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);
  const views = useSyncExternalStore(subscribe, () => readViews(org), () => EMPTY);
  const set = useCallback((next: SavedView[]) => writeViews(org, next), [org]);
  return [views, set];
}
