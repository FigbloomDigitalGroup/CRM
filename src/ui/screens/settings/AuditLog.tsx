"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, DateField, Drawer, EmptyState, Select } from "../..";
import { getCsvText } from "../../data/client";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, useReport, useWhen } from "./kit";

interface AuditItem {
  id: string;
  at: string;
  action: string;
  actor: { membershipId: string | null; name: string; email: string | null; roleKey: string | null };
  entity: { type: string; id: string | null; label: string | null; exists: boolean; archived: boolean; link: { path: string } | null };
  previousValue: unknown;
  newValue: unknown;
  metadata: unknown;
}
interface Filters {
  entityTypes: { value: string; count: number }[];
  actions: { value: string; count: number }[];
  actors: { membershipId: string; name: string; roleKey: string; events: number }[];
  systemEvents: number;
}

const PAGE = 25;
const words = (s: string) => s.replace(/[._]/g, " ").replace(/\b\w/, (c) => c.toUpperCase());

/** A short line for the table: what changed, from the event's own values (what a role may not see arrives blank from the API). */
function detailOf(i: AuditItem): string {
  const meta = i.metadata && typeof i.metadata === "object" ? (i.metadata as Record<string, unknown>) : null;
  if (meta) {
    const parts = Object.entries(meta).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`);
    if (parts.length) return parts.join(" · ");
  }
  const next = i.newValue && typeof i.newValue === "object" ? Object.keys(i.newValue as object).slice(0, 4).join(", ") : "";
  return next ? `Changed ${next}` : "";
}

/**
 * Organisation audit log (S2, FIG-1107): who changed what, across the whole organisation. Read-only. The API leaves out payment records for a reader
 * without payments access and blanks money the reader may not see, so what is shown here is already masked for this role; export is audited too.
 */
export function AuditLog() {
  const { orgSlug } = useMember();
  const report = useReport();
  const when = useWhen();
  const [f, setF] = useState({ actor: "", entityType: "", action: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const filters = useApiQuery("getAuditLogFilters", { params: { orgSlug } });
  const facets = filters.data as unknown as Filters | undefined;
  const query = { ...(f.actor ? { actorMembershipId: f.actor } : {}), ...(f.entityType ? { entityType: f.entityType } : {}), ...(f.action ? { action: f.action } : {}), ...(f.from ? { dateFrom: f.from } : {}), ...(f.to ? { dateTo: f.to } : {}) };
  const q = useApiQuery("listAuditLog", { params: { orgSlug }, query: { ...query, page: String(page), pageSize: String(PAGE) } }, { placeholderData: (prev) => prev });
  const data = q.data as unknown as { items: AuditItem[]; total: number; pageCount: number } | undefined;
  const items = asArray<AuditItem>(data?.items);
  const filtered = Object.keys(query).length > 0;
  const set = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setPage(1);
  };

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await getCsvText(`/api/orgs/${orgSlug}/audit/events/export`, query);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      report.ok("Audit log exported. The export is itself recorded.");
    } catch (e) {
      report.fail(e, "The export did not run");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Panel
      flush
      title="Organisation audit log"
      description="Who changed what, across the whole organisation. Read-only."
      actions={<Button loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button>}
    >
      <div className="fb-set-filters" role="search" aria-label="Filter the audit log">
        <Select label="Person" value={f.actor} onChange={(e) => set({ actor: e.target.value })} placeholder="Anyone" options={(facets?.actors ?? []).map((a) => ({ value: a.membershipId, label: a.name }))} />
        <Select label="Record type" value={f.entityType} onChange={(e) => set({ entityType: e.target.value })} placeholder="Any record" options={(facets?.entityTypes ?? []).map((t) => ({ value: t.value, label: words(t.value) }))} />
        <Select label="Action" value={f.action} onChange={(e) => set({ action: e.target.value })} placeholder="Any action" options={(facets?.actions ?? []).map((a) => ({ value: a.value, label: a.value }))} />
        <DateField label="From" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        <DateField label="To" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        {filtered ? <Button variant="ghost" onClick={() => { setF({ actor: "", entityType: "", action: "", from: "", to: "" }); setPage(1); }}>Clear filters</Button> : null}
      </div>
      <Gate q={q} area="The audit log">
        {items.length === 0 ? (
          <EmptyState title={filtered ? "No events match" : "No events yet"} body={filtered ? "Widen the dates or clear a filter." : "Changes made in the organisation will be listed here."} />
        ) : (
          <div className="fb-set-tablewrap">
            <table className="fb-set-table">
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Detail</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-2)" }}>{when(i.at)}</td>
                    <td>{i.actor.name}</td>
                    <td style={{ fontWeight: 600 }}><button type="button" className="fb-btn fb-btn--link" onClick={() => setOpen(i)} aria-label={`Open details of ${i.action}`}>{i.action}</button></td>
                    <td>{i.entity.link ? <Link href={i.entity.link.path}>{i.entity.label ?? words(i.entity.type)}</Link> : (i.entity.label ?? words(i.entity.type))}{i.entity.archived ? <span className="fb-set-muted"> (archived)</span> : null}{!i.entity.exists && i.entity.id ? <span className="fb-set-muted"> (removed)</span> : null}</td>
                    <td style={{ color: "var(--text-2)" }}>{detailOf(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="fb-set-pager">
          <span>{data ? `${data.total} ${data.total === 1 ? "event" : "events"}` : ""}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="sm" disabledReason={page <= 1 ? "This is the first page." : undefined} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {Math.max(1, data?.pageCount ?? 1)}</span>
            <Button size="sm" disabledReason={page >= (data?.pageCount ?? 1) ? "This is the last page." : undefined} onClick={() => setPage(page + 1)}>Next</Button>
          </span>
        </div>
      </Gate>
      <Drawer open={open !== null} onClose={() => setOpen(null)} title={open ? words(open.action) : "Event"}>
        {open ? (
          <dl style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "8px 12px", margin: 0 }}>
            <dt className="fb-set-muted">When</dt><dd style={{ margin: 0 }}>{when(open.at)}</dd>
            <dt className="fb-set-muted">Who</dt><dd style={{ margin: 0 }}>{open.actor.name}{open.actor.roleKey ? ` (${words(open.actor.roleKey.toLowerCase())})` : ""}</dd>
            <dt className="fb-set-muted">Record</dt><dd style={{ margin: 0 }}>{open.entity.label ?? words(open.entity.type)} · {words(open.entity.type)}</dd>
            {(["previousValue", "newValue", "metadata"] as const).map((k) => (open[k] ? (
              <div key={k} style={{ display: "contents" }}>
                <dt className="fb-set-muted">{k === "previousValue" ? "Before" : k === "newValue" ? "After" : "Details"}</dt>
                <dd style={{ margin: 0 }}><pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12.5 }}>{JSON.stringify(open[k], null, 2)}</pre></dd>
              </div>
            ) : null))}
          </dl>
        ) : null}
      </Drawer>
    </Panel>
  );
}
