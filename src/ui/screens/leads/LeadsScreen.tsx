"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "@/api-client";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { Popover } from "../../components/overlays";
import { useApi, useApiQuery, useUndoable } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { contactName, contactOf, downloadText, leadName, ownerLabel, useDebounced, useFormatters, useLeadCaps, useReference, useRefreshLeads, type LeadRow } from "./data";
import { ConvertDialog } from "./ConvertDialog";
import { ExportDialog } from "./ExportDialog";
import { ImportWizard } from "./ImportWizard";
import { LeadDrawer } from "./LeadDrawer";
import { DUE_COLOUR, personInitials, statusTone, tempTone, TEMPERATURE_LABEL, TEMPERATURES } from "./format";
import { Icon } from "./icons";
import { SavedViewsBar } from "../views/SavedViewsBar";

type TabId = "all" | "hot" | "pool" | "unassigned" | "converted" | "archived";
interface Filters {
  q: string;
  status: string;
  temp: string;
  source: string;
  owner: string;
}
const NO_FILTERS: Filters = { q: "", status: "", temp: "", source: "", owner: "" };

type ColumnId = "status" | "temperature" | "source" | "service" | "next" | "owner";
const COLUMNS: { id: ColumnId; label: string; header: string; sort?: string }[] = [
  { id: "status", label: "Status", header: "STATUS" },
  { id: "temperature", label: "Temperature", header: "TEMPERATURE", sort: "temperature" },
  { id: "source", label: "Source", header: "SOURCE" },
  { id: "service", label: "Service", header: "SERVICE" },
  { id: "next", label: "Next follow-up", header: "NEXT FOLLOW-UP", sort: "nextFollowUpAt" },
  { id: "owner", label: "Owner", header: "OWNER" },
];

interface Saved {
  id: string;
  name: string;
  tab: TabId;
  filters: Filters;
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or blocked storage: the choice just is not remembered */
  }
}

/**
 * The Leads list (L1, FIG-1083): tabs, filters, sort, column choice, bulk actions, the archived tab and the shared pool, for every role.
 * The list is paged on the server (25, 50 or 100 rows), so a 50,000-lead organisation loads one page at a time and filters and search
 * cover every lead, not just the page on screen.
 */
export function LeadsScreen() {
  const member = useMember();
  const { orgSlug, can } = member;
  const router = useRouter();
  const pathname = usePathname();
  const api = useApi();
  const toast = useToast();
  const undoable = useUndoable();
  const ref = useReference();
  const fmt = useFormatters();
  const caps = useLeadCaps();
  const refresh = useRefreshLeads();

  const seesAll = can("leads.view.all");
  const poolTab: TabId | null = seesAll ? "unassigned" : can("leads.view.shared") ? "pool" : null;
  // Links from search and the old pages arrive as ?q=name and ?view=hot|converted|archived|unassigned.
  const params = useSearchParams();
  const wantedView = params?.get("view");
  const [tab, setTab] = useState<TabId>(() => {
    if (wantedView === "hot" || wantedView === "converted" || wantedView === "archived") return wantedView;
    if (wantedView === "unassigned" || wantedView === "pool") return poolTab ?? "all";
    return "all";
  });
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, q: params?.get("q") ?? "" }));
  const [sort, setSort] = useState<string>("-createdAt");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<{ id?: string } | null>(null);
  // A link from the home ("New lead") arrives as ?new=1: open the drawer once and clear the parameter.
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (wantsNew) {
      setDrawer({});
      router.replace(pathname);
    }
  }, [wantsNew, router, pathname]);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<{ ids?: string[] } | null>(null);
  const [hiddenCols, setHiddenCols] = useState<ColumnId[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [savingName, setSavingName] = useState<string | null>(null);

  useEffect(() => {
    setHiddenCols(readStore<ColumnId[]>("figbloom-leads-columns", []));
    setSaved(readStore<Saved[]>(`figbloom-leads-saved:${orgSlug}`, []));
  }, [orgSlug]);

  const q = useDebounced(filters.q.trim(), 300);
  const inPool = tab === "pool" || tab === "unassigned";
  const converted = ref.statusByKey("CONVERTED");

  const listQuery = useMemo(() => {
    const base: Record<string, string | number> = { page, pageSize: perPage };
    if (q) base.q = q;
    if (!inPool) {
      base.sort = sort;
      if (filters.status) base.leadStatusId = filters.status;
      if (filters.temp) base.temperature = filters.temp;
      if (filters.source) base.leadSourceId = filters.source;
      if (filters.owner) base.ownerMembershipId = filters.owner;
      if (tab === "hot") base.temperature = "HOT";
      if (tab === "converted" && converted) base.leadStatusId = converted.id;
      if (tab === "archived") base.archivedOnly = "true";
    }
    return base;
  }, [tab, inPool, q, filters, sort, page, perPage, converted]);

  const listQ = useApiQuery("listLeads", { params: { orgSlug }, query: listQuery as never }, { enabled: !inPool && (tab !== "converted" || Boolean(converted)), placeholderData: (prev) => prev });
  const poolQ = useApiQuery("getLeadsPool", { params: { orgSlug }, query: { q: q || undefined, page: String(page), pageSize: String(perPage) } }, { enabled: inPool, placeholderData: (prev) => prev });
  const active = inPool ? poolQ : listQ;
  const rows = ((active.data?.items ?? []) as (LeadRow & { myPendingRequestId?: string | null })[]) ?? [];
  const total = active.data?.total ?? 0;

  // Counts for the tabs and the header: a one-row page each, so the cost is a COUNT, never a fetch of the rows.
  const one = { page: 1, pageSize: 1 };
  const allCount = useApiQuery("listLeads", { params: { orgSlug }, query: one }, { staleTime: 30_000 });
  const hotCount = useApiQuery("listLeads", { params: { orgSlug }, query: { ...one, temperature: "HOT" } }, { staleTime: 30_000 });
  const convCount = useApiQuery("listLeads", { params: { orgSlug }, query: { ...one, leadStatusId: converted?.id } }, { enabled: Boolean(converted), staleTime: 30_000 });
  const archCount = useApiQuery("listLeads", { params: { orgSlug }, query: { ...one, archivedOnly: "true" } }, { staleTime: 30_000 });
  const poolCount = useApiQuery("getLeadsPool", { params: { orgSlug }, query: { page: "1", pageSize: "1" } }, { enabled: poolTab !== null, staleTime: 30_000 });

  const tabs: { id: TabId; label: string; n: number | undefined; prov?: boolean }[] = [
    { id: "all", label: "All", n: allCount.data?.total },
    { id: "hot", label: "Hot", n: hotCount.data?.total },
    ...(poolTab ? [{ id: poolTab, label: poolTab === "unassigned" ? "Unassigned" : "Shared pool", n: poolCount.data?.total, prov: poolTab === "pool" }] : []),
    { id: "converted", label: "Converted", n: converted ? convCount.data?.total : undefined },
    { id: "archived", label: "Archived", n: archCount.data?.total },
  ];

  const filtered = Object.values(filters).some(Boolean);
  function changeFilter(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    setSelected(new Set());
  }
  function changeTab(next: TabId) {
    setTab(next);
    setPage(1);
    setSelected(new Set());
  }
  function clearFilters() {
    setFilters(NO_FILTERS);
    setPage(1);
    setSelected(new Set());
  }

  const error = active.error;
  const forbidden = error instanceof ApiRequestError && error.status === 403;
  const loading = active.isLoading || (active.isFetching && active.isPlaceholderData && rows.length === 0);
  const empty = !loading && !error && total === 0 && !filtered && q === "";
  const noResults = !loading && !error && total === 0 && !empty;

  const pageStart = total ? (page - 1) * perPage + 1 : 0;
  const pageEnd = Math.min(total, page * perPage);
  const lastPage = page * perPage >= total;
  const bigList = total > 1000;

  const shownCols = COLUMNS.filter((c) => !hiddenCols.includes(c.id));
  const colSpan = 3 + shownCols.length;

  // ----- actions
  const reassign = useCallback(
    async (lead: LeadRow, ownerId: string) => {
      try {
        await api.call("postLeadsByLeadIdAssign", { params: { orgSlug, leadId: lead.id }, body: { ownerMembershipId: ownerId }, idempotencyKey: newIdempotencyKey() });
        toast.show({ message: `${leadName(lead)} reassigned to ${ref.memberName(ownerId) ?? "the new owner"}` });
        await refresh();
      } catch (err) {
        toast.show({ tone: "danger", message: describeError(err).body });
      }
    },
    [api, orgSlug, toast, ref, refresh],
  );

  async function archive(lead: LeadRow) {
    try {
      await undoable({
        run: () => api.call("postLeadsByLeadIdArchive", { params: { orgSlug, leadId: lead.id }, body: {}, idempotencyKey: newIdempotencyKey() }).then(refresh),
        undo: () => api.call("postLeadsByLeadIdRestore", { params: { orgSlug, leadId: lead.id }, idempotencyKey: newIdempotencyKey() }).then(refresh),
        message: `${leadName(lead)} archived`,
      });
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function restore(lead: LeadRow) {
    try {
      await api.call("postLeadsByLeadIdRestore", { params: { orgSlug, leadId: lead.id }, idempotencyKey: newIdempotencyKey() });
      toast.show({ message: `${leadName(lead)} restored` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }
  async function askToTake(lead: LeadRow) {
    try {
      const r = (await api.call("postLeadsByLeadIdAskToTake", { params: { orgSlug, leadId: lead.id }, body: {}, idempotencyKey: newIdempotencyKey() })) as { taken?: boolean };
      toast.show({ message: r?.taken ? `${leadName(lead)} is now yours` : `Asked Management to assign ${leadName(lead)} to you` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }

  const selectedRows = rows.filter((r) => selected.has(r.id));
  async function bulk(label: string, each: (lead: LeadRow) => Promise<unknown>, rowsToUse: LeadRow[] = selectedRows) {
    const results = await Promise.allSettled(rowsToUse.map(each));
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = rowsToUse.length - failed;
    toast.show({ tone: failed ? "danger" : "success", message: failed ? `${ok} of ${rowsToUse.length} leads ${label}. ${failed} could not be changed.` : `${ok} lead${ok === 1 ? "" : "s"} ${label}` });
    setSelected(new Set());
    await refresh();
    return ok;
  }
  async function bulkArchive() {
    const targets = selectedRows.filter((r) => caps(r).canArchive);
    const ok = await bulk("archived", (l) => api.call("postLeadsByLeadIdArchive", { params: { orgSlug, leadId: l.id }, body: {}, idempotencyKey: newIdempotencyKey() }), targets);
    void ok;
  }
  const archivable = selectedRows.filter((r) => caps(r).canArchive).length;
  const archiveBlocked = !can("leads.archive.all") && !can("leads.archive.own") ? "Your role cannot archive leads." : archivable === 0 && selectedRows.length > 0 ? "None of the selected leads can be archived by you." : undefined;

  const tagsQ = useApiQuery("getTags", { params: { orgSlug }, query: {} }, { enabled: can("tags.manage") || can("leads.edit.all") || can("leads.edit.own"), staleTime: 60_000 });
  async function bulkTag(tagId: string) {
    const tag = tagsQ.data?.items.find((t) => t.id === tagId);
    if (!tag) return;
    const targets = selectedRows.filter((r) => caps(r).canEdit);
    await bulk(`tagged “${tag.name}”`, (l) => api.call("patchLeadsByLeadIdTags", { params: { orgSlug, leadId: l.id }, body: { addTagIds: [tagId] } }), targets);
  }
  async function bulkAssign(ownerId: string) {
    await bulk(`reassigned to ${ref.memberName(ownerId) ?? "the new owner"}`, (l) => api.call("postLeadsByLeadIdAssign", { params: { orgSlug, leadId: l.id }, body: { ownerMembershipId: ownerId }, idempotencyKey: newIdempotencyKey() }), selectedRows.filter((r) => caps(r).canReassign));
  }

  // ----- saved filters and columns (kept on this device)
  function saveFilter() {
    const name = (savingName ?? "").trim();
    if (!name) return;
    const next = [...saved, { id: String(Date.now()), name, tab, filters }];
    setSaved(next);
    writeStore(`figbloom-leads-saved:${orgSlug}`, next);
    setSavingName(null);
    toast.show({ message: `Saved the filter “${name}”` });
  }
  function removeSaved(id: string) {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    writeStore(`figbloom-leads-saved:${orgSlug}`, next);
  }
  function applySaved(s: Saved) {
    setTab(s.tab);
    setFilters(s.filters);
    setPage(1);
    setSelected(new Set());
  }
  function toggleColumn(id: ColumnId) {
    const next = hiddenCols.includes(id) ? hiddenCols.filter((c) => c !== id) : [...hiddenCols, id];
    setHiddenCols(next);
    writeStore("figbloom-leads-columns", next);
  }
  function toggleSort(field: string) {
    setSort((s) => (s === field ? `-${field}` : s === `-${field}` ? "-createdAt" : field));
    setPage(1);
  }

  function exportSelected() {
    const header = ["Company or person", "Contact", "Status", "Temperature", "Source", "Service", "Next follow-up", "Owner"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = selectedRows.map((r) =>
      [
        leadName(r),
        contactName(contactOf(r)),
        r.leadStatus.name,
        TEMPERATURE_LABEL[r.temperature],
        r.leadSource?.name ?? "",
        ref.service(r.serviceInterestId)?.name ?? "",
        r.nextFollowUpAt ? fmt.dueLabel(r.nextFollowUpAt) : "",
        ref.memberName(r.ownerMembershipId) ?? "Unassigned",
      ]
        .map((v) => esc(String(v)))
        .join(","),
    );
    downloadText("leads-selected.csv", [header.map(esc).join(","), ...lines].join("\n"));
    toast.show({ message: `${selectedRows.length} lead${selectedRows.length === 1 ? "" : "s"} exported to leads-selected.csv` });
  }

  if (forbidden) return <NoAccess area="Leads" denial={describeError(error).denial} />;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const scopeLabel = seesAll ? "All organisation leads" : "My leads";
  const ownerOptions = ref.owners;
  const hint = seesAll
    ? "You can edit, reassign, convert, import, export and archive any lead."
    : tab === "pool"
      ? "Unassigned leads the team can pick up. Management decides who takes them."
      : "You can edit, convert and archive leads you own. Reassigning is Management only.";
  const noAssignReason = "Only Management can reassign leads";

  return (
    <div className="fb-ld" data-screen-label="Leads list">
      <div className="fb-ld-head">
        <div>
          <h1 className="fb-ld-title">Leads</h1>
          <div className="fb-ld-meta">
            <span className={`fb-ld-scope ${seesAll ? "fb-ld-scope--org" : "fb-ld-scope--own"}`}>
              <span className="fb-ld-scope__dot" />
              {scopeLabel} · {allCount.data?.total ?? "…"}
            </span>
            <span className="fb-ld-hint">{hint}</span>
          </div>
        </div>
        <div className="fb-ld-actions">
          {can("leads.import") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setImporting(true)}>
              <Icon name="upload" size={16} />
              Import CSV
            </button>
          ) : null}
          {can("leads.export") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setExporting({})}>
              <Icon name="download" size={16} />
              Export CSV
            </button>
          ) : null}
          {can("leads.create") ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer({})}>
              <Icon name="plus" size={16} stroke={2.2} />
              New lead
            </button>
          ) : null}
        </div>
      </div>

      <div className="fb-ld-tabs-row">
        <div role="tablist" aria-label="Lead views" className="fb-ld-tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="fb-ld-tab" onClick={() => changeTab(t.id)}>
              {t.label}
              <span className="fb-ld-tab__n">{t.n ?? ""}</span>
              {t.prov ? <span className="fb-ld-prov">PROVISIONAL</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="fb-ld-filters" role="search" aria-label="Filter leads">
        <div className="fb-ld-search">
          <span className="fb-ld-search__icon">
            <Icon name="search" size={16} />
          </span>
          <input className="fb-ld-input" type="search" aria-label="Search leads" value={filters.q} onChange={(e) => changeFilter({ q: e.target.value })} placeholder="Search name, service, notes" />
        </div>
        <select className="fb-ld-select" aria-label="Status" value={tab === "converted" ? (converted?.id ?? "") : filters.status} disabled={inPool || tab === "converted"} title={inPool ? "The shared pool can only be searched by name" : undefined} onChange={(e) => changeFilter({ status: e.target.value })}>
          <option value="">Any status</option>
          {ref.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="fb-ld-select" aria-label="Temperature" value={tab === "hot" ? "HOT" : filters.temp} disabled={inPool || tab === "hot"} onChange={(e) => changeFilter({ temp: e.target.value })}>
          <option value="">Any temperature</option>
          {TEMPERATURES.map((t) => (
            <option key={t} value={t}>
              {TEMPERATURE_LABEL[t]}
            </option>
          ))}
        </select>
        <select className="fb-ld-select" aria-label="Source" value={filters.source} disabled={inPool} onChange={(e) => changeFilter({ source: e.target.value })}>
          <option value="">Any source</option>
          {ref.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {seesAll ? (
          <select className="fb-ld-select" aria-label="Owner" value={filters.owner} disabled={inPool} onChange={(e) => changeFilter({ owner: e.target.value })}>
            <option value="">Any owner</option>
            {ownerOptions.map((o) => (
              <option key={o.membershipId} value={o.membershipId}>
                {ownerLabel(o)}
              </option>
            ))}
          </select>
        ) : null}
        {filtered ? (
          <button type="button" className="fb-ld-clear" onClick={clearFilters}>
            Clear
          </button>
        ) : null}
        {filtered && savingName === null ? (
          <button type="button" className="fb-ld-clear" onClick={() => setSavingName("")}>
            Save filter
          </button>
        ) : null}
        {savingName !== null ? (
          <form
            style={{ display: "flex", gap: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              saveFilter();
            }}
          >
            <input className="fb-ld-input" style={{ width: 160 }} aria-label="Name for this filter" placeholder="Name this filter" value={savingName} onChange={(e) => setSavingName(e.target.value)} autoFocus />
            <button type="submit" className="fb-ld-btn" disabled={!savingName.trim()}>
              Save
            </button>
          </form>
        ) : null}
        <Popover label="Choose columns" trigger="Columns" align="end" triggerClassName="fb-ld-btn">
          <fieldset style={{ border: 0, margin: 0, padding: 12, minWidth: 180 }}>
            <legend className="fb-sr-only">Visible columns</legend>
            {COLUMNS.map((c) => (
              <label key={c.id} className="fb-ld-checkrow" style={{ padding: "4px 0" }}>
                <input type="checkbox" checked={!hiddenCols.includes(c.id)} onChange={() => toggleColumn(c.id)} />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>
        </Popover>
      </div>

      <SavedViewsBar
        page="leads"
        current={{ tab, filters: { ...filters } }}
        onApply={(v) => {
          setTab(v.tab as TabId);
          setFilters({ ...NO_FILTERS, ...v.filters });
          setPage(1);
          setSelected(new Set());
        }}
      />

      {saved.length ? (
        <div className="fb-ld-pills" role="group" aria-label="Saved filters">
          {saved.map((s) => (
            <span key={s.id} style={{ display: "inline-flex" }}>
              <button type="button" className="fb-ld-pill" onClick={() => applySaved(s)}>
                {s.name}
              </button>
              <button type="button" className="fb-ld-iconbtn" aria-label={`Remove saved filter ${s.name}`} onClick={() => removeSaved(s.id)}>
                <Icon name="x" size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="fb-ld-bulk" role="region" aria-label="Bulk actions">
          <strong aria-live="polite">{selected.size} selected</strong>
          <span className="fb-ld-bulk__spacer" />
          {can("leads.assign") ? (
            <select aria-label="Reassign selected to" value="" onChange={(e) => e.target.value && bulkAssign(e.target.value)}>
              <option value="">Reassign to…</option>
              {ownerOptions.map((o) => (
                <option key={o.membershipId} value={o.membershipId}>
                  {ownerLabel(o)}
                </option>
              ))}
            </select>
          ) : null}
          {tagsQ.data?.items.length && selectedRows.some((r) => caps(r).canEdit) ? (
            <select aria-label="Tag selected as" value="" onChange={(e) => e.target.value && bulkTag(e.target.value)}>
              <option value="">Tag as…</option>
              {tagsQ.data.items.filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="fb-ld-bulk__btn" disabled={Boolean(archiveBlocked)} title={archiveBlocked} onClick={bulkArchive}>
            <Icon name="archive" size={15} />
            Archive
          </button>
          {can("leads.export") ? (
            <button type="button" className="fb-ld-bulk__btn" onClick={exportSelected}>
              Export selected
            </button>
          ) : null}
          <button type="button" className="fb-ld-bulk__x" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <Icon name="x" size={15} />
          </button>
          {archiveBlocked ? <span className="fb-ld-bulk__reason">{archiveBlocked}</span> : null}
        </div>
      ) : null}

      <section className="fb-ld-card" aria-label="Leads">
        <div className="fb-ld-scroll">
          <table className="fb-ld-table" aria-busy={loading || undefined}>
            <caption className="fb-sr-only">Leads</caption>
            <thead>
              <tr>
                <th className="fb-ld-th--check">
                  <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} disabled={rows.length === 0} />
                </th>
                <th scope="col">COMPANY / CONTACT</th>
                {shownCols.map((c) => {
                  const sorted = sort === c.sort ? "ascending" : sort === `-${c.sort}` ? "descending" : "none";
                  return (
                    <th key={c.id} scope="col" aria-sort={c.sort && !inPool ? (sorted as "ascending" | "descending" | "none") : undefined}>
                      {c.sort && !inPool ? (
                        <button type="button" className="fb-ld-sort" data-active={sorted !== "none"} onClick={() => toggleSort(c.sort!)}>
                          {c.header}
                          <span aria-hidden="true">{sorted === "ascending" ? "▲" : sorted === "descending" ? "▼" : ""}</span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
                <th scope="col" className="fb-ld-th--right">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? ["60%", "80%", "45%", "70%", "55%"].map((w, i) => (
                    <tr key={i}>
                      <td colSpan={colSpan} className="fb-ld-td--skel">
                        <div className="fb-ld-skel" style={{ width: w }} />
                      </td>
                    </tr>
                  ))
                : null}
              {!loading && !error
                ? rows.map((l) => {
                    const c = contactOf(l);
                    const c2 = caps(l);
                    const [sbg, sfg] = statusTone(l.leadStatus.key);
                    const [tbg, tfg] = tempTone(l.temperature);
                    const ds = fmt.dueState(l.nextFollowUpAt);
                    const isPoolRow = inPool;
                    const showOwnerSelect = can("leads.assign");
                    const owner = ref.memberName(l.ownerMembershipId);
                    const isSelected = selected.has(l.id);
                    const name = leadName(l);
                    const href = `/o/${orgSlug}/leads/${l.id}`;
                    return (
                      <tr key={l.id} data-selected={isSelected || undefined}>
                        <td className="fb-ld-td--check">
                          <input
                            type="checkbox"
                            aria-label={`Select ${name}`}
                            checked={isSelected}
                            onChange={() => {
                              const next = new Set(selected);
                              if (isSelected) next.delete(l.id);
                              else next.add(l.id);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td>
                          <Link href={href} className="fb-ld-name">
                            {name}
                          </Link>
                          <div className="fb-ld-sub">
                            {c ? `${contactName(c)}${c.jobTitle ? ` · ${c.jobTitle}` : ""}` : "No contact yet"}
                            {l.leadSource?.key === "WEBSITE" ? (
                              <span className="fb-ld-chip fb-ld-chip--web">
                                <Icon name="globe" size={11} />
                                Website
                              </span>
                            ) : null}
                            {c && !c.email ? <span className="fb-ld-chip fb-ld-chip--warn">No email</span> : null}
                            {l.score ? (
                              <span className="fb-ld-chip fb-ld-chip--score" title={`Lead score ${l.score.score} (${l.score.band})`}>
                                Score {l.score.score}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        {shownCols.map((col) => {
                          switch (col.id) {
                            case "status":
                              return (
                                <td key={col.id}>
                                  <span className="fb-ld-status" style={{ background: sbg, color: sfg }}>
                                    {l.leadStatus.name}
                                  </span>
                                </td>
                              );
                            case "temperature":
                              return (
                                <td key={col.id}>
                                  <span className="fb-ld-temp" style={{ background: tbg, color: tfg }}>
                                    {l.temperature}
                                  </span>
                                </td>
                              );
                            case "source":
                              return (
                                <td key={col.id} className="fb-ld-muted">
                                  {l.leadSource?.name ?? "—"}
                                </td>
                              );
                            case "service":
                              return (
                                <td key={col.id} className="fb-ld-muted">
                                  {ref.service(l.serviceInterestId)?.name ?? "—"}
                                </td>
                              );
                            case "next":
                              return (
                                <td key={col.id}>
                                  <span className="fb-ld-next" style={{ color: DUE_COLOUR[ds] }}>
                                    {l.nextFollowUpAt ? fmt.dueLabel(l.nextFollowUpAt) : "—"}
                                  </span>
                                </td>
                              );
                            case "owner":
                              return (
                                <td key={col.id}>
                                  {showOwnerSelect && !l.archived && !isPoolRow ? (
                                    <select className="fb-ld-owner-select" aria-label={`Owner of ${name}`} value={l.ownerMembershipId ?? ""} onChange={(e) => e.target.value && reassign(l, e.target.value)} disabled={!c2.canReassign}>
                                      {!l.ownerMembershipId ? <option value="">Unassigned</option> : null}
                                      {ref.owners.map((o) => (
                                        <option key={o.membershipId} value={o.membershipId}>
                                          {ownerLabel(o)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="fb-ld-owner" title={showOwnerSelect ? undefined : noAssignReason}>
                                      <span className="fb-ld-owner__ini">{owner ? personInitials(owner.replace("Dev ", "")) : "–"}</span>
                                      {owner ?? "Unassigned"}
                                      {!showOwnerSelect ? (
                                        <span className="fb-ld-owner__lock">
                                          <Icon name="lock" size={12} />
                                          <span className="fb-sr-only">{noAssignReason}</span>
                                        </span>
                                      ) : null}
                                    </span>
                                  )}
                                </td>
                              );
                          }
                        })}
                        <td className="fb-ld-td--actions">
                          {isPoolRow ? (
                            can("leads.claim") || can("leads.assign") ? (
                              <button type="button" className="fb-ld-btn fb-ld-btn--sm" disabled={Boolean(l.myPendingRequestId)} onClick={() => askToTake(l)} title={l.myPendingRequestId ? "You have already asked for this lead" : undefined}>
                                {l.myPendingRequestId ? "Requested" : "Ask to take"}
                              </button>
                            ) : null
                          ) : null}
                          {l.archived && c2.canRestore ? (
                            <button type="button" className="fb-ld-btn fb-ld-btn--sm" onClick={() => restore(l)}>
                              <Icon name="restore" size={14} />
                              Restore
                            </button>
                          ) : null}
                          {!isPoolRow && !l.archived && c2.canEdit ? (
                            <span className="fb-ld-rowactions">
                              <button type="button" className="fb-ld-iconbtn" title="Edit" aria-label={`Edit ${name}`} onClick={() => setDrawer({ id: l.id })}>
                                <Icon name="pencil" size={15} />
                              </button>
                              {c2.converted ? (
                                <Link className="fb-ld-iconbtn fb-ld-iconbtn--convert" title="Open lead" aria-label={`Open ${name}`} href={href}>
                                  <Icon name="arrow-circle" size={16} />
                                </Link>
                              ) : (
                                <button type="button" className="fb-ld-iconbtn fb-ld-iconbtn--convert" title={c2.canConvert ? "Convert to deal" : "Your role cannot convert leads"} aria-label={`Convert ${name} to deal`} disabled={!c2.canConvert} onClick={() => setConvertId(l.id)}>
                                  <Icon name="arrow-circle" size={16} />
                                </button>
                              )}
                              <button type="button" className="fb-ld-iconbtn" title={c2.canArchive ? "Archive" : "Your role cannot archive this lead"} aria-label={`Archive ${name}`} disabled={!c2.canArchive} onClick={() => archive(l)}>
                                <Icon name="archive" size={15} />
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>

        {noResults ? (
          <div className="fb-ld-state">
            <div className="fb-ld-state__title">No leads match these filters</div>
            <div className="fb-ld-state__body">Try a different status or owner.</div>
            <button type="button" className="fb-ld-btn fb-ld-btn--md" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}
        {empty ? (
          <div className="fb-ld-state fb-ld-state--empty">
            <div className="fb-ld-state__icon">
              <Icon name="users" size={24} />
            </div>
            <div className="fb-ld-state__title">{tab === "all" ? "Nothing here yet. Start with your first lead." : tab === "archived" ? "No archived leads." : tab === "converted" ? "No converted leads yet." : tab === "hot" ? "No hot leads right now." : "The shared pool is empty."}</div>
            <div className="fb-ld-state__body">Website and email enquiries also land here automatically once Settings › Website integration is connected.</div>
            <div className="fb-ld-state__row">
              {can("leads.create") ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer({})}>
                  New lead
                </button>
              ) : null}
              {can("leads.import") ? (
                <button type="button" className="fb-ld-btn" onClick={() => setImporting(true)}>
                  Import CSV
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {error && !forbidden ? (
          <div role="alert" className="fb-ld-state">
            <div className="fb-ld-state__alert">
              <Icon name="alert" size={24} />
            </div>
            <div className="fb-ld-state__title" style={{ marginTop: 8 }}>
              Leads didn’t load
            </div>
            <div className="fb-ld-state__body" style={{ marginTop: 4 }}>
              Check your connection. Nothing was lost.
            </div>
            <button type="button" className="fb-ld-btn fb-ld-btn--md fb-ld-btn--primary" onClick={() => active.refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="fb-ld-pager">
          <span className="fb-ld-pager__label" aria-live="polite">
            {total ? `Showing ${pageStart}–${pageEnd} of ${total} leads` : "No leads"}
          </span>
          <label>
            Rows
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
                setSelected(new Set());
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <div className="fb-ld-pager__nav">
            <button type="button" className="fb-ld-pager__btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <Icon name="chevron-left" size={15} />
            </button>
            <button type="button" className="fb-ld-pager__btn" aria-label="Next page" disabled={lastPage} onClick={() => setPage((p) => p + 1)}>
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
        </div>
        {bigList ? (
          <div className="fb-ld-bignote">
            <Icon name="info" size={14} />
            Large lists load {perPage} rows at a time. Filters and search run on the server, so they cover all {total} leads, not just this page.
          </div>
        ) : null}
      </section>

      {drawer ? (
        <LeadDrawer
          leadId={drawer.id}
          onClose={() => setDrawer(null)}
          onSaved={(id) => {
            const wasNew = !drawer.id;
            setDrawer(null);
            if (wasNew) router.push(`/o/${orgSlug}/leads/${id}`);
          }}
        />
      ) : null}
      {convertId ? (
        <ConvertDialog
          leadId={convertId}
          onClose={() => setConvertId(null)}
          onDone={() => {
            setConvertId(null);
            void refresh();
          }}
        />
      ) : null}
      {importing ? <ImportWizard onClose={() => setImporting(false)} onDone={() => void refresh()} /> : null}
      {exporting ? <ExportDialog total={tab === "archived" || tab === "converted" ? total : (allCount.data?.total ?? total)} filters={{ q, leadStatusId: filters.status, leadSourceId: filters.source, ownerMembershipId: filters.owner }} onClose={() => setExporting(null)} /> : null}
    </div>
  );
}
