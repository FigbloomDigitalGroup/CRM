"use client";

import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../internal";
import { Tooltip } from "./overlays";

/* Buttons --------------------------------------------------------------------------------------------------------------------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
  /**
   * Why the button cannot be used right now ("Ask a Sales lead to assign this"). The button stays visible, is announced as unavailable, and
   * says why on hover and focus: roles get an explained "no", never a silent hide.
   */
  disabledReason?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabledReason, disabled, className, children, onClick, type = "button", ...rest },
  ref,
) {
  const blocked = Boolean(disabled || disabledReason || loading);
  const button = (
    <button
      ref={ref}
      type={type}
      className={cx("fb-btn", `fb-btn--${variant}`, size === "sm" && "fb-btn--sm", className)}
      // `aria-disabled` (not `disabled`) so a button with a reason stays focusable and its reason can be read.
      aria-disabled={blocked || undefined}
      data-loading={loading ? "true" : undefined}
      onClick={(e) => {
        if (blocked) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <span className="fb-spinner" aria-hidden="true" /> : null}
      {children}
      {loading ? <span className="fb-sr-only">Working</span> : null}
    </button>
  );
  return disabledReason ? <Tooltip text={disabledReason}>{button}</Tooltip> : button;
});

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; pressed?: boolean }>(
  function IconButton({ label, pressed, className, children, type = "button", ...rest }, ref) {
    return (
      <button ref={ref} type={type} className={cx("fb-iconbtn", className)} aria-label={label} title={label} aria-pressed={pressed} {...rest}>
        {children}
      </button>
    );
  },
);

/* Chips and badges ----------------------------------------------------------------------------------------------------------------- */

export function Chip({
  children,
  selected,
  onToggle,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  selected?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  if (!onRemove) {
    return (
      <button type="button" className="fb-chip" aria-pressed={onToggle ? Boolean(selected) : undefined} onClick={onToggle}>
        {children}
      </button>
    );
  }
  // A removable chip is a label and a separate remove button (a button inside a button is not valid, and not operable by keyboard).
  return (
    <span className="fb-chip fb-chip--group" data-selected={selected ? "true" : undefined}>
      {onToggle ? (
        <button type="button" className="fb-chip__label" aria-pressed={Boolean(selected)} onClick={onToggle}>
          {children}
        </button>
      ) : (
        <span>{children}</span>
      )}
      <button type="button" className="fb-chip__remove" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "purple";

/** A status is never colour alone: the word is always there, and the markers mode adds a shape. */
export function Badge({ tone = "neutral", children, wrap }: { tone?: Tone; children: ReactNode; /** Let a long message wrap (hints beside a field) instead of keeping one line. */ wrap?: boolean }) {
  return <span className={cx("fb-badge", `fb-badge--${tone}`, wrap && "fb-badge--wrap")}>{children}</span>;
}

export type Scope = "organisation" | "team" | "mine" | "read-only";
const SCOPE_LABEL: Record<Scope, string> = { organisation: "Organisation", team: "Team", mine: "Mine", "read-only": "Read-only" };

export function ScopePill({ scope, reason }: { scope: Scope; reason?: string }) {
  return (
    <span className={cx("fb-scope", `fb-scope--${scope}`)} title={reason}>
      {SCOPE_LABEL[scope]}
    </span>
  );
}

/** What `resolveScope` (`src/auth/permissions.ts`) reports, shown the way the design shows it. */
export function scopeFromResolution(scope: "own" | "organisation" | "read-only" | "none"): Scope | null {
  if (scope === "own") return "mine";
  if (scope === "organisation") return "organisation";
  if (scope === "read-only") return "read-only";
  return null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!;
  return letters.toUpperCase();
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;
  return (
    <span className="fb-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} role="img" aria-label={name}>
      {showImage ? <img src={src!} alt="" onError={() => setBroken(true)} /> : initialsOf(name)}
    </span>
  );
}

export function OwnerChip({ name, src }: { name: string | null | undefined; src?: string | null }) {
  if (!name) return <span className="fb-owner"><Badge tone="neutral">Unassigned</Badge></span>;
  return (
    <span className="fb-owner">
      <Avatar name={name} src={src} size={24} />
      {name}
    </span>
  );
}

export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <Chip onRemove={onRemove} removeLabel="Remove tag">
      {children}
    </Chip>
  );
}

/** A lead score: the number and the band in words ("72, Hot"), so colour is never the only signal. */
export function ScoreChip({ score, band }: { score: number; band: "HOT" | "WARM" | "COLD" }) {
  const tone: Tone = band === "HOT" ? "danger" : band === "WARM" ? "warning" : "info";
  return (
    <Badge tone={tone}>
      {score} · {band === "HOT" ? "Hot" : band === "WARM" ? "Warm" : "Cold"}
    </Badge>
  );
}

export function HealthChip({ health }: { health: "HEALTHY" | "WATCH" | "AT_RISK" }) {
  const map = { HEALTHY: ["success", "Healthy"], WATCH: ["warning", "Watch"], AT_RISK: ["danger", "At risk"] } as const;
  const [tone, label] = map[health];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ReleaseTag({ release }: { release: "v1" | "v1.1" | "v2" }) {
  return <Badge tone={release === "v1" ? "success" : "purple"}>{release.toUpperCase()}</Badge>;
}

/* Cards, KPI, timeline, kanban ----------------------------------------------------------------------------------------------------- */

export function Card({ title, children, actions, level = 2 }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; /** The heading level of the title: 2 under a page title, 3 inside another card. */ level?: 2 | 3 | 4 }) {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <section className="fb-card">
      {title || actions ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          {title ? <Heading className="fb-card__title">{title}</Heading> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function KpiTile({ label, value, trend, tone }: { label: string; value: ReactNode; trend?: string; tone?: "up" | "down" }) {
  return (
    <div className="fb-kpi">
      <span className="fb-kpi__label">{label}</span>
      <span className="fb-kpi__value">{value}</span>
      {trend ? (
        <span className="fb-kpi__trend" style={{ color: tone === "down" ? "var(--red)" : "var(--primary-text)" }}>
          {tone === "down" ? "▼ " : tone === "up" ? "▲ " : ""}
          {trend}
        </span>
      ) : null}
    </div>
  );
}

export function KanbanCard({ title, subtitle, footer, badges }: { title: ReactNode; subtitle?: ReactNode; footer?: ReactNode; badges?: ReactNode }) {
  return (
    <article className="fb-kanban-card">
      <strong>{title}</strong>
      {subtitle ? <span style={{ color: "var(--text-2)", fontSize: 13 }}>{subtitle}</span> : null}
      {badges ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{badges}</div> : null}
      {footer}
    </article>
  );
}

export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="fb-tl">{children}</ol>;
}

export function TimelineItem({ icon, title, meta, children }: { icon?: ReactNode; title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <li className="fb-tl__item">
      <span className="fb-tl__icon" aria-hidden="true">{icon}</span>
      <div>
        <div>{title}</div>
        {meta ? <div className="fb-tl__meta">{meta}</div> : null}
        {children}
      </div>
    </li>
  );
}

/* Banners ------------------------------------------------------------------------------------------------------------------------ */

export function Banner({
  tone = "info",
  icon,
  title,
  children,
  action,
  role,
}: {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className={cx("fb-banner", `fb-banner--${tone}`)} role={role ?? (tone === "danger" ? "alert" : "status")}>
      {icon ? <span aria-hidden="true" style={{ display: "flex", paddingTop: 1 }}>{icon}</span> : null}
      <div className="fb-banner__body">
        {title ? <strong>{title} </strong> : null}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ width = "100%", height = 14, radius }: { width?: number | string; height?: number | string; radius?: number }) {
  return <span className="fb-skel" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}
