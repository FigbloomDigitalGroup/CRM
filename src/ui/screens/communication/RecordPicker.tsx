"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "../../components/basics";
import { Input } from "../../components/forms";
import { recordKindLabel, useRecordSearch, type RecordRef } from "./api";

/** Finds a record by name through global search (which already hides what the person's role may not open) and shows the one chosen. */
export function RecordPicker({ label, value, onChange, kinds, help, error }: { label: string; value: RecordRef | null; onChange: (r: RecordRef | null) => void; kinds: RecordRef["kind"][]; help?: string; error?: string }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { results, loading, searched } = useRecordSearch(value ? "" : debounced, kinds);

  if (value) {
    return (
      <div className="fb-mail__picker" role="group" aria-label={`${label} chosen`}>
        <span>
          <Badge tone="info">{recordKindLabel(value.kind)}</Badge> {value.label}
        </span>
        <Button size="sm" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div role="group" aria-label={`${label} finder`}>
      <Input label={label} type="search" value={text} error={error} onChange={(e) => setText(e.target.value)} help={help ?? "Type at least two letters of a name."} />
      {searched ? (
        <ul className="fb-chat__list" aria-label={`${label}: matches`} aria-busy={loading}>
          {results.length === 0 && !loading ? <li className="fb-chat__none">No records match.</li> : null}
          {results.slice(0, 8).map((r) => (
            <li key={`${r.kind}${r.id}`}>
              <button type="button" className="fb-chat__item" onClick={() => { onChange(r); setText(""); }}>
                <span className="fb-chat__name">{r.label}</span>
                <span>{recordKindLabel(r.kind)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
