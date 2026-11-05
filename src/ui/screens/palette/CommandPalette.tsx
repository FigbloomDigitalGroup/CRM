"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useApiQuery } from "../../data/hooks";
import { resultHref } from "../home/Search";
import { buildPaletteItems, type ApiCommand, type PaletteItem } from "./items";

type SearchType = "leads" | "companies" | "contacts" | "deals" | "tasks";
const KIND: Record<SearchType, string> = { leads: "Lead", companies: "Company", contacts: "Contact", deals: "Deal", tasks: "Task" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  orgSlug: string;
  permissionKeys: readonly string[];
  onNavigate: (href: string) => void;
  onRun: (run: NonNullable<PaletteItem["run"]>) => void;
}

/**
 * The command palette (X3, FIG-1172): Ctrl/Cmd+K. One search box over records, recent items, the actions the person may take and the pages they
 * may open. Fully keyboard operable: arrows move, Enter opens, Escape closes and focus returns to where it was. The list is a combobox
 * and listbox, so a screen reader hears the highlighted option as it moves.
 */
export function CommandPalette({ open, onClose, orgSlug, permissionKeys, onNavigate, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  // The server's index of what this role may do (only while the palette is open); records come from the same search the top bar uses.
  const cmdIndex = useApiQuery("getCommands", { params: { orgSlug } }, { enabled: open, retry: false, staleTime: 60_000 });
  const commands = (cmdIndex.data as { commands?: ApiCommand[] } | undefined)?.commands ?? null;
  const term = useDebounced(query.trim(), 200);
  const searching = open && term.length >= 2;
  const found = useApiQuery("search", { params: { orgSlug }, query: { q: term, pageSize: "3" } }, { enabled: searching, retry: false, staleTime: 15_000 });
  const records = useMemo<PaletteItem[]>(() => {
    if (!searching) return [];
    const groups = ((found.data as { groups?: { type: SearchType; items: { id: string; label: string; sublabel: string | null }[] }[] } | undefined)?.groups ?? []);
    return groups.flatMap((g) => g.items.map((h) => ({ id: `rec-${g.type}-${h.id}`, group: "RECORDS" as const, title: h.label, sub: [KIND[g.type], h.sublabel].filter(Boolean).join(" · "), href: resultHref(orgSlug, g.type, h.id) })));
  }, [found.data, searching, orgSlug]);
  const groups = useMemo(() => buildPaletteItems({ orgSlug, permissionKeys, query, commands, records }), [orgSlug, permissionKeys, query, commands, records]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    input.current?.focus();
    return () => opener?.focus?.();
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  if (!open) return null;

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    if (item.run) onRun(item.run);
    else if (item.href) onNavigate(item.href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // Focus stays in the palette: the only tab stop is the box.
      e.preventDefault();
    }
  }

  let index = -1;
  return (
    <>
      <div className="fb-pal__scrim" onClick={onClose} aria-hidden="true" />
      <div ref={root} className="fb-pal" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey} data-testid="command-palette">
        <div className="fb-pal__top">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat.length ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search records, actions and pages"
            placeholder="Search records, or type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="fb-pal__list" id={listId} role="listbox" aria-label="Results">
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.id.toLowerCase()}>
              <div className="fb-pal__group" aria-hidden="true">
                {g.id}
              </div>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={item.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="fb-pal__item"
                    data-active={i === active || undefined}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    <span className="fb-pal__title">{item.title}</span>
                    {item.sub ? <span className="fb-pal__sub">{item.sub}</span> : null}
                    {item.hint ? <kbd>{item.hint}</kbd> : null}
                  </div>
                );
              })}
            </div>
          ))}
          {searching && found.isFetching ? (
            <div className="fb-pal__empty" role="status">
              Searching…
            </div>
          ) : null}
          {searching && found.isError ? (
            <div className="fb-pal__empty" role="status">
              Records could not be searched just now. Pages and actions still work.
            </div>
          ) : null}
          {flat.length === 0 && !(searching && found.isFetching) ? (
            <div className="fb-pal__empty" role="status">
              Nothing matches. Try a company name or “new lead”.
            </div>
          ) : null}
        </div>
        <div className="fb-pal__foot" aria-hidden="true">
          <span>↑↓ move</span>
          <span>Enter open</span>
          <span>G then L · go to leads</span>
          <span>N · new lead</span>
        </div>
      </div>
    </>
  );
}
