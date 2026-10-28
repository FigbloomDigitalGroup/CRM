"use client";

import { useMemo, useState } from "react";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { downloadText } from "../leads/data";
import { ReportCard } from "./ReportCard";
import { formatCell, tableToCsv, type ReportColumn } from "./model";

/**
 * The customer reports (FIG-793, absorbed into F3.07): active, repeat and dormant customers, upcoming renewals and sales by salesperson. Each is a
 * table of exactly what the API returns for the role, with a CSV of exactly that table. Values the role may not see read "Hidden".
 */

const dateOnly = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

function Failed({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <section className="fb-rep__card" role="alert">
      <h2 className="fb-rep__cardtitle">{title}</h2>
      <p className="fb-rep__cardempty">{describeError(error).body}</p>
      <Button size="sm" onClick={onRetry}>Try again</Button>
    </section>
  );
}

function SkeletonCard({ title }: { title: string }) {
  return (
    <section className="fb-rep__card" aria-busy="true">
      <h2 className="fb-rep__cardtitle">{title}</h2>
      <div className="fb-rep__skel" style={{ height: 120, marginTop: 14 }} role="status">
        <span className="fb-sr-only">Loading {title}</span>
      </div>
    </section>
  );
}

const SEGMENTS = [
  { id: "", label: "All customers" },
  { id: "active", label: "Active" },
  { id: "repeat", label: "Repeat (2+ won)" },
  { id: "dormant", label: "Dormant" },
] as const;

interface CustomerItem {
  companyId: string;
  companyName: string;
  segment: "active" | "dormant";
  repeat: boolean;
  wonCount: number;
  wonValue: string | null;
  lastWonAt: string | null;
  activeServices: number;
}

export function CustomersDetail() {
  const { orgSlug } = useMember();
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]["id"]>("");
  const [page, setPage] = useState(1);
  const q = useApiQuery("getReportsCustomers", { params: { orgSlug }, query: { page: String(page), pageSize: "25", ...(segment ? { segment } : {}) } }, { placeholderData: (prev) => prev });
  if (q.isPending) return <SkeletonCard title="Active, repeat and dormant customers" />;
  if (q.isError) return <Failed title="Active, repeat and dormant customers" error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const masked = d.valueMasked;
  const items = d.items as unknown as CustomerItem[];
  const columns: ReportColumn[] = [
    { key: "name", label: "Customer", type: "text" },
    { key: "segment", label: "Status", type: "text" },
    { key: "won", label: "Won deals", type: "number" },
    { key: "value", label: "Won value", type: "money" },
    { key: "last", label: "Last won", type: "text" },
    { key: "services", label: "Running services", type: "number" },
  ];
  const cells = items.map((c) => [c.companyName, `${c.segment === "active" ? "Active" : "Dormant"}${c.repeat ? " · Repeat" : ""}`, formatCell("number", c.wonCount), formatCell("money", c.wonValue, masked), dateOnly(c.lastWonAt), formatCell("number", c.activeServices)]);
  const s = d.summary;
  return (
    <ReportCard
      id="customers-detail"
      title="Active, repeat and dormant customers"
      sub={`${s.customers} customers · ${s.active} active · ${s.repeat} repeat · ${s.dormant} dormant. Dormant means no running service and no win in ${d.dormancyDays} days.`}
      columns={columns}
      cells={cells}
      rowLinks={items.map((c) => `/o/${orgSlug}/companies/${c.companyId}`)}
      csv={{ onClick: () => downloadText(`customers-${segment || "all"}-page-${d.page}.csv`, tableToCsv(columns, cells)) }}
      emptyText="No customers in this segment yet."
      controls={
        <div className="fb-rep__ctl">
          <label className="fb-rep__sel">
            <span className="fb-sr-only">Customer segment</span>
            <select value={segment} onChange={(e) => { setSegment(e.target.value as typeof segment); setPage(1); }}>
              {SEGMENTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
      }
      footer={
        d.pageCount > 1 ? (
          <nav className="fb-rep__pager" aria-label="Customer pages">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span>Page {d.page} of {d.pageCount}</span>
            <Button size="sm" disabled={page >= d.pageCount} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </nav>
        ) : null
      }
    />
  );
}

interface RenewalItem {
  companyId: string;
  companyName: string;
  serviceName: string;
  endDate: string;
  daysLeft: number;
  lapsed: boolean;
}

export function RenewalsDetail() {
  const { orgSlug } = useMember();
  const [within, setWithin] = useState("90");
  const q = useApiQuery("getReportsRenewals", { params: { orgSlug }, query: { withinDays: within, pageSize: "100" } }, { placeholderData: (prev) => prev });
  if (q.isPending) return <SkeletonCard title="Upcoming renewals and lapsed services" />;
  if (q.isError) return <Failed title="Upcoming renewals and lapsed services" error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.items as unknown as RenewalItem[];
  const columns: ReportColumn[] = [
    { key: "name", label: "Customer", type: "text" },
    { key: "service", label: "Service", type: "text" },
    { key: "ends", label: "Ends", type: "text" },
    { key: "when", label: "When", type: "text" },
  ];
  const cells = items.map((r) => [r.companyName, r.serviceName, dateOnly(r.endDate), r.lapsed ? `Lapsed ${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"} ago` : r.daysLeft === 0 ? "Today" : `In ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`]);
  return (
    <ReportCard
      id="renewals-detail"
      title="Upcoming renewals and lapsed services"
      sub={`${q.data.summary.renewing} renewing in the next ${q.data.withinDays} days · ${q.data.summary.lapsed} lapsed`}
      columns={columns}
      cells={cells}
      rowLinks={items.map((r) => `/o/${orgSlug}/companies/${r.companyId}`)}
      csv={{ onClick: () => downloadText(`renewals-next-${within}-days.csv`, tableToCsv(columns, cells)) }}
      emptyText="No services are due to renew in this window."
      controls={
        <div className="fb-rep__ctl">
          <label className="fb-rep__sel">
            <span className="fb-sr-only">Renewal window</span>
            <select value={within} onChange={(e) => setWithin(e.target.value)}>
              {["30", "60", "90", "180"].map((d) => <option key={d} value={d}>Next {d} days</option>)}
            </select>
          </label>
        </div>
      }
    />
  );
}

interface SalesRow {
  ownerMembershipId: string;
  ownerName: string | null;
  month: string | null;
  wonCount: number;
  wonValue: string | null;
}

export function SalespersonDetail({ dateFrom, dateTo, rangeLabel }: { dateFrom: string; dateTo: string; rangeLabel: string }) {
  const { orgSlug } = useMember();
  const [period, setPeriod] = useState<"total" | "month">("total");
  const q = useApiQuery("getReportsSalesBySalesperson", { params: { orgSlug }, query: { dateFrom, dateTo, period } }, { placeholderData: (prev) => prev });
  const columns: ReportColumn[] = useMemo(
    () => [
      { key: "person", label: "Salesperson", type: "text" },
      ...(period === "month" ? [{ key: "month", label: "Month", type: "text" } as ReportColumn] : []),
      { key: "won", label: "Won deals", type: "number" },
      { key: "value", label: "Won value", type: "money" },
    ],
    [period],
  );
  if (q.isPending) return <SkeletonCard title="Sales by salesperson" />;
  if (q.isError) return <Failed title="Sales by salesperson" error={q.error} onRetry={() => void q.refetch()} />;
  const masked = q.data.valueMasked;
  const rows = q.data.rows as unknown as SalesRow[];
  const cells = rows.map((r) => [r.ownerName ?? "Former member", ...(period === "month" ? [r.month ?? "—"] : []), formatCell("number", r.wonCount), formatCell("money", r.wonValue, masked)]);
  return (
    <ReportCard
      id="sales-by-salesperson"
      title="Sales by salesperson"
      sub={`Won deals and their value, ${rangeLabel}${masked ? ". Values are hidden for your role." : ""}`}
      columns={columns}
      cells={cells}
      csv={{ onClick: () => downloadText(`sales-by-salesperson-${period}.csv`, tableToCsv(columns, cells)) }}
      emptyText="No deals were won in this range."
      controls={
        <div className="fb-rep__ctl">
          <label className="fb-rep__sel">
            <span className="fb-sr-only">Split</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as "total" | "month")}>
              <option value="total">Total for the range</option>
              <option value="month">By month</option>
            </select>
          </label>
        </div>
      }
    />
  );
}
