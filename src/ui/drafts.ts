"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Drafts (F1.04: "expiry returns to the sign-in page without data loss (drafts kept)"). A form that wants to survive a session ending keeps its
 * state here. The session guard announces `SESSION_ENDING_EVENT` just before it sends the person to sign in; every active draft writes itself
 * out at that moment, and the form restores it on the next visit. Stored in this browser only, under a key per form and per person, and
 * dropped as soon as the form is saved or discarded. Nothing is sent anywhere.
 */

export const SESSION_ENDING_EVENT = "figbloom:session-ending";
const PREFIX = "figbloom-draft:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Stored<T> {
  at: number;
  value: T;
}

export function saveDraft<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value } satisfies Stored<T>));
  } catch {
    // Storage full or blocked: the draft is simply not kept.
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored<T>;
    if (Date.now() - stored.at > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return stored.value;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to do.
  }
}

/**
 * Keeps `value` as a draft while the form is dirty. Returns `restore()` (what was saved last time, or null) and `discard()` (call it when the form
 * is saved or cancelled). Pass the person's id in `key` so two people on one browser never see each other's drafts.
 */
export function useDraft<T>(key: string, value: T, dirty: boolean) {
  const latest = useRef({ value, dirty });
  latest.current = { value, dirty };

  useEffect(() => {
    const flush = () => {
      if (latest.current.dirty) saveDraft(key, latest.current.value);
    };
    window.addEventListener(SESSION_ENDING_EVENT, flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener(SESSION_ENDING_EVENT, flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [key]);

  const restore = useCallback(() => loadDraft<T>(key), [key]);
  const discard = useCallback(() => clearDraft(key), [key]);
  return { restore, discard };
}
