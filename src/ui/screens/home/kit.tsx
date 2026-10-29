"use client";

import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock,
  Contact,
  FileText,
  Globe,
  Info,
  ListChecks,
  Lock,
  type LucideIcon,
  Package,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  X,
  PenLine,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/** The design's icon names, drawn with the app's one icon set. */
const ICONS: Record<string, LucideIcon> = {
  note: PenLine,
  alert: AlertTriangle,
  banknote: Banknote,
  bell: Bell,
  briefcase: BriefcaseBusiness,
  building: Building2,
  calendar: CalendarDays,
  chart: BarChart3,
  check: Check,
  "check-circle": CheckCircle2,
  "chevron-right": ChevronRight,
  clock: Clock,
  contact: Contact,
  file: FileText,
  globe: Globe,
  help: CircleHelp,
  info: Info,
  lock: Lock,
  package: Package,
  phone: Phone,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  sliders: SlidersHorizontal,
  tasks: ListChecks,
  trend: TrendingUp,
  "user-plus": UserPlus,
  users: Users,
  wallet: Wallet,
  x: X,
};

export function HIcon({ name, size = 16, stroke }: { name: string; size?: number; stroke?: number }) {
  const Cmp = ICONS[name] ?? Bell;
  return <Cmp size={size} strokeWidth={stroke} aria-hidden="true" />;
}

export type HomeTone = "orange" | "red" | "blue" | "green" | "purple";

/** A section card with the design's header: title, optional sub-line, optional action link. */
export function Panel({
  title,
  sub,
  action,
  children,
  padded,
  className,
  aside,
}: {
  title: ReactNode;
  sub?: ReactNode;
  action?: { label: string; href: string } | null;
  children?: ReactNode;
  /** True for content that is not a list of rows (a chart): the body gets its own padding. */
  padded?: boolean;
  className?: string;
  /** Quiet text at the right of the title row ("13 open"). */
  aside?: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`fb-hp ${className ?? ""}`} aria-labelledby={id}>
      <div className="fb-hp__head">
        <div>
          <h2 id={id} className="fb-hp__title">
            {title}
          </h2>
          {sub ? <div className="fb-hp__sub">{sub}</div> : null}
        </div>
        {aside ? <span className="fb-hp__aside">{aside}</span> : null}
        {action ? (
          <Link href={action.href} className="fb-hp__action">
            {action.label}
          </Link>
        ) : null}
      </div>
      {padded ? <div className="fb-hp__body">{children}</div> : children}
    </section>
  );
}

export interface KpiDef {
  key: string;
  label: string;
  value: ReactNode;
  sub: string;
  icon: string;
  tone: HomeTone;
  href?: string;
  /** Red when non-zero (Overdue). */
  alertWhenPositive?: boolean;
  numeric?: number;
}

export function KpiGrid({ items }: { items: KpiDef[] }) {
  return (
    <div className="fb-kpis">
      {items.map((k) => {
        const body = (
          <>
            <div className="fb-kpi2__top">
              <span className="fb-kpi2__label">{k.label}</span>
              <span className={`fb-kpi2__tile fb-tone--${k.tone}`} aria-hidden="true">
                <HIcon name={k.icon} size={18} />
              </span>
            </div>
            <div>
              <div className="fb-kpi2__n" data-alert={k.alertWhenPositive && (k.numeric ?? 0) > 0 ? "true" : undefined}>
                {k.value}
              </div>
              <div className="fb-kpi2__sub">{k.sub}</div>
            </div>
          </>
        );
        return k.href ? (
          <Link key={k.key} href={k.href} className="fb-kpi2" data-testid={`kpi-${k.key}`}>
            {body}
          </Link>
        ) : (
          <div key={k.key} className="fb-kpi2" data-testid={`kpi-${k.key}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Two independent columns of cards. Cards sit one under the other in each column, so a short card never leaves an empty gap beside a tall one
 * (a two-card grid row does). Narrow, it becomes one column in the reading order left[0], right[0], left[1], right[1].
 */
export function HCols({ left, right }: { left: ReactNode[]; right: ReactNode[] }) {
  return (
    <div className="fb-hcols">
      <div className="fb-hcols__in">
        <div className="fb-hcol">
          {left.map((n, i) => (
            <div key={i} className="fb-hcol__item" style={{ order: 2 * i + 1 }}>
              {n}
            </div>
          ))}
        </div>
        <div className="fb-hcol">
          {right.map((n, i) => (
            <div key={i} className="fb-hcol__item" style={{ order: 2 * i + 2 }}>
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div aria-hidden="true" className="fb-hstack">
      <div className="fb-kpis">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="fb-hskel" style={{ height: 132 }} />
        ))}
      </div>
      <div className="fb-hgrid fb-hgrid--2-1">
        <div className="fb-hskel" style={{ height: 320 }} />
        <div className="fb-hskel" style={{ height: 320 }} />
      </div>
    </div>
  );
}

/** A segmented control in the design's style (a tablist, arrow keys move between tabs). */
export function Seg<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; count?: number }[];
}) {
  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = options.findIndex((x) => x.id === value);
    const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length;
    onChange(options[next]!.id);
    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="fb-seg">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} tabIndex={value === o.id ? 0 : -1} className="fb-seg__tab" onClick={() => onChange(o.id)} onKeyDown={onKey}>
          {o.label}
          {o.count !== undefined ? <span className="fb-seg__n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* Charts: each draws from the same rows it offers as a table, and every mark carries its label and number, so colour is never the only cue. */

export interface ChartRow {
  label: string;
  /** The text shown for the value (already masked or formatted). */
  text: string;
  /** Extra table cells after the value. */
  extra?: string[];
}

export function ChartCard({
  title,
  sub,
  rows,
  columns,
  children,
  summary,
}: {
  title: string;
  sub?: ReactNode;
  rows: ChartRow[];
  /** Table headings: label, value, then extras. */
  columns: string[];
  /** The chart itself. */
  children: ReactNode;
  /** One sentence for screen readers, read in place of the picture. */
  summary: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  return (
    <section className="fb-hp" aria-labelledby={id}>
      <div className="fb-hp__head">
        <div>
          <h2 id={id} className="fb-hp__title">
            {title}
          </h2>
          {sub ? <div className="fb-hp__sub">{sub}</div> : null}
        </div>
        <div role="group" aria-label={`${title}: view`} className="fb-viewtoggle">
          <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
            Chart
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
            Table
          </button>
        </div>
      </div>
      <div className="fb-hp__body">
        {view === "chart" ? (
          <div role="img" aria-label={summary}>
            {children}
          </div>
        ) : (
          <div className="fb-tablewrap">
            <table className="fb-htable">
              <caption className="fb-sr-only">{summary}</caption>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={c} scope="col" style={{ textAlign: i === 0 ? "left" : "right" }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{r.text}</td>
                    {(r.extra ?? []).map((x, i) => (
                      <td key={i}>{x}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** Stage colours for the stacked bar. Each stage also gets its own stripe pattern, so the bar reads without colour. */
export const STAGE_COLOURS = ["var(--primary)", "var(--blue)", "var(--orange)", "var(--purple)", "var(--red)", "var(--text-3)"];
const STRIPES = [
  "",
  "repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 2px, transparent 2px 6px), ",
  "repeating-linear-gradient(-45deg, rgba(255,255,255,.55) 0 2px, transparent 2px 6px), ",
  "radial-gradient(rgba(255,255,255,.7) 1.5px, transparent 1.6px) 0 0 / 6px 6px, ",
  "repeating-linear-gradient(90deg, rgba(255,255,255,.55) 0 2px, transparent 2px 6px), ",
  "repeating-linear-gradient(0deg, rgba(255,255,255,.55) 0 2px, transparent 2px 6px), ",
];

export function stageStyle(i: number, widthPct?: number): CSSProperties {
  return { ...(widthPct === undefined ? {} : { width: `${widthPct}%` }), background: `${STRIPES[i % STRIPES.length]}${STAGE_COLOURS[i % STAGE_COLOURS.length]}` };
}

/** The "this section could not load" panel for one failed dashboard section: the rest of the page stays. */
export function SectionFailed({ title, message, onRetry }: { title: string; message?: string; onRetry: () => void }) {
  return (
    <section className="fb-hp fb-hp--failed" role="alert">
      <div className="fb-hp__body fb-hfail">
        <span className="fb-hfail__icon" aria-hidden="true">
          <HIcon name="alert" size={20} />
        </span>
        <div>
          <h2 className="fb-hp__title">{title} could not be loaded</h2>
          <p className="fb-hp__sub">{message ?? "The rest of the page is unaffected. Nothing you saved is lost."}</p>
        </div>
        <button type="button" className="fb-btn fb-btn--secondary fb-btn--sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    </section>
  );
}
