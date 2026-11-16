"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useApi, useApiQuery, queryKeyFor } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { useMember } from "../../data/member";
import { useFormatters, useRefreshLeads } from "./data";
import { SideDrawer } from "./overlay";

interface KeyNote {
  id: string;
  authorName: string | null;
  occurredAt: string;
  text: string;
  pending?: boolean;
}
interface KeyNotesAnswer {
  canAdd: boolean;
  leads: Record<string, { total: number; notes: KeyNote[] }>;
}

/**
 * Key notes in the lead preview (FIG-1678, P2-24): the latest three notes of the lead's Conversation, newest first, and a box to add one
 * without leaving the page. It reads and writes the same record the Conversation tab uses (a NOTE activity on the lead). The read is the
 * batched `getLeadsKeyNotes`, asked for one lead only when the preview opens, so a list never makes a request per row. Text is masked by the API
 * (`textForViewer`). Saving is optimistic and rolls back with a clear message if it fails; the button locks while a save is in flight.
 */
export function KeyNotesPreview({ leadId, name, onClose }: { leadId: string; name: string; onClose: () => void }) {
  const { orgSlug, userName } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const fmt = useFormatters();
  const refresh = useRefreshLeads();
  const args = { params: { orgSlug }, query: { leadIds: leadId } };
  const q = useApiQuery("getLeadsKeyNotes", args);
  const key = queryKeyFor("getLeadsKeyNotes", args);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);

  const data = q.data as KeyNotesAnswer | undefined;
  const entry = data?.leads?.[leadId];
  const notes = entry?.notes ?? [];
  const total = entry?.total ?? 0;
  const href = `/o/${orgSlug}/leads/${leadId}#conversation`;

  async function save() {
    const body = text.trim();
    if (!body || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const before = qc.getQueryData<KeyNotesAnswer>(key);
    const temp: KeyNote = { id: `pending-${Date.now()}`, authorName: userName, occurredAt: new Date().toISOString(), text: body, pending: true };
    qc.setQueryData<KeyNotesAnswer>(key, (old) => {
      const base = old ?? { canAdd: true, leads: {} };
      const cur = base.leads[leadId] ?? { total: 0, notes: [] };
      return { ...base, leads: { ...base.leads, [leadId]: { total: cur.total + 1, notes: [temp, ...cur.notes].slice(0, 3) } } };
    });
    setText("");
    try {
      await api.call("postActivities", { params: { orgSlug }, idempotencyKey: newIdempotencyKey(), body: { type: "NOTE", subject: "Note", description: body, leadId } });
      await Promise.all([qc.invalidateQueries({ queryKey: key }), refresh()]);
    } catch (err) {
      qc.setQueryData(key, before);
      setText(body);
      setError(`We could not save the note. ${describeError(err).body}`);
    } finally {
      inFlight.current = false;
      setBusy(false);
      box.current?.focus();
    }
  }

  const denied = q.isError ? describeError(q.error) : null;
  return (
    <SideDrawer title="Key notes" subtitle={name} onClose={onClose} label="Key notes">
      {q.isPending ? (
        <p className="fb-kn-muted" aria-busy="true">
          Loading notes…
        </p>
      ) : null}
      {denied?.kind === "noAccess" ? <NoAccess area="Notes on this lead" denial={denied.denial} /> : null}
      {denied && denied.kind !== "noAccess" ? (
        <div role="alert" className="fb-kn-error">
          {denied.body}{" "}
          <button type="button" className="fb-ld-btn fb-ld-btn--sm" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          {notes.length === 0 ? (
            <div className="fb-kn-empty">
              <b>No key notes yet</b>
              <span>{data.canAdd ? "Add the first note below." : "Notes on this lead will show here."}</span>
            </div>
          ) : (
            <ul className="fb-kn-list" aria-label="Latest key notes">
              {notes.map((n) => (
                <li key={n.id} className="fb-kn-note" data-pending={n.pending || undefined}>
                  <div className="fb-kn-note__meta">
                    <b>{n.authorName ?? "Former member"}</b>
                    <span>{n.pending ? "Saving…" : fmt.when(n.occurredAt)}</span>
                  </div>
                  <p>{n.text}</p>
                </li>
              ))}
            </ul>
          )}
          <Link className="fb-kn-viewall" href={href}>
            View all{total > notes.length ? ` (${total})` : ""} in the Conversation
          </Link>
          {data.canAdd ? (
            <div className="fb-ld-field">
              <label htmlFor="fb-kn-text" className="fb-ld-label">
                Add note
              </label>
              <textarea
                id="fb-kn-text"
                ref={box}
                className="fb-ld-textarea"
                rows={3}
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void save();
                  }
                }}
                placeholder="What should the team know? Ctrl+Enter saves."
              />
              {error ? (
                <div role="alert" className="fb-kn-error">
                  {error}
                </div>
              ) : null}
              <div>
                <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={busy || !text.trim()} onClick={() => void save()}>
                  Save note
                </button>
              </div>
            </div>
          ) : (
            <div className="fb-kn-noadd" role="note">
              <b>You can read notes but not add them</b>
              <span>Your role does not include adding notes. Ask Management if you need that.</span>
            </div>
          )}
        </>
      ) : null}
    </SideDrawer>
  );
}
