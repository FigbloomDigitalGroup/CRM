"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { describeError } from "../../errors";
import { ErrorState, NoAccess } from "../../components/states";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { HIcon, Seg } from "./kit";

type GroupType = "leads" | "companies" | "contacts" | "deals" | "tasks";

/** The design's order, label and icon for each kind of result. */
export const GROUPS: { type: GroupType; label: string; kind: string; icon: string }[] = [
  { type: "leads", label: "Leads", kind: "Lead", icon: "users" },
  { type: "companies", label: "Companies", kind: "Company", icon: "building" },
  { type: "contacts", label: "Contacts", kind: "Contact", icon: "contact" },
  { type: "deals", label: "Deals", kind: "Deal", icon: "briefcase" },
  { type: "tasks", label: "Tasks", kind: "Task", icon: "tasks" },
];

export function resultHref(orgSlug: string, type: GroupType, id: string): string {
  const base = `/o/${orgSlug}`;
  // Tasks have no page of their own: the Tasks page scrolls to the row, as the notification links do.
  return type === "tasks" ? `${base}/tasks#task-${id}` : `${base}/${type}/${id}`;
}

interface Hit {
  id: string;
  label: string;
  sublabel: string | null;
  archived?: boolean;
}

interface Hidden {
  someResultsHidden: boolean;
  unavailableGroups?: ({ type: string; reason?: string } | string)[];
  limitedToYours?: string[];
}

const MIN = 2;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The recent searches, and the two writes that keep them. */
function useRecents() {
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  const q = useApiQuery("getSearchRecents", { params: { orgSlug } }, { staleTime: 10_000 });
  const save = useApiMutation("postSearchRecents", { invalidate: [["getSearchRecents"]] });
  const clear = useApiMutation("deleteSearchRecents", { invalidate: [["getSearchRecents"]] });
  const recents = ((q.data?.recents ?? []) as { query: string }[]).map((r) => r.query).slice(0, 5);
  return {
    recents,
    remember: (query: string) => {
      const text = query.trim();
      if (text.length >= MIN) save.mutate({ params: { orgSlug }, body: { query: text } });
    },
    forget: () => {
      clear.mutate({ params: { orgSlug } });
      void qc.invalidateQueries({ queryKey: ["getSearchRecents"] });
    },
  };
}

/**
 * The top-bar search (G2): grouped results while you type, recent searches before you do, all by keyboard (arrow keys move, Enter opens the
 * highlighted result, or the full results page when nothing is highlighted, Escape closes). The API limits every group to what the role may
 * open, so nothing here has to hide a result; it only says when something was left out.
 */
export function GlobalSearch() {
  const { orgSlug, roleName } = useMember();
  const router = useRouter();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(text.trim(), 220);
  const searching = term.length >= MIN;
  const { recents, remember, forget } = useRecents();

  const q = useApiQuery("search", { params: { orgSlug }, query: { q: term, pageSize: "2" } }, { enabled: searching && open, staleTime: 15_000 });

  const rows = useMemo(() => {
    if (!searching) return [];
    const groups = (q.data?.groups ?? []) as { type: GroupType; items: Hit[] }[];
    return GROUPS.flatMap((g) => (groups.find((x) => x.type === g.type)?.items ?? []).slice(0, 2).map((h) => ({ ...h, g })));
  }, [q.data, searching]);

  const options = useMemo(() => {
    const out: { key: string; run: () => void }[] = [];
    if (searching) {
      for (const r of rows) out.push({ key: `r-${r.g.type}-${r.id}`, run: () => go(resultHref(orgSlug, r.g.type, r.id)) });
      out.push({ key: "all", run: () => seeAll() });
    } else {
      for (const r of recents) out.push({ key: `rec-${r}`, run: () => setText(r) });
    }
    return out;
  }, [rows, recents, searching, orgSlug, text]);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  // "/" jumps to the search box from anywhere that is not a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && el && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    remember(text);
    close();
    setText("");
    router.push(href);
  }
  function seeAll() {
    const t = text.trim();
    if (t.length < MIN) return;
    remember(t);
    close();
    router.push(`/o/${orgSlug}/search?q=${encodeURIComponent(t)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + 1) % options.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && options[active]) options[active]!.run();
      else seeAll();
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  }

  const hidden = (q.data as { hidden?: Hidden } | undefined)?.hidden;
  const showPanel = open && (searching || recents.length > 0 || text.trim().length > 0);
  let optionIndex = -1;

  return (
    <div className="fb-gsearch" ref={wrap}>
      <span className="fb-gsearch__icon" aria-hidden="true">
        <HIcon name="search" size={17} />
      </span>
      <input
        ref={input}
        type="search"
        role="combobox"
        className="fb-gsearch__input"
        placeholder="Search Figbloom CRM"
        aria-label="Search records"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && active >= 0 && options[active] ? `${listId}-${options[active]!.key}` : undefined}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className="fb-gsearch__hint" aria-hidden="true">
        Enter
      </kbd>
      {showPanel ? (
        <div className="fb-gsearch__panel" id={listId} role="listbox" aria-label="Search results">
          {!searching && recents.length > 0 ? (
            <>
              <div className="fb-gsearch__head">
                <span>RECENT SEARCHES</span>
                <button type="button" className="fb-gsearch__clear" onClick={forget}>
                  Clear
                </button>
              </div>
              {recents.map((r) => {
                optionIndex += 1;
                const i = optionIndex;
                return (
                  <div
                    key={r}
                    id={`${listId}-rec-${r}`}
                    role="option"
                    aria-selected={active === i}
                    className="fb-gsearch__opt"
                    data-active={active === i ? "true" : undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setText(r);
                      input.current?.focus();
                    }}
                  >
                    <span className="fb-gsearch__ico">
                      <HIcon name="clock" size={15} />
                    </span>
                    <span className="fb-gsearch__main">
                      <span className="fb-gsearch__title">{r}</span>
                    </span>
                  </div>
                );
              })}
            </>
          ) : null}
          {searching ? (
            <>
              {q.isPending ? (
                <div className="fb-gsearch__note" role="status">
                  Searching…
                </div>
              ) : q.isError ? (
                <div className="fb-gsearch__note" role="alert">
                  {describeError(q.error).kind === "noAccess" ? "Search is not available for your role." : "Search did not respond. Try again in a moment."}
                </div>
              ) : rows.length === 0 ? (
                <div className="fb-gsearch__note" role="status">
                  No matches in records you can access.
                </div>
              ) : (
                rows.map((r) => {
                  optionIndex += 1;
                  const i = optionIndex;
                  return (
                    <div
                      key={`${r.g.type}-${r.id}`}
                      id={`${listId}-r-${r.g.type}-${r.id}`}
                      role="option"
                      aria-selected={active === i}
                      className="fb-gsearch__opt"
                      data-active={active === i ? "true" : undefined}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(resultHref(orgSlug, r.g.type, r.id))}
                    >
                      <span className="fb-gsearch__ico">
                        <HIcon name={r.g.icon} size={15} />
                      </span>
                      <span className="fb-gsearch__main">
                        <span className="fb-gsearch__title">{r.label}</span>
                        {r.sublabel ? <span className="fb-gsearch__sub">{r.sublabel}</span> : null}
                      </span>
                      <span className="fb-gsearch__kind">{r.archived ? `${r.g.kind} · archived` : r.g.kind}</span>
                    </div>
                  );
                })
              )}
              {hidden?.someResultsHidden && !q.isPending ? (
                <div className="fb-gsearch__scope">
                  <HIcon name="lock" size={12} /> Only records your {roleName} role can open are included.
                </div>
              ) : null}
              <div
                id={`${listId}-all`}
                role="option"
                aria-selected={active === options.length - 1}
                className="fb-gsearch__all"
                data-active={active === options.length - 1 && options.length > 0 ? "true" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={seeAll}
              >
                See all results for “{text.trim()}”
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* The results page ----------------------------------------------------------------------------------------------------------------- */

const PAGE = 25;

/**
 * The full results page (G2): the box, the scope note, a tab for each kind of record with its count, and the results. A kind the role cannot
 * search is explained in place, never silently absent.
 */
export function SearchResults() {
  const { orgSlug, roleName } = useMember();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const urlType = (params.get("type") as GroupType | null) ?? null;
  const [text, setText] = useState(urlQuery);
  const [page, setPage] = useState(1);
  const term = urlQuery.trim();
  const searching = term.length >= MIN;
  const active: GroupType | "all" = GROUPS.some((g) => g.type === urlType) ? (urlType as GroupType) : "all";

  useEffect(() => setText(urlQuery), [urlQuery]);
  useEffect(() => setPage(1), [term, active]);

  const q = useApiQuery(
    "search",
    { params: { orgSlug }, query: { q: term, ...(active === "all" ? { pageSize: "5" } : { type: active, pageSize: String(PAGE), page: String(page) }) } },
    { enabled: searching, staleTime: 15_000 },
  );
  const { remember } = useRecents();

  function submit(next: string, type: GroupType | "all" = active) {
    const t = next.trim();
    const sp = new URLSearchParams();
    if (t) sp.set("q", t);
    if (type !== "all") sp.set("type", type);
    if (t.length >= MIN) remember(t);
    router.replace(`${path}?${sp.toString()}`);
  }

  const groups = (q.data?.groups ?? []) as { type: GroupType; items: Hit[]; total: number; pageCount: number }[];
  const hidden = (q.data as { hidden?: Hidden } | undefined)?.hidden;
  const unavailable = new Set((hidden?.unavailableGroups ?? []).map((g) => (typeof g === "string" ? g : g.type)));
  const total = groups.reduce((n, g) => n + g.total, 0);
  const tabs = [
    { id: "all" as const, label: "All", count: active === "all" ? total : undefined },
    ...GROUPS.filter((g) => !unavailable.has(g.type)).map((g) => ({ id: g.type, label: g.label, count: groups.find((x) => x.type === g.type)?.total })),
  ];

  return (
    <div className="fb-search" data-screen-label="Search results">
      <h1 className="fb-homehead__title">Search</h1>
      <form
        role="search"
        className="fb-bigsearch"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <span className="fb-bigsearch__icon" aria-hidden="true">
          <HIcon name="search" size={18} />
        </span>
        <input
          type="search"
          aria-label="Search leads, deals, companies, contacts and tasks"
          placeholder="Search leads, deals, companies, contacts and tasks"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus={!term}
        />
      </form>
      <div className="fb-search__scope">
        <HIcon name="lock" size={14} /> Results only include records your role ({roleName}) can open.
      </div>

      {searching ? <Seg label="Kinds of result" value={active} onChange={(id) => submit(text, id)} options={tabs} /> : null}

      {!searching ? (
        <div className="fb-search__empty" role="status">
          <div className="fb-search__emptytitle">{term ? "Keep typing" : "Search everything you can open"}</div>
          <div>{term ? `Type at least ${MIN} characters.` : "Try a company name, a phone number or part of an email."}</div>
        </div>
      ) : q.isPending ? (
        <div className="fb-hstack" aria-busy="true">
          <span className="fb-sr-only" role="status">
            Searching
          </span>
          <div className="fb-hskel" style={{ height: 120 }} />
          <div className="fb-hskel" style={{ height: 120 }} />
        </div>
      ) : q.isError ? (
        describeError(q.error).kind === "noAccess" ? (
          <NoAccess area="Search" denial={describeError(q.error).denial} />
        ) : (
          <ErrorState error={q.error} area="Search" onRetry={() => void q.refetch()} />
        )
      ) : (
        <>
          {GROUPS.filter((g) => (active === "all" || active === g.type) && !unavailable.has(g.type)).map((g) => {
            const grp = groups.find((x) => x.type === g.type);
            if (!grp || grp.items.length === 0) return null;
            return (
              <section key={g.type} className="fb-hp" aria-labelledby={`sg-${g.type}`}>
                <h2 id={`sg-${g.type}`} className="fb-search__grouphead">
                  <HIcon name={g.icon} size={15} />
                  {g.label}
                  <span className="fb-search__count">{grp.total}</span>
                </h2>
                <ul className="fb-search__list">
                  {grp.items.map((r) => (
                    <li key={r.id}>
                      <a
                        href={resultHref(orgSlug, g.type, r.id)}
                        className="fb-search__hit"
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(resultHref(orgSlug, g.type, r.id));
                        }}
                      >
                        <span className="fb-search__hitmain">
                          <span className="fb-search__hittitle">{r.label}</span>
                          {r.sublabel ? <span className="fb-search__hitsub">{r.sublabel}</span> : null}
                        </span>
                        {r.archived ? <span className="fb-pill fb-pill--sm">Archived</span> : null}
                        <HIcon name="chevron-right" size={15} />
                      </a>
                    </li>
                  ))}
                </ul>
                {active === "all" && grp.total > grp.items.length ? (
                  <button type="button" className="fb-search__more" onClick={() => submit(text, g.type)}>
                    See all {grp.total} {g.label.toLowerCase()}
                  </button>
                ) : null}
                {active !== "all" && grp.pageCount > page ? (
                  <button type="button" className="fb-search__more" onClick={() => setPage((p) => p + 1)}>
                    Show the next {PAGE}
                  </button>
                ) : null}
              </section>
            );
          })}
          {[...unavailable].map((t) => {
            const g = GROUPS.find((x) => x.type === t);
            return g && (active === "all" || active === g.type) ? (
              <div key={t} className="fb-search__noaccess" role="note">
                <HIcon name="lock" size={15} />
                <span>
                  <strong>{g.label}</strong> are not part of your {roleName} workspace, so they are not searched. Ask your organisation’s Management if you need them.
                </span>
              </div>
            ) : null;
          })}
          {total === 0 ? (
            <div className="fb-search__empty" role="status">
              <div className="fb-search__emptytitle">No results for “{term}”</div>
              <div>Try a company name, a phone number or part of an email.</div>
            </div>
          ) : null}
          {hidden?.someResultsHidden && total > 0 ? (
            <div className="fb-search__scope">
              <HIcon name="info" size={14} /> Some records are left out because your role can only open {hidden.limitedToYours?.length ? `your own ${hidden.limitedToYours.join(", ")}` : "some of them"}.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
