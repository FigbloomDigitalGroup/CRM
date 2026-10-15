"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch } from "./icons";

interface SearchResultItem {
  id: string;
  label: string;
  sublabel: string | null;
}

interface SearchResults {
  companies: SearchResultItem[];
  contacts: SearchResultItem[];
  leads: SearchResultItem[];
  deals: SearchResultItem[];
  tasks: SearchResultItem[];
}

const EMPTY_RESULTS: SearchResults = {
  companies: [],
  contacts: [],
  leads: [],
  deals: [],
  tasks: [],
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

/**
 * `buildHref` rather than a flat `path`/id convention because Tasks has no
 * own detail page (FIG-787) -- it jumps to the Tasks list, scrolled to the
 * matching row via the `#task-{id}` anchor `TaskSection.tsx` renders on
 * each `<tr>`, instead of `/tasks/{id}` like the other three groups.
 */
const GROUPS: {
  key: keyof SearchResults;
  label: string;
  buildHref: (orgSlug: string, id: string) => string;
}[] = [
  { key: "companies", label: "Companies", buildHref: (o, id) => `/o/${o}/companies/${id}` },
  { key: "contacts", label: "Contacts", buildHref: (o, id) => `/o/${o}/contacts/${id}` },
  { key: "leads", label: "Leads", buildHref: (o, id) => `/o/${o}/leads/${id}` },
  { key: "deals", label: "Deals", buildHref: (o, id) => `/o/${o}/deals/${id}` },
  { key: "tasks", label: "Tasks", buildHref: (o, id) => `/o/${o}/tasks#task-${id}` },
];

/**
 * Top-bar global search (FIG-787): one box, grouped results across
 * companies/contacts/leads/deals. The API call (`/api/orgs/{orgSlug}/search`)
 * already enforces permissions/tenant scoping and the per-group cap -- this
 * component only owns debouncing the keystroke, the open/closed panel, and
 * keyboard navigation across the flattened result list.
 */
export function GlobalSearch({ orgSlug }: { orgSlug: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const flatResults = useMemo(
    () =>
      GROUPS.flatMap((group) =>
        results[group.key].map((item) => ({
          ...item,
          groupKey: group.key,
          href: group.buildHref(orgSlug, item.id),
        })),
      ),
    [results, orgSlug],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(EMPTY_RESULTS);
      setActiveIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      try {
        const res = await fetch(
          `/api/orgs/${orgSlug}/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok || requestId !== requestIdRef.current) return;
        const body: SearchResults = await res.json();
        setResults(body);
        setActiveIndex(-1);
      } catch {
        // Network hiccup -- leave the previous results/panel state alone.
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, orgSlug]);

  // "/" and Ctrl+K / Cmd+K jump to the search box from anywhere on the page
  // (FIG-787 AC) -- "/" is skipped while already typing into a field so it
  // doesn't hijack a "/" a user is entering into some other input/textarea.
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function openResult(item: { href: string }) {
    setOpen(false);
    window.location.href = item.href;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || flatResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flatResults.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatResults[activeIndex] ?? flatResults[0];
      if (item) openResult(item);
    }
  }

  const trimmedQuery = query.trim();
  const showPanel = open && trimmedQuery.length >= MIN_QUERY_LENGTH;
  const hasAnyResults = flatResults.length > 0;

  return (
    <div className="global-search" ref={containerRef}>
      <div className="topbar-search-box">
        <IconSearch />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search Figbloom CRM"
          aria-label="Search Figbloom CRM"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-panel"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {showPanel && (
        <div id="global-search-panel" role="listbox" className="global-search-panel">
          {!hasAnyResults ? (
            <p className="global-search-empty">No matches for &quot;{trimmedQuery}&quot;.</p>
          ) : (
            GROUPS.map((group) => {
              const items = results[group.key];
              if (items.length === 0) return null;
              return (
                <div key={group.key} className="global-search-group">
                  <div className="global-search-group-label">{group.label}</div>
                  {items.map((item) => {
                    const flatIndex = flatResults.findIndex(
                      (f) => f.groupKey === group.key && f.id === item.id,
                    );
                    const isActive = flatIndex === activeIndex;
                    return (
                      <div
                        key={item.id}
                        role="option"
                        aria-selected={isActive}
                        className={`global-search-result${isActive ? " is-active" : ""}`}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => openResult({ href: group.buildHref(orgSlug, item.id) })}
                      >
                        <span className="global-search-result-label">{item.label}</span>
                        {item.sublabel && (
                          <span className="global-search-result-sublabel">{item.sublabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
