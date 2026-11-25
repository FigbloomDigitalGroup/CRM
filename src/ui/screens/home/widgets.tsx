"use client";

import Link from "next/link";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useDemoStore } from "../commercial/demo/store";
import { kes } from "../finance/format";
import { socialSnapshot } from "./demo/data";
import { moneyShort } from "./format";
import { HIcon, KpiGrid, Panel, type KpiDef } from "./kit";
import { useWonDealPayments } from "./roles";

/**
 * The commercial and social widgets of the role dashboards (design CrmDashboard, CrmBilling). Each widget decides for itself whether the member
 * may see it and renders nothing when not (rule 7: a figure a role cannot see is omitted, never shown empty). Quotes read the demo store, invoices
 * the real invoices API, the Social snapshot demo data (see `./demo/`).
 */

const demoOn = () => process.env.NEXT_PUBLIC_DEMO_SCREENS === "true" || process.env.NODE_ENV === "test";

interface InvoiceTotals {
  byStatus?: Record<string, { count: number; amount: string; outstanding: string }>;
  ageing?: Record<string, { count: number; outstanding: string }>;
}

export interface InvoiceFigures {
  loading: boolean;
  invoiced: number;
  collected: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  ageing: InvoiceTotals["ageing"];
}

/** The invoice book as a few numbers; null when the member may not see invoice figures (invoices.view plus finance.view.payments). */
export function useInvoiceFigures(): InvoiceFigures | null {
  const { orgSlug, can } = useMember();
  const allowed = can("invoices.view") && can("finance.view.payments");
  const q = useApiQuery("listInvoices", { params: { orgSlug }, query: { pageSize: "1" } as never }, { enabled: allowed });
  if (!allowed) return null;
  const t = (q.data?.totals ?? {}) as InvoiceTotals;
  const live = Object.entries(t.byStatus ?? {}).filter(([k]) => k !== "DRAFT" && k !== "VOID");
  const invoiced = live.reduce((n, [, v]) => n + Number(v.amount ?? 0), 0);
  const outstanding = live.reduce((n, [, v]) => n + Number(v.outstanding ?? 0), 0);
  const od = t.byStatus?.OVERDUE;
  return { loading: q.isPending, invoiced, collected: Math.max(0, invoiced - outstanding), outstanding, overdue: Number(od?.outstanding ?? 0), overdueCount: od?.count ?? 0, ageing: t.ageing };
}

export function invoiceKpis(orgSlug: string, f: InvoiceFigures): KpiDef[] {
  const v = (n: number) => (f.loading ? "…" : moneyShort(n));
  const href = `/o/${orgSlug}/invoices`;
  return [
    { key: "inv-invoiced", label: "Invoiced", value: v(f.invoiced), sub: "sent, part paid, paid and overdue", icon: "file", tone: "blue", href },
    { key: "inv-collected", label: "Collected", value: v(f.collected), sub: "received against invoices", icon: "banknote", tone: "green", href },
    { key: "inv-overdue", label: "Overdue", value: v(f.overdue), sub: f.overdueCount ? `${f.overdueCount} invoice${f.overdueCount === 1 ? "" : "s"}` : "all clear", icon: "alert", tone: "red", href, alertWhenPositive: true, numeric: f.overdue },
  ];
}

/** Quote counts from the demo store, by the stages the design's dashboards use. */
export function useQuoteCounts() {
  const { quotes } = useDemoStore();
  const n = (...s: string[]) => quotes.filter((q) => s.includes(q.status)).length;
  return { draft: n("Draft"), awaiting: n("Pending approval"), sent: n("Sent", "Approved"), accepted: n("Signed") };
}

function Row({ label, value, href, tone }: { label: string; value: number | string; href: string; tone?: "red" }) {
  return (
    <Link href={href} className="fb-hrow fb-hrow--link">
      <div className="fb-hrow__main">
        <div className="fb-hrow__title">{label}</div>
      </div>
      <strong data-alert={tone === "red" && Number(value) > 0 ? "true" : undefined}>{value}</strong>
    </Link>
  );
}

export function QuotesPanel({ variant }: { variant: "management" | "sales" }) {
  const { orgSlug, can } = useMember();
  const c = useQuoteCounts();
  if (!can("quotes.view")) return null;
  const base = `/o/${orgSlug}/quotes`;
  const rows =
    variant === "management"
      ? [
          { label: "Awaiting approval", value: c.awaiting },
          { label: "Sent", value: c.sent },
          { label: "Accepted", value: c.accepted },
        ]
      : [
          { label: "Draft", value: c.draft },
          { label: "Sent", value: c.sent },
          { label: "Accepted", value: c.accepted },
        ];
  return (
    <Panel title={variant === "sales" ? "My quotes" : "Quotes"} sub={variant === "sales" ? "Draft, sent and accepted" : "Where the quotes stand"} action={{ label: "All quotes", href: base }}>
      {rows.map((r) => (
        <Row key={r.label} label={r.label} value={r.value} href={base} />
      ))}
      {can("quotes.create") ? (
        <div className="fb-hrow fb-hrow--quiet">
          <Link href={base} className="fb-qbtn fb-qbtn--primary">
            <HIcon name="plus" size={14} />
            New quote
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

/** Sales: won deals without an invoice yet. Names only, no amounts, so nothing here needs the payments permission. */
export function InvoiceDraftsPanel() {
  const { orgSlug, can } = useMember();
  const pay = useWonDealPayments();
  if (!can("invoices.view") && !can("invoices.create")) return null;
  const todo = pay.rows.filter((r) => r.state === "NOT_INVOICED");
  return (
    <Panel title="Invoice drafts to prepare" sub="Won deals without an invoice" aside={pay.loading ? "" : `${todo.length}`} action={{ label: "All invoices", href: `/o/${orgSlug}/invoices` }}>
      {pay.loading ? <div className="fb-hrow fb-hrow--quiet">Loading…</div> : null}
      {!pay.loading && todo.length === 0 ? <div className="fb-hrow fb-hrow--empty">Every won deal has an invoice.</div> : null}
      {todo.slice(0, 5).map((r) => (
        <Link key={r.dealId} href={`/o/${orgSlug}/invoices?new=1`} className="fb-hrow fb-hrow--link">
          <div className="fb-hrow__main">
            <div className="fb-hrow__title">{r.companyName}</div>
            {r.serviceName ? <div className="fb-hrow__sub">{r.serviceName}</div> : null}
          </div>
        </Link>
      ))}
      {can("invoices.create") ? (
        <div className="fb-hrow fb-hrow--quiet">
          <Link href={`/o/${orgSlug}/invoices?new=1`} className="fb-qbtn fb-qbtn--primary">
            <HIcon name="plus" size={14} />
            New invoice
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}

/** Management and Finance: invoiced, collected and overdue as tiles. */
export function InvoiceTiles() {
  const { orgSlug } = useMember();
  const f = useInvoiceFigures();
  if (!f) return null;
  return <KpiGrid items={invoiceKpis(orgSlug, f)} />;
}

/** Finance: outstanding and the ageing buckets. */
export function AgeingPanel() {
  const { orgSlug } = useMember();
  const f = useInvoiceFigures();
  if (!f) return null;
  const rows: [string, string][] = [
    ["current", "Current"],
    ["d1_30", "1–30 days"],
    ["d31_60", "31–60 days"],
    ["d61_90", "61–90 days"],
    ["d90_plus", "90+ days"],
  ];
  return (
    <Panel title="Ageing" sub={f.loading ? "" : `${kes(f.outstanding)} outstanding`} action={{ label: "Invoices", href: `/o/${orgSlug}/invoices` }}>
      {rows.map(([k, label]) => (
        <Row key={k} label={label} value={f.loading ? "…" : moneyShort(f.ageing?.[k]?.outstanding ?? 0)} href={`/o/${orgSlug}/invoices`} />
      ))}
    </Panel>
  );
}

/** Management: the Social snapshot (demo data), for members who hold social.view. */
export function SocialSnapshotTile() {
  const { orgSlug, can } = useMember();
  if (!can("social.view") || !demoOn()) return null;
  const s = socialSnapshot;
  const href = `/o/${orgSlug}/social`;
  return (
    <Panel title="Social" sub={`${s.channels} channels connected`} action={{ label: "Open Social", href }}>
      <Row label={`Followers (+${s.followersDelta.toLocaleString("en-US")} this month)`} value={s.followers.toLocaleString("en-US")} href={href} />
      <Row label="Mentions needing a reply" value={s.mentionsToReply} href={href} tone="red" />
    </Panel>
  );
}
