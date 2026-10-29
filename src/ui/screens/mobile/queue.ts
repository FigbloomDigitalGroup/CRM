/**
 * The offline queue (F4.12, B4.07). What a person does while the signal is gone is saved on this phone as one small entry per action,
 * each with a client id the phone invents. When the connection is back the entries go to `POST /sync/batch` in the order they were made.
 *
 * Safety rules, all tested in tests/components/mobile/queue.test.ts:
 *  - an entry is removed only when the server answers APPLIED or DUPLICATE (both mean "it is there once"); a dropped connection changes
 *    nothing, so a retry sends the same client ids and the server answers DUPLICATE instead of repeating the action (no duplicates, ever);
 *  - a CONFLICT or REJECTED answer keeps the entry with the server's reason in plain words; it is never resent on its own and never
 *    overwrites anything: the person decides (send again, or discard);
 *  - only the kinds the server accepts offline are queued; the pipeline is read-only offline by design (design M2).
 */

export const QUEUE_KINDS = ["QUICK_CAPTURE", "CALL_LOG", "WHATSAPP_LOG", "NOTE_ADD", "TASK_CREATE", "TASK_COMPLETE"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];
export type QueueState = "WAITING" | "CONFLICT" | "REJECTED";

export interface QueueItem {
  clientId: string;
  kind: QueueKind;
  payload: Record<string, unknown>;
  /** When the person did it (ISO): the server stamps the record with this, so the timeline reads in the order things happened. */
  clientCreatedAt: string;
  /** A short human description for the waiting list ("Call with Chebet"). */
  label: string;
  state: QueueState;
  /** What the server said, for CONFLICT and REJECTED. */
  message?: string;
  serverState?: Record<string, unknown>;
  attempts: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SyncResultItem {
  clientId: string;
  status: "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED";
  reason?: { code?: string; message?: string };
  serverState?: Record<string, unknown>;
}
export interface OutgoingMutation {
  clientId: string;
  kind: string;
  payload: Record<string, unknown>;
  clientCreatedAt: string;
}
export type SendBatch = (mutations: OutgoingMutation[]) => Promise<{ results: SyncResultItem[] }>;

export const MAX_BATCH = 100;

export function newClientId(): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `m-${rand}`;
}

type Listener = () => void;

export class OfflineQueue {
  private items: QueueItem[];
  private listeners = new Set<Listener>();
  private flushing = false;
  private snapshot: readonly QueueItem[];

  constructor(
    private readonly key: string,
    private readonly store: KeyValueStore | null,
    private readonly onCount?: (waiting: number) => void,
  ) {
    this.items = this.read();
    this.snapshot = [...this.items];
    this.onCount?.(this.waiting());
  }

  private read(): QueueItem[] {
    try {
      const raw = this.store?.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as QueueItem[];
      return Array.isArray(parsed) ? parsed.filter((i) => i && typeof i.clientId === "string" && QUEUE_KINDS.includes(i.kind)) : [];
    } catch {
      return [];
    }
  }

  private commit(next: QueueItem[]) {
    this.items = next;
    this.snapshot = [...next];
    try {
      this.store?.setItem(this.key, JSON.stringify(next));
    } catch {
      /* storage full or blocked: the queue still works for this page's lifetime */
    }
    this.onCount?.(this.waiting());
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = (): readonly QueueItem[] => this.snapshot;

  list(): readonly QueueItem[] {
    return this.items;
  }
  waiting(): number {
    return this.items.filter((i) => i.state === "WAITING").length;
  }
  needsAttention(): number {
    return this.items.filter((i) => i.state !== "WAITING").length;
  }

  add(input: { kind: QueueKind; payload: Record<string, unknown>; label: string; clientId?: string; at?: Date }): QueueItem {
    const clientId = input.clientId ?? newClientId();
    // The same client id twice (a double tap) is one entry.
    const existing = this.items.find((i) => i.clientId === clientId);
    if (existing) return existing;
    const item: QueueItem = {
      clientId,
      kind: input.kind,
      payload: input.payload,
      clientCreatedAt: (input.at ?? new Date()).toISOString(),
      label: input.label,
      state: "WAITING",
      attempts: 0,
    };
    this.commit([...this.items, item]);
    return item;
  }

  discard(clientId: string) {
    this.commit(this.items.filter((i) => i.clientId !== clientId));
  }

  /** "Send again": a conflicted or refused entry goes back to waiting. */
  retry(clientId: string) {
    this.commit(this.items.map((i) => (i.clientId === clientId ? { ...i, state: "WAITING" as const, message: undefined, serverState: undefined } : i)));
  }

  /** Changes what an entry will send (a duplicate the person decided about: create anyway, merge) and puts it back in line. */
  amend(clientId: string, payload: Record<string, unknown>) {
    this.commit(this.items.map((i) => (i.clientId === clientId ? { ...i, payload, state: "WAITING" as const, message: undefined, serverState: undefined } : i)));
  }

  /**
   * Sends everything waiting, in the order it was made. Never throws. Only one flush runs at a time, so two "back online" events cannot
   * send the same entries twice at once (and the server would answer DUPLICATE anyway).
   */
  async flush(send: SendBatch): Promise<{ sent: number; applied: number; attention: number; offline: boolean }> {
    if (this.flushing) return { sent: 0, applied: 0, attention: this.needsAttention(), offline: false };
    this.flushing = true;
    let sent = 0;
    let applied = 0;
    try {
      for (;;) {
        const batch = this.items
          .filter((i) => i.state === "WAITING")
          .sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt))
          .slice(0, MAX_BATCH);
        if (batch.length === 0) break;
        let response: { results: SyncResultItem[] };
        try {
          response = await send(batch.map((i) => ({ clientId: i.clientId, kind: i.kind, payload: i.payload, clientCreatedAt: i.clientCreatedAt })));
        } catch {
          // No answer: nothing is removed. The same client ids go again next time.
          const ids = new Set(batch.map((b) => b.clientId));
          this.commit(this.items.map((i) => (ids.has(i.clientId) ? { ...i, attempts: i.attempts + 1 } : i)));
          return { sent, applied, attention: this.needsAttention(), offline: true };
        }
        const byId = new Map(response.results.map((r) => [r.clientId, r] as const));
        const inBatch = new Set(batch.map((b) => b.clientId));
        let progressed = false;
        const next: QueueItem[] = [];
        for (const item of this.items) {
          const r = inBatch.has(item.clientId) ? byId.get(item.clientId) : undefined;
          if (!r) {
            next.push(item);
            continue;
          }
          progressed = true;
          sent += 1;
          if (r.status === "APPLIED" || r.status === "DUPLICATE") {
            applied += 1;
            continue;
          }
          next.push({ ...item, state: r.status, message: r.reason?.message ?? explain(r.status), serverState: r.serverState, attempts: item.attempts + 1 });
        }
        this.commit(next);
        // An answer missing for every entry would loop forever: stop when a pass changed nothing.
        if (!progressed) break;
      }
      return { sent, applied, attention: this.needsAttention(), offline: false };
    } finally {
      this.flushing = false;
    }
  }
}

function explain(status: string): string {
  return status === "CONFLICT" ? "The server has something different, so this was not applied." : "The server could not apply this.";
}

/** One queue per person per organisation, kept on the device. */
export function queueKey(orgSlug: string, membershipId: string): string {
  return `figbloom-offline-queue:${orgSlug}:${membershipId}`;
}

const queues = new Map<string, OfflineQueue>();
export function getQueue(orgSlug: string, membershipId: string, onCount?: (waiting: number) => void): OfflineQueue {
  const key = queueKey(orgSlug, membershipId);
  let q = queues.get(key);
  if (!q) {
    let store: KeyValueStore | null = null;
    try {
      store = typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      store = null;
    }
    q = new OfflineQueue(key, store, onCount);
    queues.set(key, q);
  }
  return q;
}
