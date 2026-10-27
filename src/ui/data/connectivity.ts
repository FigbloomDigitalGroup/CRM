/**
 * The connectivity service (F1.03 banners, shared with the offline queue in F4.12). One small observable the whole shell reads:
 * whether the browser is online, whether requests are slow, and how many changes are waiting to be sent. The data layer reports every
 * request's duration to it, so "slow connection" is measured from what the person is actually experiencing rather than guessed.
 */

export interface ConnectivityState {
  online: boolean;
  slow: boolean;
  /** Changes saved on this device and not yet sent (reported by the offline queue). */
  queued: number;
}

const SLOW_MS = 3000;
const FAST_MS = 1500;
const WINDOW = 5;

type Listener = () => void;

export class Connectivity {
  private state: ConnectivityState = { online: true, slow: false, queued: 0 };
  private recent: number[] = [];
  private listeners = new Set<Listener>();
  private serverSnapshot: ConnectivityState = { online: true, slow: false, queued: 0 };

  getSnapshot = (): ConnectivityState => this.state;
  getServerSnapshot = (): ConnectivityState => this.serverSnapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<ConnectivityState>) {
    const next = { ...this.state, ...patch };
    if (next.online === this.state.online && next.slow === this.state.slow && next.queued === this.state.queued) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  setOnline(online: boolean) {
    // Going offline clears "slow": the offline banner says more than the slow bar could.
    this.set(online ? { online } : { online, slow: false });
    if (online) this.recent = [];
  }

  setQueued(queued: number) {
    this.set({ queued: Math.max(0, queued) });
  }

  /** Slow when most of the last few requests were slow; recovers after two quick ones in a row. */
  reportRequest(durationMs: number) {
    this.recent = [...this.recent, durationMs].slice(-WINDOW);
    const slowCount = this.recent.filter((d) => d > SLOW_MS).length;
    const lastTwoFast = this.recent.length >= 2 && this.recent.slice(-2).every((d) => d < FAST_MS);
    // Two quick answers in a row end it even while older slow ones are still in the window.
    if (lastTwoFast) this.set({ slow: false });
    else if (slowCount >= 3) this.set({ slow: true });
  }

  /** The device itself says the link is very slow (Network Information API, where it exists). */
  setLinkSlow(slow: boolean) {
    this.set({ slow });
  }
}

export const connectivity = new Connectivity();

/** Wires the browser's own events to the service; returns the cleanup. Called once by the shell. */
export function watchBrowserConnectivity(service: Connectivity = connectivity): () => void {
  if (typeof window === "undefined") return () => undefined;
  const sync = () => service.setOnline(navigator.onLine !== false);
  sync();
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void } }).connection;
  const link = () => service.setLinkSlow(conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g");
  conn?.addEventListener?.("change", link);
  return () => {
    window.removeEventListener("online", sync);
    window.removeEventListener("offline", sync);
    conn?.removeEventListener?.("change", link);
  };
}
