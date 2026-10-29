"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { seedPlatform, type PlatformState } from "./demo/data";
import { apply, supportMsLeft, type Action, type Result } from "./logic";

/**
 * The console's data source. Today it holds the demo records in memory for the length of the visit (a reload starts again); wiring to the real
 * API (M13) means replacing `dispatch` with calls and `state` with queries, and the screens do not change. Lives in the platform layout, so
 * moving between console pages keeps what the demo changed.
 */

interface Toast {
  id: number;
  text: string;
}

interface PlatformApi {
  state: PlatformState;
  now: Date;
  dispatch: (a: Action) => Result;
  toast: (text: string) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const Ctx = createContext<PlatformApi | null>(null);

export function PlatformStoreProvider({ children, initial }: { children: ReactNode; initial?: PlatformState }) {
  const [state, setState] = useState<PlatformState>(() => initial ?? seedPlatform());
  const ref = useRef(state);
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const dispatch = useCallback(
    (a: Action): Result => {
      const out = apply(ref.current, a, new Date());
      ref.current = out.state;
      setState(out.state);
      if (out.result.message) toast(out.result.message);
      return out.result;
    },
    [toast],
  );

  // The support countdown ticks once a second, and only while a session runs.
  const active = state.activeSupport;
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      const n = new Date();
      setNow(n);
      const s = ref.current.support.find((p) => p.id === active);
      if (s && supportMsLeft(s, n) <= 0) {
        const out = apply(ref.current, { type: "support-expire", id: active }, n);
        ref.current = out.state;
        setState(out.state);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [active]);

  const value = useMemo<PlatformApi>(() => ({ state, now, dispatch, toast, toasts, dismissToast }), [state, now, dispatch, toast, toasts, dismissToast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatform(): PlatformApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlatform must be used inside the platform console");
  return v;
}
