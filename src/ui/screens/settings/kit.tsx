"use client";

import type { ReactNode } from "react";
import { describeError } from "../../errors";
import { ErrorState, LoadingState } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";

/** Small pieces every Settings page is built from (M9, F4.04 onward): the section card, the switch, the query gate and the error toast. */

export function Panel({ title, description, actions, children, flush, level = 2 }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; flush?: boolean; level?: 2 | 3 }) {
  const Heading = `h${level}` as "h2" | "h3";
  return (
    <section className={flush ? "fb-set-panel fb-set-panel--flush" : "fb-set-panel"}>
      {title || actions ? (
        <header className="fb-set-panel__head">
          <div>
            {title ? <Heading className="fb-set-panel__title">{title}</Heading> : null}
            {description ? <p className="fb-set-panel__desc">{description}</p> : null}
          </div>
          {actions ? <div className="fb-set-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A switch that reads as one control to a screen reader ("Remind about follow-ups, on"). */
export function Switch({ checked, onChange, label, disabled, disabledReason }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; disabledReason?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={disabledReason}
      aria-disabled={disabled || undefined}
      className="fb-set-switch"
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="fb-set-switch__knob" aria-hidden="true" />
    </button>
  );
}

export function useReport() {
  const toast = useToast();
  return {
    ok: (message: string) => toast.show({ message, tone: "success" }),
    fail: (error: unknown, what = "That did not save") => {
      const d = describeError(error);
      toast.show({ message: d.kind === "validation" || d.kind === "conflict" ? d.body : `${what}. ${d.body}`, tone: "danger" });
    },
  };
}

interface QueryLike {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** Loading, then error (a 403 becomes the explained no-access card), then the content. */
export function Gate({ q, area, children, lines }: { q: QueryLike; area: string; children: ReactNode; lines?: number }) {
  if (q.isLoading) return <LoadingState lines={lines ?? 4} />;
  if (q.isError) return <ErrorState error={q.error} area={area} onRetry={() => void q.refetch()} />;
  return <>{children}</>;
}

/** When something happened, written the way the member's preferences say. */
export function useWhen() {
  const { timeZone, hour12 } = useMember();
  return (value: unknown, fallback = "Never"): string => {
    if (!value) return fallback;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return fallback;
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12, ...(timeZone ? { timeZone } : {}) }).format(d);
  };
}

export function rel(value: unknown): string {
  if (!value) return "Never";
  const t = new Date(String(value)).getTime();
  if (Number.isNaN(t)) return "Never";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
