"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Photos taken on the phone (M4, FIG-1177): this device's list of photos per record, with the "waiting to sync" state. Online, a photo goes straight
 * to the record's attachments through the API (`photoApi.ts`); one taken offline (or that failed to send) waits here, with its bytes held in memory,
 * until Retry or the next time the phone is online. There is no offline-queue entry for photos in the API yet (docs/CARD_CAPTURE.md), so a waiting
 * photo does not survive a page reload; the person is told to take it again.
 */

export type PhotoState = "WAITING" | "SENT";

export interface Photo {
  id: string;
  /** What it is attached to, "lead:abc". */
  record: string;
  name: string;
  size: string;
  state: PhotoState;
  takenAt: string;
}

const KEY = "figbloom-demo-photos";
const EVENT = "figbloom-demo-photos";
const NONE: Photo[] = [];
let cache: { raw: string | null; value: Photo[] } = { raw: null, value: NONE };

export function readPhotos(): Photo[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache.value;
  }
  if (raw === cache.raw) return cache.value;
  try {
    cache = { raw, value: raw ? (JSON.parse(raw) as Photo[]) : NONE };
  } catch {
    cache = { raw, value: NONE };
  }
  return cache.value;
}

function write(next: Photo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    cache = { raw: null, value: next };
  }
  window.dispatchEvent(new Event(EVENT));
}

const blobs = new Map<string, Blob>();
export const photoBlob = (id: string): Blob | undefined => blobs.get(id);

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function formatSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function addPhoto(record: string, file: { name: string; size: number }, isOnline = online(), bytes?: Blob): Photo {
  const photo: Photo = { id: `ph-${Date.now().toString(36)}-${readPhotos().length}`, record, name: file.name || "Photo.jpg", size: formatSize(file.size), state: isOnline ? "SENT" : "WAITING", takenAt: new Date().toISOString() };
  if (bytes && !isOnline) blobs.set(photo.id, bytes);
  write([...readPhotos(), photo]);
  return photo;
}

/** Sends what is waiting, if the phone is online. Returns how many went. */
export function retryPhotos(isOnline = online(), only?: string): number {
  if (!isOnline) return 0;
  let n = 0;
  write(
    readPhotos().map((p) => {
      if (p.state === "WAITING" && (!only || p.id === only)) {
        n += 1;
        return { ...p, state: "SENT" as const };
      }
      return p;
    }),
  );
  return n;
}

/** Marks one waiting photo as sent, after the API accepted it. */
export function markPhotoSent(id: string) {
  blobs.delete(id);
  write(readPhotos().map((p) => (p.id === id ? { ...p, state: "SENT" as const } : p)));
}

export const discardPhoto = (id: string) => {
  blobs.delete(id);
  write(readPhotos().filter((p) => p.id !== id));
};

export function usePhotos(): Photo[] {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
  }, []);
  return useSyncExternalStore(subscribe, readPhotos, () => NONE);
}
