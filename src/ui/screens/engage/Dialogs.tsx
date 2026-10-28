"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { DealModal } from "../deals/Modal";
import { contactName, leadName } from "../leads/data";
import { Icon } from "../leads/icons";
import { counterpartyOf, quickLogTarget, useDebounced, whoOf, type ConversationRow } from "./data";

/** The dialogs of the Conversations hub: link (two steps), create lead (two steps when a duplicate is suspected), dismiss, log, quick-log. */

export function useRefreshConversations() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["listConversations", "listNeedsLinking"]) void qc.invalidateQueries({ queryKey: [key] });
  };
}

function Buttons({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
        Cancel
      </button>
      {children}
    </>
  );
}

/* Link to an existing record ---------------------------------------------------------------------------------------------------- */

interface Pick {
  key: "companyId" | "contactId" | "leadId";
  id: string;
  kind: string;
  label: string;
}

export function LinkDialog({ row, onClose }: { row: ConversationRow; onClose: () => void }) {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const refresh = useRefreshConversations();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Pick | null>(null);
  const search = useDebounced(q.trim(), 250);
  const companies = useApiQuery("getCompanies", { params: { orgSlug }, query: { q: search || undefined, pageSize: "8", page: "1" } }, { enabled: can("companies.view") });
  const contacts = useApiQuery("getContacts", { params: { orgSlug }, query: { q: search || undefined, pageSize: "8", page: "1" } }, { enabled: can("contacts.view") });
  const leads = useApiQuery("listLeads", { params: { orgSlug }, query: { q: search || undefined, pageSize: 8, page: 1 } as never }, { enabled: can("leads.view.all") || can("leads.view.own") });
  const link = useApiMutation("linkConversation", {
    onSuccess: () => {
      refresh();
      toast.show({ tone: "success", message: `Linked to ${picked?.kind.toLowerCase()} ${picked?.label}. It is now on that record’s timeline.` });
      onClose();
    },
    onError: (e) => toast.show({ tone: "danger", message: describeError(e).body }),
  });

  const groups: { title: string; items: Pick[]; loading: boolean }[] = [
    {
      title: "Customers",
      loading: companies.isLoading,
      items: (companies.data?.items ?? []).map((c) => ({ key: "companyId" as const, id: c.id, kind: "Customer", label: c.name })),
    },
    {
      title: "Contacts",
      loading: contacts.isLoading,
      items: (contacts.data?.items ?? []).map((c) => ({ key: "contactId" as const, id: c.id, kind: "Contact", label: contactName(c as never) })),
    },
    {
      title: "Leads",
      loading: leads.isLoading,
      items: (leads.data?.items ?? []).map((l) => ({ key: "leadId" as const, id: l.id, kind: "Lead", label: leadName(l as never) })),
    },
  ];
  const anyFound = groups.some((g) => g.items.length > 0);
  const loading = groups.some((g) => g.loading);

  return (
    <DealModal
      title={picked ? "Link this message?" : "Link to an existing record"}
      lead={picked ? undefined : `From ${whoOf(row)}. Step 1 of 2: choose the customer, contact or lead it belongs to.`}
      onClose={onClose}
      actions={
        picked ? (
          <>
            <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={() => setPicked(null)}>
              Back
            </button>
            <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={link.isPending} onClick={() => link.mutate({ params: { orgSlug, conversationId: row.id }, body: { [picked.key]: picked.id } })}>
              Link
            </button>
          </>
        ) : (
          <Buttons onClose={onClose}>{null}</Buttons>
        )
      }
    >
      {picked ? (
        <p className="fb-en-confirm">
          Step 2 of 2. This message will appear on <strong>{picked.kind.toLowerCase()} {picked.label}</strong> and leave the Needs linking queue. A lead brings its contact and company with it.
        </p>
      ) : (
        <>
          <label className="fb-dm__field">
            <span>Search records</span>
            <input className="fb-dm__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" autoFocus />
          </label>
          <div className="fb-en-picklist" role="listbox" aria-label="Records to link to" aria-busy={loading}>
            {groups.map((g) =>
              g.items.length ? (
                <div key={g.title}>
                  <div className="fb-en-picklist__group">{g.title}</div>
                  {g.items.map((p) => (
                    <button type="button" role="option" aria-selected={false} key={`${p.key}${p.id}`} className="fb-en-picklist__opt" onClick={() => setPicked(p)}>
                      <span>{p.label}</span>
                      <span className="fb-en-muted">{p.kind}</span>
                    </button>
                  ))}
                </div>
              ) : null,
            )}
            {!loading && !anyFound ? <div className="fb-en-picklist__empty">No records match “{search}”.</div> : null}
          </div>
        </>
      )}
    </DealModal>
  );
}

/* Create a lead from a message -------------------------------------------------------------------------------------------------- */

export function CreateLeadDialog({ row, onClose }: { row: ConversationRow; onClose: () => void }) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshConversations();
  const cp = counterpartyOf(row);
  const [first, ...rest] = (cp.name ?? (cp.email ? cp.email.split("@")[0]! : "")).split(/\s+/).filter(Boolean);
  const [firstName, setFirst] = useState(first ?? "");
  const [lastName, setLast] = useState(rest.join(" "));
  const [duplicates, setDuplicates] = useState<{ id?: string; label?: string; name?: string; matchedOn?: string[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useApiMutation("createLeadFromConversation", {
    onSuccess: (res) => {
      const r = res as { created: boolean; duplicateWarning?: boolean; duplicates?: typeof duplicates };
      if (!r.created && r.duplicateWarning) {
        setDuplicates(r.duplicates ?? []);
        return;
      }
      refresh();
      toast.show({ tone: "success", message: `Lead created for ${[firstName, lastName].filter(Boolean).join(" ")}. The message is on its timeline.` });
      onClose();
    },
    onError: (e) => setError(describeError(e).body),
  });
  const go = (confirmDuplicate: boolean) => {
    setError(null);
    create.mutate({ params: { orgSlug, conversationId: row.id }, body: { firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) } });
  };

  return (
    <DealModal
      title={duplicates ? "This looks like someone you already know" : "Create a lead from this message"}
      lead={duplicates ? "Check before adding a second record for the same person." : "The sender becomes a contact and a new lead that you own. The message goes on its timeline."}
      onClose={onClose}
      actions={
        duplicates ? (
          <>
            <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={() => setDuplicates(null)}>
              Back
            </button>
            <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={create.isPending} onClick={() => go(true)}>
              Create anyway
            </button>
          </>
        ) : (
          <Buttons onClose={onClose}>
            <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={create.isPending || !firstName.trim()} onClick={() => go(false)}>
              <Icon name="user-plus" size={15} /> Create lead
            </button>
          </Buttons>
        )
      }
    >
      {duplicates ? (
        <ul className="fb-en-dups" aria-label="Possible duplicates">
          {duplicates.map((d, i) => (
            <li key={d.id ?? i}>
              <strong>{d.label ?? d.name ?? "Existing record"}</strong>
              {d.matchedOn?.length ? <span className="fb-en-muted"> · same {d.matchedOn.join(", ")}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="fb-dm__grid2">
            <label className="fb-dm__field">
              <span>First name</span>
              <input className="fb-dm__input" value={firstName} onChange={(e) => setFirst(e.target.value)} required aria-required="true" />
            </label>
            <label className="fb-dm__field">
              <span>Last name</span>
              <input className="fb-dm__input" value={lastName} onChange={(e) => setLast(e.target.value)} />
            </label>
          </div>
          <p className="fb-en-muted fb-en-small">
            {[cp.email, cp.phone].filter(Boolean).join(" · ") || "No email or phone on this message."} {row.channel === "EMAIL" ? "Source: Email." : null}
          </p>
        </>
      )}
      {error ? <p className="fb-dm__error" role="alert">{error}</p> : null}
    </DealModal>
  );
}

/* Dismiss ----------------------------------------------------------------------------------------------------------------------- */

const REASONS = ["Spam", "Newsletter", "Not for us", "Duplicate"];

export function DismissDialog({ row, onClose }: { row: ConversationRow; onClose: () => void }) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshConversations();
  const [reason, setReason] = useState("");
  const dismiss = useApiMutation("dismissConversation", {
    onSuccess: () => {
      refresh();
      toast.show({ tone: "info", message: "Dismissed. It is out of the queue." });
      onClose();
    },
    onError: (e) => toast.show({ tone: "danger", message: describeError(e).body }),
  });
  return (
    <DealModal
      title="Dismiss this message?"
      lead={`From ${whoOf(row)}. It leaves the queue and is not added to any record. The reason is kept.`}
      onClose={onClose}
      actions={
        <Buttons onClose={onClose}>
          <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={!reason.trim() || dismiss.isPending} onClick={() => dismiss.mutate({ params: { orgSlug, conversationId: row.id }, body: { reason: reason.trim() } })}>
            Dismiss
          </button>
        </Buttons>
      }
    >
      <div className="fb-dm__reasons fb-en-reasons" role="group" aria-label="Common reasons">
        {REASONS.map((r) => (
          <button type="button" key={r} className="fb-dm__reason" data-on={reason === r} aria-pressed={reason === r} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <label className="fb-dm__field">
        <span>Reason</span>
        <input className="fb-dm__input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required aria-required="true" />
      </label>
    </DealModal>
  );
}

/* Log a conversation (no record yet) -------------------------------------------------------------------------------------------- */

type LogChannel = "WHATSAPP" | "PHONE" | "EMAIL" | "MEETING" | "SMS" | "OTHER";
const LOG_CHANNELS: { value: LogChannel; label: string }[] = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "PHONE", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
  { value: "SMS", label: "Text message" },
  { value: "OTHER", label: "Other" },
];

export function LogConversationDialog({ onClose }: { onClose: () => void }) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshConversations();
  const [f, setF] = useState({ channel: "WHATSAPP" as LogChannel, direction: "INBOUND" as "INBOUND" | "OUTBOUND", name: "", phone: "", email: "", subject: "", summary: "" });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = useApiMutation("logUnlinkedConversation", {
    onSuccess: () => {
      refresh();
      toast.show({ tone: "success", message: "Logged. It waits in Needs linking until you link it to a record." });
      onClose();
    },
    onError: (e) => setError(describeError(e).body),
  });
  return (
    <DealModal
      title="Log a conversation"
      lead="For a call or chat with someone who is not in the CRM yet. Link it to a record, or turn it into a lead, afterwards."
      onClose={onClose}
      actions={
        <Buttons onClose={onClose}>
          <button
            type="button"
            className="fb-btn fb-btn--primary fb-dm__btn"
            disabled={!f.summary.trim() || save.isPending}
            onClick={() => {
              setError(null);
              save.mutate({
                params: { orgSlug },
                body: {
                  channel: f.channel,
                  direction: f.direction,
                  summary: f.summary.trim(),
                  ...(f.subject.trim() ? { subject: f.subject.trim() } : {}),
                  ...(f.name.trim() ? { counterpartyName: f.name.trim() } : {}),
                  ...(f.phone.trim() ? { counterpartyPhone: f.phone.trim() } : {}),
                  ...(f.email.trim() ? { counterpartyEmail: f.email.trim() } : {}),
                },
              });
            }}
          >
            Save conversation
          </button>
        </Buttons>
      }
    >
      <div className="fb-dm__grid2">
        <label className="fb-dm__field">
          <span>Channel</span>
          <select className="fb-dm__input" value={f.channel} onChange={(e) => set("channel", e.target.value as LogChannel)}>
            {LOG_CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="fb-dm__field">
          <span>Direction</span>
          <select className="fb-dm__input" value={f.direction} onChange={(e) => set("direction", e.target.value as "INBOUND" | "OUTBOUND")}>
            <option value="INBOUND">They contacted us</option>
            <option value="OUTBOUND">We contacted them</option>
          </select>
        </label>
      </div>
      <div className="fb-dm__grid2">
        <label className="fb-dm__field">
          <span>Name</span>
          <input className="fb-dm__input" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="fb-dm__field">
          <span>Phone</span>
          <input className="fb-dm__input" value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" />
        </label>
      </div>
      <label className="fb-dm__field">
        <span>Email</span>
        <input className="fb-dm__input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
      </label>
      <label className="fb-dm__field">
        <span>Subject</span>
        <input className="fb-dm__input" value={f.subject} onChange={(e) => set("subject", e.target.value)} />
      </label>
      <label className="fb-dm__field">
        <span>What was said</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={3} value={f.summary} onChange={(e) => set("summary", e.target.value)} required aria-required="true" />
      </label>
      {error ? <p className="fb-dm__error" role="alert">{error}</p> : null}
    </DealModal>
  );
}

/* Log the outcome of a call or WhatsApp ------------------------------------------------------------------------------------------ */

const OUTCOMES: { value: "REACHED" | "NO_ANSWER" | "LEFT_MESSAGE"; label: string }[] = [
  { value: "REACHED", label: "Reached them" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "LEFT_MESSAGE", label: "Left a message" },
];

export type LogTarget = NonNullable<ReturnType<typeof quickLogTarget>>;

/**
 * The post-call and post-WhatsApp prompt: one outcome and an optional note, saved in one request (B3.08). `chooseChannel` lets a screen that
 * is not tied to a tap on a phone link (renewals) ask which channel was used.
 */
export function QuickLogDialog({
  target,
  who,
  phone,
  channel: initial,
  chooseChannel,
  onClose,
  onDone,
}: {
  target: LogTarget | null;
  who: string;
  phone?: string | null;
  channel: "CALL" | "WHATSAPP";
  chooseChannel?: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshConversations();
  const [channel, setChannel] = useState(initial);
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["value"]>("REACHED");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const log = useApiMutation("quickLog", {
    onSuccess: () => {
      refresh();
      onDone?.();
      toast.show({ tone: "success", message: `${channel === "CALL" ? "Call" : "WhatsApp"} logged.` });
      onClose();
    },
    onError: (e) => setError(describeError(e).body),
  });
  const first = who.split(/\s+/)[0];
  return (
    <DealModal
      title={chooseChannel ? `Log contact with ${who}` : channel === "CALL" ? `How did the call with ${first} go?` : `How did the WhatsApp with ${first} go?`}
      lead="Two taps: pick the outcome and save. A note is optional."
      onClose={onClose}
      actions={
        <Buttons onClose={onClose}>
          <button
            type="button"
            className="fb-btn fb-btn--primary fb-dm__btn"
            disabled={!target || log.isPending}
            onClick={() => {
              setError(null);
              log.mutate({ params: { orgSlug }, body: { channel, outcome, ...(note.trim() ? { note: note.trim() } : {}), ...(phone ? { phoneUsed: phone } : {}), ...target! } });
            }}
          >
            Save log
          </button>
        </Buttons>
      }
    >
      {chooseChannel ? (
        <div className="fb-dm__reasons fb-en-reasons" role="radiogroup" aria-label="Channel">
          {(["CALL", "WHATSAPP"] as const).map((c) => (
            <button type="button" key={c} role="radio" aria-checked={channel === c} className="fb-dm__reason" data-on={channel === c} onClick={() => setChannel(c)}>
              {c === "CALL" ? "Call" : "WhatsApp"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="fb-dm__reasons fb-en-reasons" role="radiogroup" aria-label="Outcome">
        {OUTCOMES.map((o) => (
          <button type="button" key={o.value} role="radio" aria-checked={outcome === o.value} className="fb-dm__reason" data-on={outcome === o.value} onClick={() => setOutcome(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <label className="fb-dm__field">
        <span>Note</span>
        <textarea className="fb-dm__input fb-dm__textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {!target ? <p className="fb-dm__error">This is not linked to a record yet, so it cannot be logged against one. Link it first.</p> : null}
      {error ? <p className="fb-dm__error" role="alert">{error}</p> : null}
    </DealModal>
  );
}
