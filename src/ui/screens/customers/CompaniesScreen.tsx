"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "@/api-client";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { downloadText } from "../leads/data";
import { Icon } from "../leads/icons";
import { ArchiveDialog } from "./ArchiveDialog";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { CompanyDrawer } from "./CompanyDrawer";
import { MergeDialog } from "./merge/MergeDialog";
import { lifecycleTone, initialsFrom, useCustomerReference, useDebounced, type CompanyRow } from "./data";

type TabId = "all" | "mine" | "dormant" | "archived";

/** The keys that count as "a customer" in the design's Customers tile: won at least once and not a prospect. */
const CUSTOMER_KEYS = ["CUSTOMER", "ONBOARDING", "ACTIVE_CUSTOMER", "RENEWAL"];

function useCount(lifecycle: string | null) {
  const { orgSlug } = useMember();
  const q = useApiQuery("listCompanyDirectory", { params: { orgSlug }, query: { tab: "ALL", lifecycle: lifecycle ?? undefined, pageSize: "1" } }, { enabled: lifecycle !== null, staleTime: 60_000 });
  return lifecycle === null ? null : (q.data?.total ?? null);
}

/**
 * The Companies list (C1, FIG-1095): every organisation the team works with, in one shared list. Tabs All, My companies, Dormant and
 * Archived; the counts and the rows come from the directory API, which pages and filters on the server, so search covers every company
 * and not only the page on screen. Roles that may reassign see an owner picker; roles that may only view see the owner as text.
 */
export function CompaniesScreen() {
  const member = useMember();
  const { orgSlug, membershipId, can } = member;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useCustomerReference();

  const wantedView = params?.get("view");
  const [tab, setTab] = useState<TabId>(() => (wantedView === "dormant" || wantedView === "archived" || wantedView === "mine" ? wantedView : "all"));
  const [q, setQ] = useState(params?.get("q") ?? "");
  const [lifecycle, setLifecycle] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [drawer, setDrawer] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<CompanyRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const search = useDebounced(q.trim(), 300);

  const canEdit = can("companies.edit");
  const canReassign = canEdit && can("membership.manage");
  const canMerge = can("companies.merge");
  const canArchive = can("companies.archive");

  // A link from the home ("New company") arrives as ?new=1: open the drawer once and clear the parameter.
  const wantsNew = params?.get("new") === "1";
  useEffect(() => {
    if (wantsNew) {
      setDrawer(true);
      router.replace(pathname);
    }
  }, [wantsNew, router, pathname]);

  const query = useMemo(() => {
    const base: Record<string, string> = { tab: tab === "dormant" ? "DORMANT" : tab === "archived" ? "ARCHIVED" : "ALL", page: String(page), pageSize: String(perPage) };
    if (search) base.q = search;
    if (lifecycle && tab !== "dormant") base.lifecycle = lifecycle;
    if (tab === "mine") base.ownerMembershipId = membershipId;
    return base;
  }, [tab, page, perPage, search, lifecycle, membershipId]);
  const listQ = useApiQuery("listCompanyDirectory", { params: { orgSlug }, query: query as never }, { placeholderData: (prev) => prev });
  const data = listQ.data;
  const rows = (data?.items ?? []) as unknown as CompanyRow[];
  const counts = (data?.tabCounts ?? {}) as { ALL?: number; DORMANT?: number; ARCHIVED?: number };

  const prospects = useCount("PROSPECT");
  const c1 = useCount(CUSTOMER_KEYS[0]!);
  const c2 = useCount(CUSTOMER_KEYS[1]!);
  const c3 = useCount(CUSTOMER_KEYS[2]!);
  const c4 = useCount(CUSTOMER_KEYS[3]!);
  const customers = [c1, c2, c3, c4].every((n) => n !== null) ? (c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) + (c4 ?? 0) : null;

  const error = listQ.error;
  const forbidden = error instanceof ApiRequestError && error.status === 403;
  const loading = listQ.isLoading;
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const filtered = Boolean(search || lifecycle);
  const noResults = !loading && !error && rows.length === 0 && (filtered || tab !== "all");
  const empty = !loading && !error && rows.length === 0 && !filtered && tab === "all";

  const reassign = useApiMutation("patchCompaniesByCompanyId", {
    invalidate: [["listCompanyDirectory"]],
    onError: (e) => toast.show({ tone: "danger", message: describeError(e).body }),
  });
  const archiveM = useApiMutation("postCompaniesByCompanyIdArchive", { invalidate: [["listCompanyDirectory"], ["getCustomer360"]] });
  const restoreM = useApiMutation("postCompaniesByCompanyIdRestore", { invalidate: [["listCompanyDirectory"], ["getCustomer360"]] });

  async function restore(c: CompanyRow) {
    try {
      await restoreM.mutateAsync({ params: { orgSlug, companyId: c.id } } as never);
      toast.show({ tone: "success", message: `${c.name} restored.` });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    }
  }
  async function archive(c: CompanyRow) {
    try {
      await archiveM.mutateAsync({ params: { orgSlug, companyId: c.id }, body: {} } as never);
      setArchiving(null);
      toast.show({
        tone: "success",
        message: `${c.name} archived.`,
        undo: async () => {
          await api.call("postCompaniesByCompanyIdRestore", { params: { orgSlug, companyId: c.id }, idempotencyKey: newIdempotencyKey() } as never);
          await qc.invalidateQueries();
        },
      });
    } catch (e) {
      setArchiving(null);
      toast.show({ tone: "danger", message: describeError(e).body });
    }
  }
  async function exportCsv() {
    setExporting(true);
    try {
      const csv = (await api.call("exportCompanyDirectory", { params: { orgSlug }, query: { tab: query.tab, q: search || undefined, lifecycle: lifecycle || undefined } as never })) as unknown as string;
      downloadText(`companies-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.show({ tone: "success", message: "Exported companies." });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    } finally {
      setExporting(false);
    }
  }

  if (forbidden) return <NoAccess area="Companies" denial={describeError(error).denial} />;

  const seesAll = can("membership.manage");
  const scopeTone = seesAll ? "fb-ld-scope--org" : canEdit ? "fb-ld-scope--own" : "fb-ld-scope--ro";
  const scopeLabel = seesAll ? "All organisation companies" : canEdit ? "Shared list" : "Read-only";
  const hint = seesAll
    ? "You can add, edit, reassign, merge, archive, import and export any company."
    : !canEdit
      ? "You can view companies. Ask Sales or Management to change details."
      : "You can add companies, and edit, merge or archive them.";

  const tabs: { id: TabId; label: string; n: number | undefined }[] = [
    { id: "all", label: "All", n: counts.ALL },
    ...(canEdit ? [{ id: "mine" as const, label: "My companies", n: undefined }] : []),
    { id: "dormant", label: "Dormant", n: counts.DORMANT },
    { id: "archived", label: "Archived", n: counts.ARCHIVED },
  ];
  const changeTab = (id: TabId) => {
    setTab(id);
    setPage(1);
  };
  const pageStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const pageEnd = Math.min(total, page * perPage);

  const stats = [
    { l: "Companies", n: counts.ALL, sub: `${counts.ARCHIVED ?? "…"} archived`, dot: "var(--blue)" },
    { l: "Customers", n: customers, sub: "onboarding or active", dot: "var(--primary)" },
    { l: "Prospects", n: prospects, sub: "not yet won", dot: "var(--orange)" },
    { l: "Dormant", n: counts.DORMANT, sub: "no contact in 90+ days", dot: "var(--purple)" },
  ];

  return (
    <div className="fb-cu" data-screen-label="Companies">
      <div className="fb-cu-head">
        <div>
          <h1 className="fb-cu-title">Companies</h1>
          <div className="fb-cu-sub">Every organisation you work with, in one shared list.</div>
          <div className="fb-cu-meta">
            <span className={`fb-ld-scope ${scopeTone}`}>
              <span className="fb-ld-scope__dot" />
              {scopeLabel} · {counts.ALL ?? "…"}
            </span>
            <span className="fb-ld-hint">{hint}</span>
          </div>
        </div>
        <div className="fb-cu-actions">
          {can("companies.import") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setImporting(true)}>
              <Icon name="upload" size={16} />
              Import CSV
            </button>
          ) : null}
          {can("companies.export") ? (
            <button type="button" className="fb-ld-btn" disabled={exporting} onClick={exportCsv}>
              <Icon name="download" size={16} />
              Export CSV
            </button>
          ) : null}
          {can("companies.create") ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer(true)}>
              <Icon name="plus" size={16} stroke={2.2} />
              New company
            </button>
          ) : null}
        </div>
      </div>

      <div className="fb-cu-stats">
        {stats.map((s) => (
          <div key={s.l} className="fb-cu-stat">
            <div className="fb-cu-stat__l">
              <span className="fb-cu-stat__dot" style={{ background: s.dot }} />
              {s.l}
            </div>
            <div className="fb-cu-stat__n">{s.n ?? "…"}</div>
            <div className="fb-cu-stat__sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="fb-cu-row">
        <div role="tablist" aria-label="Company views" className="fb-ld-tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="fb-ld-tab" onClick={() => changeTab(t.id)}>
              {t.label}
              <span className="fb-ld-tab__n">{t.n ?? ""}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select className="fb-cu-select" aria-label="Lifecycle" value={lifecycle} disabled={tab === "dormant"} onChange={(e) => (setLifecycle(e.target.value), setPage(1))}>
            <option value="">Any lifecycle</option>
            {ref.states.map((s) => (
              <option key={s.id} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="fb-cu-search">
            <span className="fb-cu-search__icon">
              <Icon name="search" size={16} />
            </span>
            <input type="search" aria-label="Search companies" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Search name, email, phone, industry" />
          </div>
        </div>
      </div>

      <section className="fb-cu-card" aria-label="Companies">
        <div className="fb-cu-scroll">
          <table className="fb-cu-table" aria-busy={loading || undefined}>
            <caption className="fb-sr-only">Companies</caption>
            <thead>
              <tr>
                <th scope="col">COMPANY</th>
                <th scope="col">INDUSTRY</th>
                <th scope="col">LIFECYCLE</th>
                <th scope="col" data-align="right">CONTACTS</th>
                <th scope="col">OWNER</th>
                <th scope="col" data-align="right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? ["60%", "80%", "45%", "70%", "55%"].map((w, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <div className="fb-cu-skel" style={{ width: w }} />
                      </td>
                    </tr>
                  ))
                : null}
              {!loading && !error
                ? rows.map((c) => {
                    const [bg, fg] = lifecycleTone(c.lifecycleState?.key);
                    const archived = Boolean(c.archivedAt);
                    const ownerName = c.owner?.user.name ?? ref.ownerName(c.ownerMembershipId);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/o/${orgSlug}/companies/${c.id}`} className="fb-cu-name">
                            {c.name}
                          </Link>
                          {c.location ? <div className="fb-cu-loc">{c.location}</div> : null}
                        </td>
                        <td className="fb-cu-muted">{c.industry || "—"}</td>
                        <td>
                          <span className="fb-cu-pill" style={{ background: bg, color: fg }}>
                            {c.lifecycleState?.name ?? "No state"}
                          </span>
                        </td>
                        <td data-align="right">{c._count?.contacts ?? 0}</td>
                        <td>
                          {canReassign && !archived ? (
                            <select
                              className="fb-cu-select"
                              aria-label={`Owner of ${c.name}`}
                              value={c.ownerMembershipId ?? ""}
                              onChange={(e) => e.target.value && reassign.mutate({ params: { orgSlug, companyId: c.id }, body: { ownerMembershipId: e.target.value } } as never)}
                            >
                              {!c.ownerMembershipId ? <option value="">Unassigned</option> : null}
                              {ref.members.map((m) => (
                                <option key={m.membershipId} value={m.membershipId}>
                                  {m.userName} ({m.roleName})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="fb-cu-owner">
                              <span className="fb-cu-owner__ini">{initialsFrom(ownerName)}</span>
                              {ownerName ?? "Unassigned"}
                            </span>
                          )}
                        </td>
                        <td data-align="right" style={{ whiteSpace: "nowrap" }}>
                          {archived && canArchive ? (
                            <button type="button" className="fb-ld-btn fb-ld-btn--sm" onClick={() => restore(c)}>
                              <Icon name="restore" size={14} />
                              Restore
                            </button>
                          ) : null}
                          {!archived && (canMerge || canArchive) ? (
                            <span className="fb-cu-rowact">
                              {canMerge ? (
                                <button type="button" className="fb-ld-iconbtn" title="Merge duplicates" aria-label={`Merge ${c.name}`} onClick={() => setMerging(c.id)}>
                                  <Icon name="merge" size={15} />
                                </button>
                              ) : null}
                              {canArchive ? (
                                <button type="button" className="fb-ld-iconbtn" title="Archive" aria-label={`Archive ${c.name}`} onClick={() => setArchiving(c)}>
                                  <Icon name="archive" size={15} />
                                </button>
                              ) : null}
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
          <div className="fb-cu-state">
            <div>{tab === "archived" ? "No archived companies." : "No companies match."}</div>
            {filtered ? (
              <div className="fb-cu-state__row">
                <button type="button" className="fb-ld-btn fb-ld-btn--md" onClick={() => (setQ(""), setLifecycle(""), setPage(1))}>
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {empty ? (
          <div className="fb-cu-state fb-cu-state--empty">
            <div className="fb-cu-state__icon">
              <Icon name="building" size={24} />
            </div>
            <div className="fb-cu-state__title">No companies yet.</div>
            <div className="fb-cu-state__body">Companies appear here when a lead is converted, or you can add one now.</div>
            <div className="fb-cu-state__row">
              {can("companies.create") ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer(true)}>
                  New company
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {error && !forbidden ? (
          <div role="alert" className="fb-cu-state">
            <div className="fb-cu-state__icon">
              <Icon name="alert" size={24} />
            </div>
            <div className="fb-cu-state__title">Companies didn’t load</div>
            <div className="fb-cu-state__body">Check your connection. Nothing was lost.</div>
            <div className="fb-cu-state__row">
              <button type="button" className="fb-ld-btn fb-ld-btn--md fb-ld-btn--primary" onClick={() => listQ.refetch()}>
                Retry
              </button>
            </div>
          </div>
        ) : null}

        <div className="fb-cu-pager">
          <span aria-live="polite">{total ? `Showing ${pageStart}–${pageEnd} of ${total} companies` : "No companies"}</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Rows
            <select className="fb-cu-select" style={{ height: 30 }} value={perPage} onChange={(e) => (setPerPage(Number(e.target.value)), setPage(1))}>
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="fb-cu-pager__nav">
            <button type="button" className="fb-ld-btn fb-ld-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </span>
        </div>
      </section>

      {drawer ? (
        <CompanyDrawer
          onClose={() => setDrawer(false)}
          onSaved={(id) => {
            setDrawer(false);
            router.push(`/o/${orgSlug}/companies/${id}`);
          }}
        />
      ) : null}
      {importing ? <ImportCsvDialog kind="companies" onClose={() => setImporting(false)} onDone={() => void qc.invalidateQueries({ queryKey: ["listCompanyDirectory"] })} /> : null}
      {merging ? <MergeDialog kind="company" id={merging} onClose={() => setMerging(null)} /> : null}
      {archiving ? (
        <ArchiveDialog title={`Archive ${archiving.name}?`} onCancel={() => setArchiving(null)} onConfirm={() => archive(archiving)} />
      ) : null}
    </div>
  );
}
