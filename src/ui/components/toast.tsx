"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "../internal";

/**
 * Toasts with Undo (design: "every destructive or stage-changing action gives an Undo toast for 5 seconds"). A toast stays while it is
 * hovered or has keyboard focus, so nobody loses an Undo they are reaching for. Danger toasts are announced at once (`role="alert"`),
 * the rest politely.
 */

export interface ToastInput {
  message: string;
  tone?: "success" | "info" | "danger";
  /** Makes it an undo toast: the button runs this, then the toast goes. */
  undo?: () => void | Promise<void>;
  undoLabel?: string;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export const UNDO_WINDOW_MS = 5000;

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = next.current++;
    setItems((list) => [...list.slice(-3), { ...toast, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fb-toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <ToastView key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: ToastItem; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  const ms = toast.durationMs ?? (toast.undo ? UNDO_WINDOW_MS : 4000);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [held, ms, onDone]);
  const danger = toast.tone === "danger";
  return (
    <div
      className={cx("fb-toast", danger && "fb-toast--danger")}
      role={danger ? "alert" : "status"}
      aria-live={danger ? "assertive" : "polite"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span>{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          className="fb-toast__action"
          onClick={async () => {
            await toast.undo?.();
            onDone();
          }}
        >
          {toast.undoLabel ?? "Undo"}
        </button>
      ) : null}
      <button type="button" className="fb-toast__close" aria-label="Dismiss" onClick={onDone}>
        ×
      </button>
    </div>
  );
}
