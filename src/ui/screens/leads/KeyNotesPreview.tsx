"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery, queryKeyFor } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { useMember } from "../../data/member";
import { useFormatters, useRefreshLeads } from "./data";
import { SideDrawer } from "./overlay";

const LOG_CHANNELS = [
  { value: "CALL", label: "Call" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
  { value: "OTHER", label: "Other" },
] as const;

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
  const toast = useToast();
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

  // Log a conversation (call, WhatsApp, email, meeting) against this lead without leaving the page. It is the same activity record the
  // Conversations page lists, so it shows there at once.
  const [logOpen, setLogOpen] = useState(false);
  const [channel, setChannel] = useState<(typeof LOG_CHANNELS)[number]["value"]>("CALL");
  const [summary, setSummary] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const logInFlight = useRef(false);

  async function saveLog() {
    const body = summary.trim();
    if (!body || logInFlight.current) return;
    logInFlight.current = true;
    setLogBusy(true);
    setLogError(null);
    const label = LOG_CHANNELS.find((c) => c.value === channel)?.label ?? "Conversation";
    try {
      await api.call("postActivities", { params: { orgSlug }, idempotencyKey: newIdempotencyKey(), body: { type: channel, subject: label, description: body, leadId } });
      for (const k of ["listConversations", "listNeedsLinking"]) void qc.invalidateQueries({ queryKey: [k] });
      await Promise.all([qc.invalidateQueries({ queryKey: key }), refresh()]);
      toast.show({ tone: "success", message: `${label} logged.` });
      setSummary("");
      setLogOpen(false);
    } catch (err) {
      setLogError(`We could not log the conversation. ${describeError(err).body}`);
    } finally {
      logInFlight.current = false;
      setLogBusy(false);
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
              <hr className="fb-kn-sep" />
              {!logOpen ? (
                <div>
                  <button type="button" className="fb-ld-btn" onClick={() => setLogOpen(true)}>
                    Log a conversation
                  </button>
                </div>
              ) : (
                <div className="fb-kn-log" role="group" aria-label="Log a conversation">
                  <label htmlFor="fb-kn-channel" className="fb-ld-label">
                    Log a conversation
                  </label>
                  <select id="fb-kn-channel" className="fb-ld-select" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
                    {LOG_CHANNELS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="fb-ld-textarea"
                    rows={3}
                    value={summary}
                    maxLength={4000}
                    aria-label="What was said"
                    onChange={(e) => setSummary(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void saveLog();
                      }
                    }}
                    placeholder="What was said? Ctrl+Enter saves."
                  />
                  {logError ? (
                    <div role="alert" className="fb-kn-error">
                      {logError}
                    </div>
                  ) : null}
                  <div className="fb-kn-log__actions">
                    <button type="button" className="fb-ld-btn fb-ld-btn--primary" disabled={logBusy || !summary.trim()} onClick={() => void saveLog()}>
                      Save conversation
                    </button>
                    <button type="button" className="fb-ld-btn" disabled={logBusy} onClick={() => setLogOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
