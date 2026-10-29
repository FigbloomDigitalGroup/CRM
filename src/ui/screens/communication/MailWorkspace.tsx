"use client";

import { Forward, Inbox, Link2, Mail, Paperclip, PenSquare, Reply, Search, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Banner, Button } from "../../components/basics";
import { Input, Select, Textarea } from "../../components/forms";
import { ConfirmDialog, Dialog, Tabs } from "../../components/overlays";
import { EmptyState, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { MAIL_RECORDS, MAIL_TEMPLATES, type DemoMail, type MailLink } from "./demo/data";
import { mailDemo, useConnection, useMail } from "./demo/store";

type TabId = "inbox" | "unlinked" | "sent" | "draft";

interface Compose {
  to: string;
  subject: string;
  body: string;
  record: string;
  files: string[];
  draftId?: string;
}

const EMPTY: Compose = { to: "", subject: "", body: "", record: "", files: [] };
const linkLabel = (l: MailLink) => `${l.kind === "deal" ? "Deal" : l.kind === "company" ? "Company" : l.kind === "lead" ? "Lead" : "Contact"}: ${l.name}`;
const recordLink = (value: string) => MAIL_RECORDS.find((r) => r.value === value)?.link ?? null;

/**
 * Mail (F6.22, FIG-1380): read and send customer email from the CRM, every message tied to a record. Anything sent is logged once on the record's
 * timeline and in Conversations (F3.04); unlinked mail waits in Needs linking. An automation may leave a draft but never sends it (hard rule 9).
 * A message linked to a colleague's lead is hidden from a person without the organisation-wide lead permission, the same rule as Conversations.
 * On demo data (`demo/`) until FIG-806, FIG-807 and FIG-1153 land in M13.
 */
export function MailWorkspace() {
  const { can, orgSlug, roleName } = useMember();
  const toast = useToast();
  const all = useMail();
  const { connected, ready, connect } = useConnection("email", orgSlug);
  const [tab, setTab] = useState<TabId>("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [compose, setCompose] = useState<Compose | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [discardId, setDiscardId] = useState<string | null>(null);

  const allowed = can("communications.create");
  const mail = useMemo(() => all.filter((m) => !m.colleagueLead || can("leads.view.all")), [all, can]);
  const hidden = all.length - mail.length;

  const inFolder = (t: TabId) => mail.filter((m) => (t === "unlinked" ? m.folder === "inbox" && !m.link : m.folder === t));
  const counts: Record<TabId, number> = { inbox: inFolder("inbox").filter((m) => m.unread).length, unlinked: inFolder("unlinked").length, sent: inFolder("sent").length, draft: inFolder("draft").length };
  const list = inFolder(tab).filter((m) => `${m.subject} ${m.from} ${m.to} ${m.body}`.toLowerCase().includes(search.toLowerCase()));
  const open = list.find((m) => m.id === selected) ?? null;

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && open.folder === "inbox") mailDemo.markRead(open.id);
  }, [open]);

  if (!allowed) {
    return (
      <div className="fb-comm">
        <h1 className="fb-comm__title">Mail</h1>
        <NoAccess area="Mail" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales", "Customer Support"], whoToAsk: ["Management"] }} />
      </div>
    );
  }

  const reason = !ready ? undefined : connected ? undefined : "Connect your mailbox first, in Settings > Email and calendar or with the Connect button above.";

  function startReply(m: DemoMail, forward = false) {
    setCompose({
      to: forward ? "" : m.fromEmail,
      subject: `${forward ? "Fwd" : "Re"}: ${m.subject.replace(/^(Re|Fwd): /, "")}`,
      body: `\n\n---\nOn ${m.day} ${m.time}, ${m.from} wrote:\n${m.body}`,
      record: MAIL_RECORDS.find((r) => m.link && r.link.name === m.link.name)?.value ?? "",
      files: [],
    });
  }

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

      {ready && !connected ? (
        <Banner tone="warning" icon={<Mail size={16} />} title="Your mailbox is not connected." action={<Button size="sm" onClick={() => setConnectOpen(true)}>Connect mailbox</Button>}>
          You can read mail already logged for your organisation. To send, connect Google Workspace or Microsoft 365 (Settings &gt; Email and calendar).
        </Banner>
      ) : null}
      {hidden > 0 ? <p className="fb-comm__note">{hidden} message{hidden === 1 ? " is" : "s are"} hidden because {hidden === 1 ? "it is" : "they are"} linked to a colleague&rsquo;s lead you cannot open.</p> : null}

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
        <section className="fb-mail__list" aria-label="Messages" ref={listRef}>
          <label className="fb-chat__search">
            <Search size={14} aria-hidden="true" />
            <input type="search" placeholder="Search mail..." aria-label="Search mail" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {list.length === 0 ? (
            <EmptyState icon={<Inbox size={22} />} title={search ? "No messages match" : tab === "unlinked" ? "Nothing needs linking" : "Nothing here yet"} body={search ? "Try another word." : tab === "unlinked" ? "Every message is tied to a record." : "Messages will appear here."} />
          ) : (
            <ul>
              {list.map((m) => (
                <li key={m.id}>
                  <button type="button" className="fb-mail__row" aria-current={selected === m.id ? "true" : undefined} data-unread={m.unread ? "true" : undefined} onClick={() => setSelected(m.id)}>
                    <span className="fb-mail__top"><strong>{m.folder === "inbox" ? m.from : `To ${m.to}`}</strong><time>{m.day} {m.time}</time></span>
                    <span className="fb-mail__subject">{m.subject}</span>
                    <span className="fb-mail__preview">{m.body.split("\n").find((l) => l.trim()) ?? ""}</span>
                    <span className="fb-mail__badges">
                      {m.link ? <Badge tone="info">{linkLabel(m.link)}</Badge> : m.folder === "inbox" ? <Badge tone="warning">Not linked</Badge> : null}
                      {m.byAutomation ? <Badge tone="purple">Automation draft</Badge> : null}
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
                  {open.folder === "inbox" ? <>From <strong>{open.from}</strong> &lt;{open.fromEmail}&gt;</> : <>To <strong>{open.to}</strong></>} · {open.day} {open.time}
                </p>
              </header>
              {open.byAutomation ? <Banner tone="info" title="Drafted by an automation.">It is not sent until you review it and press Send.</Banner> : null}
              <div className="fb-mail__link">
                {open.link ? (
                  <><Link2 size={14} aria-hidden="true" /> Logged on <strong>{linkLabel(open.link)}</strong> and in Conversations</>
                ) : (
                  <LinkPicker onLink={(link) => { mailDemo.link(open.id, link); toast.show({ message: `Linked to ${linkLabel(link)}. It left Needs linking.`, tone: "success" }); }} />
                )}
              </div>
              <pre className="fb-mail__body">{open.body}</pre>
              <div className="fb-mail__actions">
                {open.folder === "draft" ? (
                  <>
                    <Button variant="primary" disabledReason={reason} onClick={() => { mailDemo.sendDraft(open.id); toast.show({ message: open.link ? `Sent and logged on ${linkLabel(open.link)}` : "Sent. It has no record yet.", tone: "success" }); setSelected(null); }}>
                      <Send size={16} aria-hidden="true" /> Send
                    </Button>
                    <Button variant="danger" onClick={() => setDiscardId(open.id)}><Trash2 size={16} aria-hidden="true" /> Discard</Button>
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
        onClose={() => setCompose(null)}
        onSend={(c) => {
          const link = recordLink(c.record);
          mailDemo.send({ to: c.to, subject: c.subject, body: c.body, link });
          toast.show({ message: link ? `Sent and logged on ${linkLabel(link)} and in Conversations` : "Sent. It has no record yet, so it waits in Needs linking.", tone: "success" });
          setCompose(null);
        }}
        onDraft={(c) => {
          mailDemo.saveDraft({ to: c.to, subject: c.subject, body: c.body, link: recordLink(c.record) });
          toast.show({ message: "Draft saved", tone: "info" });
          setCompose(null);
          setTab("draft");
        }}
      />
      <ConfirmDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect your mailbox"
        body="You will sign in with your provider. Figbloom reads mail only to and from people already in your contacts, and sends from your mailbox when you press Send. You can disconnect at any time. (Demo: nothing leaves this device.)"
        confirmLabel="Connect"
        onConfirm={() => { connect(); setConnectOpen(false); toast.show({ message: "Mailbox connected", tone: "success" }); }}
      />
      <ConfirmDialog
        open={discardId !== null}
        onClose={() => setDiscardId(null)}
        title="Discard this draft?"
        body="The draft is deleted. This cannot be undone."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => { if (discardId) mailDemo.discardDraft(discardId); setDiscardId(null); setSelected(null); }}
      />
    </div>
  );
}

function LinkPicker({ onLink }: { onLink: (link: MailLink) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="fb-mail__picker">
      <Select label="Link to a record" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Choose a record" options={MAIL_RECORDS.map((r) => ({ value: r.value, label: r.label }))} />
      <Button onClick={() => { const l = recordLink(value); if (l) onLink(l); }} disabledReason={value ? undefined : "Choose a record first."}>Link</Button>
    </div>
  );
}

function ComposeDialog({ value, onClose, onSend, onDraft }: { value: Compose | null; onClose: () => void; onSend: (c: Compose) => void; onDraft: (c: Compose) => void }) {
  const [form, setForm] = useState<Compose>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<"to" | "subject" | "body", string>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value) {
      setForm(value);
      setErrors({});
    }
  }, [value]);

  function validate(): boolean {
    const e: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(form.to.trim())) e.to = "Enter a full email address, for example name@company.com.";
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
          <Button onClick={() => onDraft(form)} disabledReason={form.to || form.subject || form.body.trim() ? undefined : "Write something first."}>Save draft</Button>
          <Button variant="primary" onClick={() => validate() && onSend(form)}><Send size={16} aria-hidden="true" /> Send</Button>
        </>
      }
    >
      <div className="fb-mail__compose">
        <Select
          label="Template"
          value=""
          placeholder="Start from a template (optional)"
          onChange={(e) => {
            const t = MAIL_TEMPLATES.find((x) => x.id === e.target.value);
            if (t) setForm({ ...form, subject: form.subject || t.subject, body: t.body });
          }}
          options={MAIL_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
        />
        <Input label="To" required type="email" value={form.to} error={errors.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        <Input label="Subject" required value={form.subject} error={errors.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <Select label="Record" value={form.record} onChange={(e) => setForm({ ...form, record: e.target.value })} placeholder="No record yet (goes to Needs linking)" options={MAIL_RECORDS.map((r) => ({ value: r.value, label: r.label }))} help="Linked mail is logged on the record's timeline and in Conversations." />
        <Textarea label="Message" required rows={7} value={form.body} error={errors.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <div className="fb-chat__files">
          {form.files.map((f) => <span key={f} className="fb-chat__file"><Paperclip size={12} aria-hidden="true" /> {f}<button type="button" aria-label={`Remove ${f}`} onClick={() => setForm({ ...form, files: form.files.filter((x) => x !== f) })}>×</button></span>)}
          <input ref={fileRef} type="file" multiple hidden aria-label="Attach files" onChange={(e) => { setForm({ ...form, files: [...form.files, ...Array.from(e.target.files ?? []).map((f) => f.name)] }); e.target.value = ""; }} />
          <Button size="sm" onClick={() => fileRef.current?.click()}><Paperclip size={14} aria-hidden="true" /> Attach</Button>
        </div>
      </div>
    </Dialog>
  );
}
