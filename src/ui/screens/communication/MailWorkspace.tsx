"use client";

import { Forward, Inbox, Link2, Mail, PenSquare, Pencil, Reply, Search, Send, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Banner, Button } from "../../components/basics";
import { Input, Select, Textarea } from "../../components/forms";
import { ConfirmDialog, Dialog, Tabs } from "../../components/overlays";
import { EmptyState, LoadingState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { mailLinkFields, useConnection, useMailActions, useMailFolders, type DraftItem, type MailItem, type RecordRef } from "./api";
import { RecordPicker } from "./RecordPicker";

type TabId = "inbox" | "unlinked" | "sent" | "draft";

interface Compose {
  to: string;
  subject: string;
  body: string;
  record: RecordRef | null;
  replyTo?: string;
  draftId?: string;
}

const EMPTY: Compose = { to: "", subject: "", body: "", record: null };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const addresses = (to: string) => to.split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean);

/**
 * Mail (F6.22, FIG-1380) on the real API (docs/MAIL_AND_CALENDAR_SYNC.md): the organisation's logged email, the Needs-linking queue and the
 * person's own drafts, with send and reply through their connected mailbox. Everything sent is logged once on the record and in Conversations.
 * What the API gives a person (mail linked to a colleague's lead, for one) it already filters; the screen shows what it is given.
 */
export function MailWorkspace() {
  const { can, roleName } = useMember();
  const toast = useToast();
  const conn = useConnection("EMAIL", can("mail.use"));
  const { mail, loading, error, readable, refetch } = useMailFolders(can("mail.use"));
  const actions = useMailActions();
  const [tab, setTab] = useState<TabId>("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [compose, setCompose] = useState<Compose | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [provider, setProvider] = useState<"GOOGLE" | "MICROSOFT">("GOOGLE");
  const [discardId, setDiscardId] = useState<string | null>(null);

  const counts: Record<TabId, number> = { inbox: mail.inbox.length, unlinked: mail.unlinked.length, sent: mail.sent.length, draft: mail.draft.length };
  const list = useMemo(() => mail[tab].filter((m) => `${m.subject} ${m.counterparty} ${m.preview}`.toLowerCase().includes(search.toLowerCase())), [mail, tab, search]);
  const open = list.find((m) => m.id === selected) ?? null;

  if (!can("mail.use")) {
    return (
      <div className="fb-comm">
        <h1 className="fb-comm__title">Mail</h1>
        <NoAccess area="Mail" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales", "Delivery"], whoToAsk: ["Management"] }} />
      </div>
    );
  }
  if (error) return <div className="fb-comm"><h1 className="fb-comm__title">Mail</h1><QueryFailure error={error} area="Mail" onRetry={refetch} /></div>;

  const reason = !conn.ready ? "Checking your mailbox." : conn.connected ? undefined : "Connect your mailbox first, in Settings > Email and calendar or with the Connect button above.";
  const fail = (e: unknown) => toast.show({ message: describeError(e).body, tone: "danger" });

  function startReply(m: MailItem, forward = false) {
    setCompose({ to: forward ? "" : (m.email ?? ""), subject: `${forward ? "Fwd" : "Re"}: ${m.subject.replace(/^(Re|Fwd): /, "")}`, body: `\n\n---\n${m.counterparty} wrote:\n${m.preview}`, record: null, replyTo: forward ? undefined : m.id });
  }
  function editDraft(d: DraftItem) {
    setCompose({ to: d.to.join(", "), subject: d.subject, body: d.body, record: null, replyTo: d.replyToCommunicationId ?? undefined, draftId: d.id });
  }
  const payload = (c: Compose, draftOnly: boolean) => ({
    to: addresses(c.to),
    subject: c.subject,
    body: c.body,
    ...(c.replyTo ? { replyToCommunicationId: c.replyTo } : {}),
    ...mailLinkFields(c.record),
    ...(draftOnly ? {} : {}),
  });

  return (
    <div className="fb-comm">
      <div className="fb-comm__head">
        <div>
          <h1 className="fb-comm__title">Mail</h1>
          <p className="fb-comm__sub">Customer email, tied to the record it is about. What you send is logged on the timeline and in Conversations.</p>
        </div>
        <Button variant="primary" onClick={() => setCompose({ ...EMPTY })} disabledReason={reason}>
          <PenSquare size={16} aria-hidden="true" /> Compose
        </Button>
      </div>

      {conn.ready && !conn.connected ? (
        <Banner tone="warning" icon={<Mail size={16} />} title={conn.item?.state === "NEEDS_RECONNECT" ? "Your mailbox needs to be reconnected." : "Your mailbox is not connected."} action={<Button size="sm" onClick={() => setConnectOpen(true)}>Connect mailbox</Button>}>
          {conn.item?.stateReason || "You can read mail already logged for your organisation."} To send, connect Google Workspace or Microsoft 365.
        </Banner>
      ) : null}
      {conn.error ? <p className="fb-comm__note">Your mailbox status could not be read, so sending may be refused.</p> : null}
      {!readable ? <p className="fb-comm__note">Your role can write mail but not read the organisation&rsquo;s logged mail, so only your drafts are listed.</p> : null}

      <Tabs
        label="Mail folders"
        value={tab}
        onChange={(id) => { setTab(id as TabId); setSelected(null); }}
        tabs={(
          [
            ["inbox", "Inbox"],
            ["unlinked", "Needs linking"],
            ["sent", "Sent"],
            ["draft", "Drafts"],
          ] as const
        ).map(([id, label]) => ({ id, label: `${label}${counts[id] ? ` (${counts[id]})` : ""}`, panel: null }))}
      />

      <div className="fb-mail">
        <section className="fb-mail__list" aria-label="Messages">
          <label className="fb-chat__search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search mail..." aria-label="Search mail" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {loading ? (
            <LoadingState label="Loading mail" lines={3} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Inbox size={22} />} title={search ? "No messages match" : tab === "unlinked" ? "Nothing needs linking" : "Nothing here yet"} body={search ? "Try another word." : tab === "unlinked" ? "Every message is tied to a record." : "Messages will appear here."} />
          ) : (
            <ul>
              {list.map((m) => (
                <li key={m.id}>
                  <button type="button" className="fb-mail__row" aria-current={selected === m.id ? "true" : undefined} onClick={() => setSelected(m.id)}>
                    <span className="fb-mail__top"><strong>{m.folder === "inbox" ? m.counterparty : `To ${m.counterparty}`}</strong><time>{when(m.when)}</time></span>
                    <span className="fb-mail__subject">{m.subject}</span>
                    <span className="fb-mail__preview">{m.preview}</span>
                    <span className="fb-mail__badges">
                      {m.linkLabel ? <Badge tone="info">{m.linkLabel}</Badge> : m.folder === "inbox" ? <Badge tone="warning">Not linked</Badge> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fb-mail__pane" aria-label="Reading pane">
          {!open ? (
            <EmptyState icon={<Mail size={22} />} title="Select a message" body="Choose a message on the left to read it." />
          ) : (
            <>
              <header className="fb-mail__head">
                <h2>{open.subject}</h2>
                <p>
                  {open.folder === "inbox" ? <>From <strong>{open.counterparty}</strong>{open.email ? <> &lt;{open.email}&gt;</> : null}</> : <>To <strong>{open.counterparty}</strong></>} · {when(open.when)}
                </p>
              </header>
              {open.folder !== "draft" ? (
                <div className="fb-mail__link">
                  {open.linked ? (
                    <><Link2 size={14} aria-hidden="true" /> Logged on <strong>{open.linkLabel}</strong> and in Conversations</>
                  ) : (
                    <LinkPicker busy={actions.busy} onLink={(r) => actions.link(open.id, r, { onSuccess: () => { toast.show({ message: `Linked to ${r.label}. It left Needs linking.`, tone: "success" }); setSelected(null); }, onError: fail })} />
                  )}
                </div>
              ) : null}
              {open.draft?.lastError ? <Banner tone="danger" title="The last send did not go through.">{open.draft.lastError}</Banner> : null}
              <pre className="fb-mail__body">{open.draft ? open.draft.body : open.preview}</pre>
              {!open.draft ? <p className="fb-comm__note">This is the start of the message. The full text is on the record&rsquo;s timeline.</p> : null}
              <div className="fb-mail__actions">
                {open.draft ? (
                  <>
                    <Button variant="primary" disabledReason={reason} onClick={() => actions.sendDraft(open.draft!.id, { onSuccess: () => { toast.show({ message: "Sent and logged on its record.", tone: "success" }); setSelected(null); }, onError: fail })}>
                      <Send size={16} aria-hidden="true" /> Send
                    </Button>
                    <Button onClick={() => editDraft(open.draft!)}><Pencil size={16} aria-hidden="true" /> Edit</Button>
                    <Button variant="danger" onClick={() => setDiscardId(open.draft!.id)}><Trash2 size={16} aria-hidden="true" /> Discard</Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" onClick={() => startReply(open)} disabledReason={reason}><Reply size={16} aria-hidden="true" /> Reply</Button>
                    <Button onClick={() => startReply(open, true)} disabledReason={reason}><Forward size={16} aria-hidden="true" /> Forward</Button>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <ComposeDialog
        value={compose}
        busy={actions.busy}
        onClose={() => setCompose(null)}
        sendReason={reason}
        onSend={(c) =>
          actions.send(payload(c, false), {
            onSuccess: () => {
              toast.show({ message: c.record ? `Sent and logged on ${c.record.label} and in Conversations` : "Sent. It has no record yet, so it waits in Needs linking.", tone: "success" });
              if (c.draftId) actions.deleteDraft(c.draftId, {});
              setCompose(null);
            },
            onError: fail,
          })
        }
        onDraft={(c) =>
          actions.saveDraft(c.draftId, payload(c, true), {
            onSuccess: () => { toast.show({ message: "Draft saved", tone: "info" }); setCompose(null); setTab("draft"); },
            onError: fail,
          })
        }
      />
      <Dialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect your mailbox"
        actions={
          <>
            <Button onClick={() => setConnectOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => conn.connect(provider, fail)} disabledReason={conn.starting ? "Opening your provider." : undefined}>Connect</Button>
          </>
        }
      >
        <p>You will sign in with your provider. Figbloom reads mail only to and from people already in your contacts, and sends from your mailbox when you press Send. You can disconnect at any time.</p>
        <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as "GOOGLE" | "MICROSOFT")} options={[{ value: "GOOGLE", label: "Google Workspace" }, { value: "MICROSOFT", label: "Microsoft 365" }]} />
      </Dialog>
      <ConfirmDialog
        open={discardId !== null}
        onClose={() => setDiscardId(null)}
        title="Discard this draft?"
        body="The draft is deleted. This cannot be undone."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => { if (discardId) actions.deleteDraft(discardId, { onSuccess: () => setSelected(null), onError: fail }); setDiscardId(null); }}
      />
    </div>
  );
}

function LinkPicker({ onLink, busy }: { onLink: (r: RecordRef) => void; busy: boolean }) {
  const [record, setRecord] = useState<RecordRef | null>(null);
  return (
    <div className="fb-mail__picker">
      <RecordPicker label="Link to a record" value={record} onChange={setRecord} kinds={["deal", "company", "lead", "contact"]} />
      <Button onClick={() => record && onLink(record)} disabledReason={!record ? "Choose a record first." : busy ? "Linking." : undefined}>Link</Button>
    </div>
  );
}

function ComposeDialog({ value, onClose, onSend, onDraft, busy, sendReason }: { value: Compose | null; onClose: () => void; onSend: (c: Compose) => void; onDraft: (c: Compose) => void; busy: boolean; sendReason?: string }) {
  const [form, setForm] = useState<Compose>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<"to" | "subject" | "body", string>>>({});
  const [seen, setSeen] = useState<Compose | null>(null);
  if (value !== seen) {
    setSeen(value);
    if (value) {
      setForm(value);
      setErrors({});
    }
  }

  function validate(): boolean {
    const e: typeof errors = {};
    const list = addresses(form.to);
    if (list.length === 0 || list.some((a) => !/^\S+@\S+\.\S+$/.test(a))) e.to = "Enter full email addresses, for example name@company.com.";
    if (!form.subject.trim()) e.subject = "Add a subject.";
    if (!form.body.trim()) e.body = "Write a message.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  return (
    <Dialog
      open={value !== null}
      onClose={onClose}
      title={form.subject.startsWith("Re:") ? "Reply" : form.subject.startsWith("Fwd:") ? "Forward" : "New message"}
      actions={
        <>
          <Button onClick={() => onDraft(form)} disabledReason={busy ? "Saving." : form.to || form.subject || form.body.trim() ? undefined : "Write something first."}>Save draft</Button>
          <Button variant="primary" onClick={() => validate() && onSend(form)} disabledReason={sendReason ?? (busy ? "Sending." : undefined)}><Send size={16} aria-hidden="true" /> Send</Button>
        </>
      }
    >
      <div className="fb-mail__compose">
        <Input label="To" required value={form.to} error={errors.to} onChange={(e) => setForm({ ...form, to: e.target.value })} help="Separate several addresses with commas." />
        <Input label="Subject" required value={form.subject} error={errors.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <RecordPicker label="Record" value={form.record} onChange={(record) => setForm({ ...form, record })} kinds={["deal", "company", "lead", "contact"]} help="Linked mail is logged on the record's timeline and in Conversations. Without one it waits in Needs linking." />
        <Textarea label="Message" required rows={7} value={form.body} error={errors.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      </div>
    </Dialog>
  );
}
