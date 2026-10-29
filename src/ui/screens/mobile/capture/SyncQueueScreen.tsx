"use client";

import { useState, useSyncExternalStore } from "react";
import { connectivity } from "../../../data/connectivity";
import { DemoBadge } from "../../../demo/DemoBadge";
import { Icon } from "../../leads/icons";
import { useQueue, useSyncNow } from "../data";
import { discardPhoto, retryPhotos, usePhotos } from "./photos";

/**
 * Waiting to sync (M4, FIG-1177), as a page: everything saved on this phone that has not reached the server yet, in the order it was made,
 * with Retry. Changes (notes, calls, captures) come from the real offline queue; photos are the demo's. When nothing is waiting it says the
 * phone is fully synced. A failed entry is explained and never overwritten: Send again or Discard, the person decides.
 */
export function SyncQueueScreen() {
  const { queue, items } = useQueue();
  const photos = usePhotos();
  const sync = useSyncNow();
  const conn = useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot, connectivity.getServerSnapshot);
  const [busy, setBusy] = useState(false);

  const waitingPhotos = photos.filter((p) => p.state === "WAITING");
  const total = items.length + waitingPhotos.length;

  async function sendAll() {
    setBusy(true);
    try {
      retryPhotos(conn.online);
      await sync();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fb-m-page" data-screen-label="Mobile · Sync queue">
      <h1 className="fb-m-h1">Waiting to sync</h1>
      <p className="fb-m-muted" role="status">
        {total === 0 ? "Everything on this phone has been sent." : conn.online ? `${total} waiting to send.` : `${total} saved on this phone. They send when you are back online.`}
      </p>

      {total === 0 ? (
        <div className="fb-m-synced" data-testid="sync-done">
          <Icon name="check" size={22} />
          <strong>All synced</strong>
          <span>Nothing is waiting.</span>
        </div>
      ) : (
        <ul className="fb-m-q" data-testid="sync-queue">
          {items.map((i) => (
            <li key={i.clientId}>
              <div className="fb-m-q__label">{i.label}</div>
              <div className="fb-m-q__state" data-state={i.state}>
                {i.state === "WAITING" ? (conn.online ? "Waiting to send" : "Waiting for a connection") : i.message}
              </div>
              <div className="fb-m-q__acts">
                <button type="button" className="fb-m-btn" aria-disabled={!conn.online || undefined} title={!conn.online ? "You are offline" : undefined} onClick={() => conn.online && (queue.retry(i.clientId), void sync())}>
                  <Icon name="refresh" size={15} /> Retry
                </button>
                <button type="button" className="fb-m-btn" onClick={() => queue.discard(i.clientId)}>
                  Discard
                </button>
              </div>
            </li>
          ))}
          {waitingPhotos.map((p) => (
            <li key={p.id}>
              <div className="fb-m-q__label">
                Photo: {p.name} <DemoBadge />
              </div>
              <div className="fb-m-q__state" data-state="WAITING">
                {conn.online ? "Waiting to send" : "Waiting for a connection"} · {p.size}
              </div>
              <div className="fb-m-q__acts">
                <button type="button" className="fb-m-btn" aria-disabled={!conn.online || undefined} title={!conn.online ? "You are offline" : undefined} onClick={() => retryPhotos(conn.online, p.id)}>
                  <Icon name="refresh" size={15} /> Retry
                </button>
                <button type="button" className="fb-m-btn" onClick={() => discardPhoto(p.id)}>
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > 0 ? (
        <button type="button" className="fb-m-btn fb-m-btn--primary" aria-disabled={!conn.online || busy || undefined} disabled={!conn.online || busy} onClick={() => void sendAll()}>
          {busy ? "Sending…" : "Send now"}
        </button>
      ) : null}
      {!conn.online ? <p className="fb-m-muted">You are offline. Everything above sends on its own when the connection is back.</p> : null}
    </div>
  );
}
