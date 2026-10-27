"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useApiQuery, useMember } from "@/ui";
import { useDismiss } from "@/ui/internal";
import type { LinkType } from "./model";

export interface PickedRecord {
  type: LinkType;
  id: string;
  label: string;
}

const TYPE_OF: Record<string, LinkType> = { leads: "Lead", deals: "Deal", companies: "Company", contacts: "Contact" };

/**
 * "Linked record": search the records this person may open (the same search as the top bar, so it can never offer a record the role cannot
 * see) and pick one. Optional: a task does not need a record.
 */
export function RecordPicker({ value, onChange, label = "Linked record", help }: { value: PickedRecord | null; onChange: (record: PickedRecord | null) => void; label?: string; help?: string }) {
  const { orgSlug } = useMember();
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const inputId = useId();
  useDismiss(wrap, open, () => setOpen(false));

  useEffect(() => {
    const t = setTimeout(() => setTyped(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const search = useApiQuery("search", { params: { orgSlug }, query: { q: typed } }, { enabled: open && typed.length >= 2 });
  const options: (PickedRecord & { hint: string })[] = (search.data?.groups ?? [])
    .filter((g) => TYPE_OF[g.type])
    .flatMap((g) => g.items.map((i) => ({ type: TYPE_OF[g.type]!, id: i.id, label: i.label, hint: i.sublabel ? `${TYPE_OF[g.type]} · ${i.sublabel}` : TYPE_OF[g.type]! })));
  useEffect(() => setActive(0), [typed, open]);

  function choose(o: PickedRecord | undefined) {
    if (!o) return;
    onChange({ type: o.type, id: o.id, label: o.label });
    setText("");
    setOpen(false);
  }

  return (
    <div className="fb-field" ref={wrap}>
      <label className="fb-label" htmlFor={inputId}>{label}</label>
      {value ? (
        <div className="fb-tk-picked">
          <span className="fb-tk-picked__type">{value.type}</span>
          <span className="fb-tk-picked__name">{value.label}</span>
          <button type="button" className="fb-tk-picked__clear" aria-label={`Remove link to ${value.label}`} onClick={() => onChange(null)}>×</button>
        </div>
      ) : (
        <div className="fb-combo">
          <input
            id={inputId}
            role="combobox"
            className="fb-input"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
            placeholder="Search leads, deals, companies or contacts"
            value={text}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && open && options[active]) {
                e.preventDefault();
                choose(options[active]);
              } else if (e.key === "Escape" && open) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          {open ? (
            <ul id={listId} role="listbox" aria-label={label} className="fb-listbox">
              {typed.length < 2 ? (
                <li role="option" aria-disabled="true" aria-selected="false" className="fb-option" style={{ cursor: "default" }}>Type at least two letters</li>
              ) : search.isLoading ? (
                <li role="option" aria-disabled="true" aria-selected="false" className="fb-option" style={{ cursor: "default" }}>Searching…</li>
              ) : options.length === 0 ? (
                <li role="option" aria-disabled="true" aria-selected="false" className="fb-option" style={{ cursor: "default" }}>No matches you can open</li>
              ) : (
                options.map((o, i) => (
                  <li
                    key={`${o.type}-${o.id}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={false}
                    data-active={i === active ? "true" : undefined}
                    className="fb-option"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(o);
                    }}
                  >
                    {o.label}
                    <span className="fb-help" style={{ marginLeft: "auto" }}>{o.hint}</span>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      )}
      {help ? <span className="fb-help" role={help.startsWith("Choose") ? "alert" : undefined}>{help}</span> : null}
    </div>
  );
}
