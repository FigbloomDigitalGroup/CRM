"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { tone } from "./logic";
import { usePlatform } from "./store";

/** Small pieces shared by the console's screens. The console has its own look (see platform.css), so these are not the tenant app's `@/ui` components. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const t = tone(status);
  return (
    <span className="fb-pl-pill" style={{ background: t.bg, color: t.fg }}>
      {label ?? status}
    </span>
  );
}

export function ReleaseTag({ release }: { release: "V1.1" | "V2" }) {
  return <span className={cx("fb-pl-rel", release === "V2" ? "fb-pl-rel--v2" : "fb-pl-rel--v11")}>{release}</span>;
}

export function PageHead({ title, sub, release, children }: { title: string; sub?: ReactNode; release?: "V1.1" | "V2"; children?: ReactNode }) {
  return (
    <div className="fb-pl-head">
      <div>
        <div className="fb-pl-title-row">
          <h1 className="fb-pl-h1">{title}</h1>
          {release ? <ReleaseTag release={release} /> : null}
        </div>
        {sub ? <div className="fb-pl-sub">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** A modal dialog: Escape closes, focus moves in and returns, Tab stays inside. */
export function PlDialog({ open, onClose, title, label, children }: { open: boolean; onClose: () => void; title: string; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>("textarea, input, select, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && node) {
        const f = [...node.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fb-pl-overlay" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} data-screen-label={label} className="fb-pl-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = usePlatform();
  return (
    <div className="fb-pl-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="fb-pl-toast">
          <span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function dateShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function whenLabel(d: Date, now: Date): string {
  const same = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return same ? `Today ${t}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${t}`;
}

export function agoLabel(d: Date, now: Date): string {
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
