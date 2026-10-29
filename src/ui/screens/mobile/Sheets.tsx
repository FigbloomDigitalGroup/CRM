"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useToast } from "../../components/toast";
import { useAppearanceOptional } from "../../theme/ThemeProvider";
import { useApi, useApiQuery } from "../../data/hooks";
import { newIdempotencyKey } from "../../data/client";
import { connectivity } from "../../data/connectivity";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import type { IdentityInfo } from "../../shell/TopBar";
import type { LogTarget } from "../contacts/QuickLogPrompt";
import { Icon } from "../leads/icons";
import { useReference } from "../leads/data";
import { isNetworkFailure, useFieldWrite, useQueue, useSyncNow } from "./data";
import { DESKTOP_VIEW_KEY } from "./PwaClient";
import { PushToggle } from "./PushToggle";
import { ScanCard, ScannedBanner, type Scanned } from "./capture/ScanCard";
import { dismissInstall, installDismissed, installState, isIos, isStandalone } from "./pwa";
import type { QueueItem } from "./queue";

export type LogMode = "CALL" | "WHATSAPP" | "NOTE";

/* Sheet ------------------------------------------------------------------------------------------------------------------------- */

/** A bottom sheet: focus moves in, Tab stays inside, Escape and the scrim close it, and focus goes back to what opened it. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="fb-m-scrim" onClick={onClose} aria-hidden="true" />
      <div className="fb-m-sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <button type="button" className="fb-m-sheet__grab" aria-label="Close" onClick={onClose} style={{ display: "block", height: 5, border: 0, padding: 0, cursor: "pointer" }} />
        {children}
      </div>
    </>
  );
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <div className="fb-m-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="fb-m-chip" aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? null : o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const dayOffset = (days: number) => {
  const d = new Date(Date.now() + days * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Quick capture ----------------------------------------------------------------------------------------------------------------- */

interface Candidate {
  entityType: string;
  id: string;
  label: string;
  reasons?: string[];
}
type CaptureAnswer =
  | { status: "DUPLICATE_WARNING"; duplicates: Candidate[]; hiddenDuplicates?: number }
  | { status: "CREATED"; lead: { id: string } }
  | { status: "MERGED"; mergedInto: { type: string; id: string } }
  | { status: "OPENED_EXISTING"; existing: { type: string; id: string } };

/**
 * Quick capture (M1): a name is enough. Saves in one request; a likely duplicate stops it and asks (open the existing record, add to it, or
 * save anyway). With no signal the capture is kept on the phone and sent later; a duplicate found then waits in the waiting list for a choice.
 */
export function CaptureSheet({ onClose }: { onClose: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const ref = useReference();
  const { queue } = useQueue();
  const sync = useSyncNow();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Candidate[] | null>(null);
  const [scanned, setScanned] = useState<Scanned | null>(null);
  // One key per intent: a double tap or a retry after a dropped connection is the same save.
  const key = useRef(newIdempotencyKey());
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  // The API needs a way to follow up: a phone number or an email (quick capture, B4.08).
  const ready = name.trim().length > 0 && (phone.trim().length > 0 || email.trim().length > 0);
  const base = () => ({
    name: name.trim(),
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    ...(email.trim() ? { email: email.trim() } : {}),
    ...(serviceId ? { serviceId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
    ...(remind ? { followUp: { title: `Follow up with ${name.trim()}`, dueOn: dayOffset(1) } } : {}),
  });

  async function save(decision?: { duplicateDecision: "OPEN_EXISTING" | "CREATE_ANYWAY" | "MERGE"; duplicateId?: string }) {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const body = { ...base(), ...(decision ?? {}) };
    if (decision) key.current = newIdempotencyKey();
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw Object.assign(new TypeError("offline"), { name: "TypeError" });
      const res = (await api.call("quickCapture", { params: { orgSlug }, body: body as never, idempotencyKey: key.current })) as unknown as CaptureAnswer;
      if (res.status === "DUPLICATE_WARNING") {
        setDupes(res.duplicates ?? []);
        return;
      }
      if (res.status === "CREATED") {
        toast.show({ message: `${name.trim()} saved as a lead` });
        router.push(`/o/${orgSlug}/m/record/lead/${res.lead.id}`);
      } else if (res.status === "MERGED") {
        toast.show({ message: "Added to the existing record" });
        router.push(`/o/${orgSlug}/m/record/${res.mergedInto.type}/${res.mergedInto.id}`);
      } else {
        router.push(`/o/${orgSlug}/m/record/${res.existing.type}/${res.existing.id}`);
      }
      onClose();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // No signal: keep it on the phone. A duplicate decision is not taken offline (there is nothing to compare against yet).
        queue.add({ kind: "QUICK_CAPTURE", payload: body, label: `New lead: ${name.trim()}` });
        toast.show({ message: "Saved on this phone. It sends when you are back online." });
        void sync();
        onClose();
      } else {
        setError(describeError(err).body);
      }
    } finally {
      setBusy(false);
    }
  }

  const sources = ref.sources;
  return (
    <Sheet label="Quick capture" onClose={onClose}>
      <h2>Quick capture</h2>
      <p className="fb-m-sheet__sub">Name is enough. You can fill in the rest later.</p>
      <ScanCard
        onScanned={(s) => {
          // The card only fills the form. Nothing is saved until the person has checked it and presses Save lead (M4, FIG-1177).
          setName(s.fields.name);
          setPhone(s.fields.phone);
          setEmail(s.fields.email);
          setNote(s.fields.note);
          setScanned(s);
        }}
      />
      {scanned ? <ScannedBanner scanned={scanned} /> : null}
      <form
        className="fb-m-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          <span className="fb-m-label">Company or person *</span>
          <input ref={nameRef} className="fb-m-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" enterKeyHint="next" maxLength={120} />
        </label>
        <label>
          <span className="fb-m-label">Phone *</span>
          <input className="fb-m-input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254…" autoComplete="off" />
        </label>
        <label>
          <span className="fb-m-label">Email (if no phone)</span>
          <input className="fb-m-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" />
        </label>
        {ref.services.length > 0 ? (
          <label>
            <span className="fb-m-label">Service they want</span>
            <select className="fb-m-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Not sure yet</option>
              {ref.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sources.length > 0 ? (
          <div>
            <span className="fb-m-label">Where did they come from?</span>
            <Chips label="Source" options={sources.map((s) => ({ value: s.id, label: s.name }))} value={sourceId} onChange={setSourceId} />
          </div>
        ) : null}
        <label>
          <span className="fb-m-label">Note (optional)</span>
          <textarea className="fb-m-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line is fine." maxLength={2000} />
        </label>
        <div className="fb-m-chips">
          <button type="button" className="fb-m-chip" aria-pressed={remind} onClick={() => setRemind((v) => !v)}>
            Remind me to follow up tomorrow
          </button>
        </div>

        {dupes ? (
          <div className="fb-m-warn" role="alert">
            <Icon name="alert" size={15} />
            <div className="fb-m-warn__body">
              <strong>Someone like this is already in the CRM.</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {dupes.map((d) => (
                  <li key={d.id}>
                    {d.label}
                    {d.reasons?.length ? ` (${d.reasons.join(", ")})` : ""}
                  </li>
                ))}
              </ul>
              <div className="fb-m-warn__opts">
                {dupes[0] ? (
                  <>
                    <button type="button" className="fb-m-chip" onClick={() => void save({ duplicateDecision: "OPEN_EXISTING", duplicateId: dupes[0]!.id })}>
                      Open {dupes[0].label}
                    </button>
                    <button type="button" className="fb-m-chip" onClick={() => void save({ duplicateDecision: "MERGE", duplicateId: dupes[0]!.id })}>
                      Add this to them
                    </button>
                  </>
                ) : null}
                <button type="button" className="fb-m-chip" onClick={() => void save({ duplicateDecision: "CREATE_ANYWAY" })}>
                  Save as new anyway
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="fb-m-error" role="alert">
            {error}
          </div>
        ) : null}
        <button type="submit" className="fb-m-btn fb-m-btn--primary" disabled={!ready || busy} aria-disabled={!ready || busy}>
          {busy ? "Saving…" : "Save lead"}
        </button>
        {!ready ? <div className="fb-m-muted" style={{ marginTop: -6, fontSize: 12.5 }}>{!name.trim() ? "Add a name to save." : "Add a phone number or an email so someone can follow up."}</div> : null}
      </form>
    </Sheet>
  );
}

/* Log sheet --------------------------------------------------------------------------------------------------------------------- */

const OUTCOMES = [
  { value: "REACHED", label: "Reached" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "LEFT_MESSAGE", label: "Left a message" },
] as const;
const WHENS = [
  { value: 1, label: "Tomorrow" },
  { value: 3, label: "In 3 days" },
  { value: 7, label: "Next week" },
] as const;

function whoOf(t: LogTarget): Record<string, string> {
  return t.contactId ? { contactId: t.contactId } : t.leadId ? { leadId: t.leadId } : t.companyId ? { companyId: t.companyId } : t.dealId ? { dealId: t.dealId } : {};
}

/**
 * "How did the call with X go?" and "Add a note" (M2). Saved through the offline queue, so it works with no signal and never repeats.
 * Without a target (the Note action in the bar) the person first says who it is about.
 */
export function LogSheet({ target: initial, mode, onClose }: { target: LogTarget | null; mode: LogMode; onClose: () => void }) {
  const write = useFieldWrite();
  const toast = useToast();
  const [target, setTarget] = useState<LogTarget | null>(initial);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["value"] | null>(null);
  const [text, setText] = useState("");
  const [next, setNext] = useState("");
  const [when, setWhen] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!target) return <PickRecord onPick={setTarget} onClose={onClose} />;

  const isNote = mode === "NOTE";
  const kindLabel = mode === "WHATSAPP" ? "WhatsApp chat" : "call";
  const title = isNote ? `Note on ${target.name}` : `How did the ${kindLabel} with ${target.name} go?`;
  const canSave = isNote ? text.trim().length > 0 : outcome !== null;

  async function save() {
    if (!canSave || busy || !target) return;
    setBusy(true);
    setError(null);
    const who = whoOf(target);
    const followUp = next.trim() ? { title: next.trim(), dueOn: dayOffset(when) } : undefined;
    try {
      const first = isNote
        ? await write("NOTE_ADD", { ...who, text: text.trim() }, `Note on ${target.name}`)
        : await write(mode === "WHATSAPP" ? "WHATSAPP_LOG" : "CALL_LOG", { ...who, outcome, ...(text.trim() ? { note: text.trim() } : {}), ...(followUp ? { followUp } : {}) }, `${mode === "WHATSAPP" ? "WhatsApp chat" : "Call"} with ${target.name}`);
      if (first.status === "attention") {
        setError(first.item.message ?? "That could not be saved.");
        return;
      }
      // A note's next action is its own task.
      if (isNote && followUp) {
        await write("TASK_CREATE", { ...who, title: followUp.title, dueAt: `${followUp.dueOn}T09:00:00` }, `Task: ${followUp.title}`);
      }
      toast.show({ message: first.status === "queued" ? "Saved on this phone. It sends when you are back online." : isNote ? "Note saved" : `${mode === "WHATSAPP" ? "WhatsApp chat" : "Call"} with ${target.name} logged` });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p className="fb-m-sheet__sub">Log it now while you remember.</p>
      <div className="fb-m-form">
        {!isNote ? <Chips label="Outcome" options={OUTCOMES.map((o) => ({ value: o.value, label: o.label }))} value={outcome} onChange={setOutcome} /> : null}
        <label>
          <span className="fb-m-label">{isNote ? "Note" : "What was said? (optional)"}</span>
          <textarea className="fb-m-textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="One line is fine." maxLength={2000} />
        </label>
        <div className="fb-m-nextbox">
          <strong>Next action</strong>
          <input className="fb-m-input" value={next} onChange={(e) => setNext(e.target.value)} placeholder="e.g. Send the quote" aria-label="Next action" maxLength={200} />
          <div className="fb-m-whens" role="group" aria-label="When">
            {WHENS.map((w) => (
              <button key={w.value} type="button" className="fb-m-chip" aria-pressed={when === w.value} onClick={() => setWhen(w.value)}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <div className="fb-m-error" role="alert">
            {error}
          </div>
        ) : null}
        <button type="button" className="fb-m-btn fb-m-btn--primary" disabled={!canSave || busy} aria-disabled={!canSave || busy} onClick={() => void save()}>
          {busy ? "Saving…" : isNote ? "Save note" : "Save to timeline"}
        </button>
        {!canSave ? <div className="fb-m-muted" style={{ marginTop: -6, fontSize: 12.5 }}>{isNote ? "Write the note to save it." : "Pick how it went to save it."}</div> : null}
      </div>
    </Sheet>
  );
}

/** For the Note action in the bar: who is the note about? Searches the people and companies this role may see. */
function PickRecord({ onPick, onClose }: { onPick: (t: LogTarget) => void; onClose: () => void }) {
  const { orgSlug, can } = useMember();
  const [q, setQ] = useState("");
  const companies = useApiQuery("getCompanies", { params: { orgSlug }, query: { q: q || undefined, pageSize: "6", page: "1" } as never }, { enabled: can("companies.view") });
  const contacts = useApiQuery("getContacts", { params: { orgSlug }, query: { q: q || undefined, pageSize: "6", page: "1" } as never }, { enabled: can("contacts.view") });
  const cItems = ((companies.data?.items ?? []) as unknown as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name, kind: "company" as const }));
  const pItems = ((contacts.data?.items ?? []) as unknown as { id: string; firstName: string; lastName?: string | null }[]).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), kind: "contact" as const }));
  const rows = [...cItems, ...pItems];
  return (
    <Sheet label="Add a note" onClose={onClose}>
      <h2>Add a note</h2>
      <p className="fb-m-sheet__sub">Who is it about?</p>
      <div className="fb-m-form">
        <label className="fb-m-search">
          <Icon name="search" size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or company" aria-label="Search people and companies" autoFocus />
        </label>
        <div className="fb-m-list">
          {rows.map((r) => (
            <button key={`${r.kind}-${r.id}`} type="button" className="fb-m-card" onClick={() => onPick(r.kind === "company" ? { companyId: r.id, name: r.name } : { contactId: r.id, name: r.name })}>
              <span className="fb-m-card__body">
                <span className="fb-m-card__title">{r.name}</span>
                <span className="fb-m-card__meta">{r.kind === "company" ? "Company" : "Person"}</span>
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          ))}
          {rows.length === 0 && !companies.isPending && !contacts.isPending ? <div className="fb-m-empty">No one matches “{q}”.</div> : null}
        </div>
      </div>
    </Sheet>
  );
}

/* Waiting list ------------------------------------------------------------------------------------------------------------------ */

interface DupState {
  duplicates?: { id: string; label: string; entityType?: string }[];
}

/**
 * What is waiting on this phone (S3, M1): each entry, its state in plain words, and what the person can do. Conflicts are explained and never
 * overwritten: a duplicate capture asks open, add to them, or save anyway; anything else can be sent again or discarded.
 */
export function QueueSheet({ onClose }: { onClose: () => void }) {
  const { queue, items } = useQueue();
  const sync = useSyncNow();
  const router = useRouter();
  const { orgSlug } = useMember();
  const conn = useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot, connectivity.getServerSnapshot);
  const [busy, setBusy] = useState(false);

  async function syncNow() {
    setBusy(true);
    try {
      await sync();
    } finally {
      setBusy(false);
    }
  }

  function decide(item: QueueItem, decision: "OPEN_EXISTING" | "CREATE_ANYWAY" | "MERGE", id?: string, entityType?: string) {
    if (decision === "OPEN_EXISTING") {
      queue.discard(item.clientId);
      onClose();
      router.push(`/o/${orgSlug}/m/record/${(entityType ?? "lead").toLowerCase()}/${id}`);
      return;
    }
    queue.amend(item.clientId, { ...item.payload, duplicateDecision: decision, ...(id ? { duplicateId: id } : {}) });
    void sync();
  }

  return (
    <Sheet label="Waiting to sync" onClose={onClose}>
      <h2>Waiting to sync</h2>
      <p className="fb-m-sheet__sub">
        {items.length === 0 ? "Everything on this phone has been sent." : "These changes are saved on this phone. They are sent in the order you made them, and never twice."}
      </p>
      {items.length > 0 ? (
        <ul className="fb-m-q">
          {items.map((i) => {
            const dup = (i.serverState as DupState | undefined)?.duplicates?.[0];
            return (
              <li key={i.clientId}>
                <div className="fb-m-q__label">{i.label}</div>
                <div className="fb-m-q__state" data-state={i.state}>
                  {i.state === "WAITING" ? (conn.online ? "Waiting to send" : "Waiting for a connection") : i.message}
                </div>
                {i.state !== "WAITING" ? (
                  <div className="fb-m-q__acts">
                    {i.state === "CONFLICT" && i.kind === "QUICK_CAPTURE" && dup ? (
                      <>
                        <button type="button" className="fb-m-btn" onClick={() => decide(i, "OPEN_EXISTING", dup.id, dup.entityType)}>
                          Open {dup.label}
                        </button>
                        <button type="button" className="fb-m-btn" onClick={() => decide(i, "MERGE", dup.id)}>
                          Add to them
                        </button>
                        <button type="button" className="fb-m-btn" onClick={() => decide(i, "CREATE_ANYWAY")}>
                          Save as new
                        </button>
                      </>
                    ) : (
                      <button type="button" className="fb-m-btn" onClick={() => { queue.retry(i.clientId); void sync(); }}>
                        Send again
                      </button>
                    )}
                    <button type="button" className="fb-m-btn" onClick={() => queue.discard(i.clientId)}>
                      Discard
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <button type="button" className="fb-m-btn fb-m-btn--primary" disabled={!conn.online || busy || items.length === 0} aria-disabled={!conn.online || busy || items.length === 0} onClick={() => void syncNow()}>
          {busy ? "Sending…" : "Send now"}
        </button>
        {!conn.online ? <div className="fb-m-muted" style={{ marginTop: 8, fontSize: 12.5 }}>You are offline. They send on their own when you are back.</div> : null}
        <a className="fb-m-link" href={`/o/${orgSlug}/m/sync`} onClick={onClose}>
          Open the full sync queue
        </a>
      </div>
    </Sheet>
  );
}

/* Identity and More ------------------------------------------------------------------------------------------------------------- */

export function IdentitySheet({ identity, onClose }: { identity: IdentityInfo; onClose: () => void }) {
  return (
    <Sheet label="Organisation and session" onClose={onClose}>
      <div className="fb-m-who" style={{ paddingBottom: 0 }}>
        <span className="fb-m-avatar" style={{ borderRadius: 12 }} aria-hidden="true">
          <Icon name="building" size={22} />
        </span>
        <div>
          <strong>{identity.organisation}</strong>
          <span>
            {identity.roleName}
            {identity.workspaceLabel ? ` · ${identity.workspaceLabel}` : ""}
          </span>
        </div>
      </div>
      <dl className="fb-m-dl">
        <dt>Signed in</dt>
        <dd>{identity.signedInLocal ?? "This session"}</dd>
        <dt>Device</dt>
        <dd>{identity.device ?? "This phone"}</dd>
        {identity.place ? (
          <>
            <dt>Place</dt>
            <dd>{identity.place}</dd>
          </>
        ) : null}
        {identity.sessionLeft ? (
          <>
            <dt>Session</dt>
            <dd>{identity.sessionLeft}</dd>
          </>
        ) : null}
      </dl>
    </Sheet>
  );
}

export function MoreSheet({ identity, onClose, onQueue }: { identity: IdentityInfo; onClose: () => void; onQueue: () => void }) {
  const { orgSlug, userName, roleName, can, canAny } = useMember();
  const api = useApi();
  const router = useRouter();
  const appearance = useAppearanceOptional();
  const install = useSyncExternalStore(installState.subscribe, installState.getSnapshot, installState.getServerSnapshot);
  const { waiting, attention } = useQueue();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const base = `/o/${orgSlug}/m`;
  const dark = appearance?.scheme === "dark";
  const canInstall = !install.installed && !isStandalone() && (install.canPrompt || isIos());

  function go(path: string) {
    onClose();
    router.push(path);
  }

  async function signOut() {
    try {
      await api.call("logout", { params: {} });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Sheet label="Account and more" onClose={onClose}>
      <div className="fb-m-who">
        <span className="fb-m-avatar" aria-hidden="true">
          {(userName.replace(/^Dev\s+/, "")[0] ?? "?").toUpperCase()}
        </span>
        <div>
          <strong>{userName}</strong>
          <span>
            {roleName} · {identity.organisation}
          </span>
        </div>
      </div>
      {canAny("deals.view.all", "deals.view.own", "deals.view.won") ? (
        <button type="button" className="fb-m-menu" onClick={() => go(`${base}/pipeline`)}>
          <Icon name="briefcase" size={18} />
          <span className="fb-m-menu__label">{can("deals.view.won") && !can("deals.view.all") && !can("deals.view.own") ? "Won deals" : "Pipeline"}</span>
          <span className="fb-m-menu__note">read-only</span>
        </button>
      ) : null}
      <button type="button" className="fb-m-menu" onClick={() => go(`${base}/alerts`)}>
        <Icon name="bell" size={18} />
        <span className="fb-m-menu__label">Notifications</span>
      </button>
      <button type="button" className="fb-m-menu" onClick={onQueue}>
        <Icon name="clock" size={18} />
        <span className="fb-m-menu__label">Waiting to sync</span>
        <span className="fb-m-menu__note">{waiting + attention === 0 ? "all sent" : `${waiting + attention} on this phone`}</span>
      </button>
      <PushToggle />
      <button type="button" className="fb-m-menu" onClick={() => go(`/o/${orgSlug}/preferences`)}>
        <Icon name="sliders" size={18} />
        <span className="fb-m-menu__label">Preferences</span>
        <span className="fb-m-menu__note">appearance, alerts, security</span>
      </button>
      <button
        type="button"
        className="fb-m-menu"
        aria-disabled={appearance?.locked || undefined}
        onClick={() => {
          if (!appearance?.locked) appearance?.toggleScheme();
        }}
      >
        <Icon name={dark ? "sun" : "moon"} size={18} />
        <span className="fb-m-menu__label">{dark ? "Light theme" : "Dark theme"}</span>
        {appearance?.locked ? <span className="fb-m-menu__note">set by your organisation</span> : null}
      </button>
      {canInstall ? (
        <>
          <button
            type="button"
            className="fb-m-menu"
            onClick={() => {
              if (install.canPrompt) void installState.prompt().then(onClose);
              else setShowIosHelp((v) => !v);
            }}
          >
            <Icon name="smartphone" size={18} />
            <span className="fb-m-menu__label">Install app</span>
          </button>
          {showIosHelp ? <div className="fb-m-note">Tap the Share button in Safari, then “Add to Home Screen”.</div> : null}
        </>
      ) : null}
      <button
        type="button"
        className="fb-m-menu"
        onClick={() => {
          try {
            window.sessionStorage.setItem(DESKTOP_VIEW_KEY, "1");
          } catch {
            /* blocked storage: the redirect below still opens the desktop page once */
          }
          go(`/o/${orgSlug}`);
        }}
      >
        <Icon name="monitor" size={18} />
        <span className="fb-m-menu__label">Use the desktop view</span>
        <span className="fb-m-menu__note">until you close this tab</span>
      </button>
      <button type="button" className="fb-m-menu fb-m-menu--danger" onClick={() => void signOut()}>
        <Icon name="logout" size={18} />
        <span className="fb-m-menu__label">Sign out</span>
      </button>
    </Sheet>
  );
}

/** The "Add to Home Screen" card on Today (M1). Hidden once installed or dismissed. */
export function InstallCard() {
  const install = useSyncExternalStore(installState.subscribe, installState.getSnapshot, installState.getServerSnapshot);
  const [hidden, setHidden] = useState(true);
  const [help, setHelp] = useState(false);
  useEffect(() => setHidden(installDismissed() || isStandalone()), []);
  if (hidden || install.installed || !(install.canPrompt || isIos())) return null;
  return (
    <div className="fb-m-install" role="region" aria-label="Add to Home Screen">
      <span className="fb-m-install__mark" aria-hidden="true">
        <img className="fb-m-logo" src="/icons/icon-192.png" alt="" style={{ width: 22, height: 22 }} />
      </span>
      <div className="fb-m-install__text">
        <strong>Add to Home Screen</strong>
        <span>{help ? "Tap Share in Safari, then “Add to Home Screen”." : "Open Figbloom like an app"}</span>
      </div>
      <button type="button" className="fb-m-install__go" onClick={() => (install.canPrompt ? void installState.prompt() : setHelp(true))}>
        Install
      </button>
      <button
        type="button"
        className="fb-m-install__x"
        aria-label="Dismiss"
        onClick={() => {
          dismissInstall();
          setHidden(true);
        }}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}
