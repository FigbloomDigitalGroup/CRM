"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "@/api-client";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { useDebounced } from "../leads/data";
import { Icon } from "../leads/icons";
import { personInitials } from "../leads/format";
import { ContactDrawer } from "./ContactDrawer";
import { contactName, ownerName, useContactCaps, useRefreshContacts, type ContactRow, type DirectoryCounts } from "./data";
import { ContactsExportDialog, ContactsImportDialog } from "./ImportExport";
import { ReachButtons, useCallLogPrompt } from "./QuickLogPrompt";

type TabId = "all" | "mine" | "standalone" | "missingEmail" | "archived";

/**
 * The Contacts list (C3, FIG-1096): "the people you work with, in one shared list." Tabs for all, mine, no company (standalone), missing email
 * and archived; search across name, email, phone and company; paging on the server; and Call / WhatsApp on every row with a number, each
 * followed by the log prompt. What each role may do is the API's `contacts.*` and `communications.create` keys; the screen only explains.
 */
export function ContactsScreen() {
  const member = useMember();
  const { orgSlug, membershipId, can } = member;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const api = useApi();
  const toast = useToast();
  const caps = useContactCaps();
  const refresh = useRefreshContacts();
  const prompt = useCallLogPrompt();

  const editRole = can("contacts.edit");
  const mgmt = can("membership.manage") && editRole;
  const readOnly = !editRole;

  const wanted = params?.get("view");
  const [tab, setTab] = useState<TabId>(() => (wanted === "standalone" || wanted === "missingEmail" || wanted === "archived" ? wanted : wanted === "mine" && editRole ? "mine" : "all"));
  const [q, setQ] = useState(params?.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [drawer, setDrawer] = useState<{ id?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // A link from the quick-create menu or the home arrives as ?new=1: open the drawer once and clear the parameter.
  const wantsNew = params?.get("new") === "1";
  useEffect(() => {
    if (wantsNew && can("contacts.create")) {
      setDrawer({});
      router.replace(pathname);
    }
  }, [wantsNew, can, router, pathname]);

  const search = useDebounced(q.trim(), 300);
  const query = useMemo(() => {
    const base: Record<string, string> = { page: String(page), pageSize: String(perPage) };
    if (search) base.q = search;
    if (tab === "mine") base.ownerMembershipId = membershipId;
    if (tab === "standalone") base.standalone = "true";
    if (tab === "missingEmail") base.missingEmail = "true";
    if (tab === "archived") base.archived = "true";
    return base;
  }, [tab, search, page, perPage, membershipId]);

  const listQ = useApiQuery("listContactDirectory", { params: { orgSlug }, query: query as never }, { placeholderData: (prev) => prev });
  // The tiles and tab counts ignore the search and the tab: a one-row read each, so the cost is a COUNT, never the rows.
  const statsQ = useApiQuery("listContactDirectory", { params: { orgSlug }, query: { page: "1", pageSize: "1" } as never }, { staleTime: 30_000 });
  const mineQ = useApiQuery("listContactDirectory", { params: { orgSlug }, query: { page: "1", pageSize: "1", ownerMembershipId: membershipId } as never }, { staleTime: 30_000 });
  const counts = (statsQ.data?.counts ?? {}) as DirectoryCounts;
  const mineCount = mineQ.data?.total;

  const rows = ((listQ.data?.items ?? []) as unknown as ContactRow[]) ?? [];
  const total = listQ.data?.total ?? 0;
  const error = listQ.error;
  const forbidden = error instanceof ApiRequestError && error.status === 403;
  const loading = listQ.isLoading || (listQ.isFetching && listQ.isPlaceholderData && rows.length === 0);
  const empty = !loading && !error && total === 0 && !search && tab === "all";
  const noResults = !loading && !error && total === 0 && !empty;
  const pageStart = total ? (page - 1) * perPage + 1 : 0;
  const pageEnd = Math.min(total, page * perPage);
  const lastPage = page * perPage >= total;

  const tabs: { id: TabId; label: string; n: number | undefined }[] = [
    { id: "all", label: "All", n: counts.all },
    ...(editRole ? [{ id: "mine" as const, label: "My contacts", n: mineCount }] : []),
    { id: "standalone", label: "No company", n: counts.standalone },
    { id: "missingEmail", label: "Missing email", n: counts.missingEmail },
    { id: "archived", label: "Archived", n: counts.archived },
  ];
  const stats = [
    { l: "Contacts", n: counts.all, sub: `${counts.archived ?? 0} archived`, dot: "var(--blue)" },
    { l: "Mine", n: mineCount, sub: "contacts you own", dot: "var(--primary)" },
    { l: "No company", n: counts.standalone, sub: "standalone contacts", dot: "var(--orange)" },
    { l: "Missing email", n: counts.missingEmail, sub: "can’t be emailed yet", dot: "var(--purple)" },
  ];

  function changeTab(next: TabId) {
    setTab(next);
    setPage(1);
  }

  async function restore(c: ContactRow) {
    try {
      await api.call("postContactsByContactIdRestore", { params: { orgSlug, contactId: c.id }, idempotencyKey: newIdempotencyKey() } as never);
      toast.show({ message: `${contactName(c)} restored` });
      await refresh();
    } catch (err) {
      toast.show({ tone: "danger", message: describeError(err).body });
    }
  }

  if (forbidden) return <NoAccess area="Contacts" denial={describeError(error).denial} />;

  const scopeClass = mgmt ? "fb-ld-scope--org" : readOnly ? "fb-ld-scope--ro" : "fb-ld-scope--own";
  const scopeLabel = mgmt ? "All organisation contacts" : readOnly ? "Read-only" : "Shared list";
  const hint = mgmt
    ? "You can add, edit, reassign, merge, archive, import and export any contact."
    : readOnly
      ? "You can view contacts and reach them by phone or WhatsApp."
      : "Tap call or WhatsApp; you’ll be asked to log the conversation after.";
  const filterForExport = { q: search, ownerMembershipId: tab === "mine" ? membershipId : "", standalone: tab === "standalone" ? "true" : "", missingEmail: tab === "missingEmail" ? "true" : "", archived: tab === "archived" ? "true" : "" };

  return (
    <div className="fb-ld fb-ct" data-screen-label="Contacts">
      <div className="fb-ld-head">
        <div>
          <h1 className="fb-ld-title">Contacts</h1>
          <div className="fb-ct-sub">The people you work with, in one shared list.</div>
          <div className="fb-ld-meta">
            <span className={`fb-ld-scope ${scopeClass}`}>
              <span className="fb-ld-scope__dot" />
              {scopeLabel} · {counts.all ?? "…"}
            </span>
            <span className="fb-ld-hint">{hint}</span>
          </div>
        </div>
        <div className="fb-ld-actions">
          {can("contacts.import") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setImporting(true)}>
              <Icon name="upload" size={16} />
              Import CSV
            </button>
          ) : null}
          {can("contacts.export") ? (
            <button type="button" className="fb-ld-btn" onClick={() => setExporting(true)}>
              <Icon name="download" size={16} />
              Export CSV
            </button>
          ) : null}
          {can("contacts.create") ? (
            <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer({})}>
              <Icon name="plus" size={16} stroke={2.2} />
              New contact
            </button>
          ) : null}
        </div>
      </div>

      <div className="fb-ct-stats" aria-label="Contact totals">
        {stats.map((s) => (
          <div key={s.l} className="fb-ct-stat">
            <div className="fb-ct-stat__label">
              <span className="fb-ct-stat__dot" style={{ background: s.dot }} />
              {s.l}
            </div>
            <div className="fb-ct-stat__n">{s.n ?? "…"}</div>
            <div className="fb-ct-stat__sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="fb-ld-tabs-row">
        <div role="tablist" aria-label="Contact views" className="fb-ld-tabs">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="fb-ld-tab" onClick={() => changeTab(t.id)}>
              {t.label}
              <span className="fb-ld-tab__n">{t.n ?? ""}</span>
            </button>
          ))}
        </div>
        <div className="fb-ld-search fb-ct-search">
          <span className="fb-ld-search__icon">
            <Icon name="search" size={16} />
          </span>
          <input
            className="fb-ld-input"
            type="search"
            aria-label="Search contacts"
            placeholder="Search name, email, phone, company"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <section className="fb-ld-card" aria-label="Contacts">
        <div className="fb-ld-scroll">
          <table className="fb-ld-table fb-ct-table" aria-busy={loading || undefined}>
            <caption className="fb-sr-only">Contacts</caption>
            <thead>
              <tr>
                <th scope="col">CONTACT</th>
                <th scope="col">COMPANY</th>
                <th scope="col">EMAIL / PHONE</th>
                <th scope="col">OWNER</th>
                <th scope="col" className="fb-ld-th--right">
                  REACH
                </th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? ["60%", "80%", "45%", "70%", "55%"].map((w, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="fb-ld-td--skel">
                        <div className="fb-ld-skel" style={{ width: w }} />
                      </td>
                    </tr>
                  ))
                : null}
              {!loading && !error
                ? rows.map((c) => {
                    const name = contactName(c);
                    const c2 = caps(c);
                    const owner = ownerName(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/o/${orgSlug}/contacts/${c.id}`} className="fb-ld-name">
                            {name}
                          </Link>
                          {c.jobTitle ? <div className="fb-ld-sub">{c.jobTitle}</div> : null}
                        </td>
                        <td>
                          {c.company ? (
                            <Link href={`/o/${orgSlug}/companies/${c.company.id}`} className="fb-ct-company">
                              {c.company.name}
                            </Link>
                          ) : (
                            <span className="fb-ld-muted">No company</span>
                          )}
                        </td>
                        <td>
                          <div>{c.email || "—"}</div>
                          <div className="fb-ld-sub">{c.phone || "No phone"}</div>
                        </td>
                        <td>
                          <span className="fb-ld-owner">
                            <span className="fb-ld-owner__ini">{owner === "Unassigned" ? "–" : personInitials(owner.replace("Dev ", ""))}</span>
                            {owner}
                          </span>
                        </td>
                        <td className="fb-ld-td--actions">
                          {c2.archived ? (
                            c2.canRestore ? (
                              <button type="button" className="fb-ld-btn fb-ld-btn--sm" onClick={() => restore(c)}>
                                <Icon name="restore" size={14} />
                                Restore
                              </button>
                            ) : (
                              <span className="fb-ld-muted">Archived</span>
                            )
                          ) : c2.canReach ? (
                            <ReachButtons name={name} phone={c.phone} target={{ contactId: c.id, name: c.firstName }} begin={prompt.begin} />
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
            <div className="fb-ld-state__title">No contacts match.</div>
            <div className="fb-ld-state__body">{search ? "Try a different name, email, phone or company." : tab === "archived" ? "Nothing has been archived." : "Nothing in this view right now."}</div>
            {search || tab !== "all" ? (
              <button
                type="button"
                className="fb-ld-btn fb-ld-btn--md"
                onClick={() => {
                  setQ("");
                  changeTab("all");
                }}
              >
                Show all contacts
              </button>
            ) : null}
          </div>
        ) : null}
        {empty ? (
          <div className="fb-ld-state fb-ld-state--empty">
            <div className="fb-ld-state__icon">
              <Icon name="contact" size={24} />
            </div>
            <div className="fb-ld-state__title">No contacts yet. Add your first one.</div>
            <div className="fb-ld-state__body">Contacts are the people behind your companies and leads. Phone or email is enough to start.</div>
            <div className="fb-ld-state__row">
              {can("contacts.create") ? (
                <button type="button" className="fb-ld-btn fb-ld-btn--primary" onClick={() => setDrawer({})}>
                  New contact
                </button>
              ) : null}
              {can("contacts.import") ? (
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
              Contacts didn’t load
            </div>
            <div className="fb-ld-state__body" style={{ marginTop: 4 }}>
              Check your connection. Nothing was lost.
            </div>
            <button type="button" className="fb-ld-btn fb-ld-btn--md fb-ld-btn--primary" onClick={() => listQ.refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="fb-ld-pager">
          <span className="fb-ld-pager__label" aria-live="polite">
            {total ? `Showing ${pageStart}–${pageEnd} of ${total} contacts` : "No contacts"}
          </span>
          <label>
            Rows
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
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
      </section>

      {drawer ? (
        <ContactDrawer
          contactId={drawer.id}
          onClose={() => setDrawer(null)}
          onSaved={(id) => {
            const wasNew = !drawer.id;
            setDrawer(null);
            if (wasNew) router.push(`/o/${orgSlug}/contacts/${id}`);
          }}
        />
      ) : null}
      {importing ? <ContactsImportDialog onClose={() => setImporting(false)} onDone={() => void refresh()} /> : null}
      {exporting ? <ContactsExportDialog total={total} filters={filterForExport} onClose={() => setExporting(false)} /> : null}
      {prompt.element}
    </div>
  );
}
