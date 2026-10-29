"use client";

import { AtSign, ArrowLeft, Bell, BellOff, Hash, Link2, Lock, MessagesSquare, Paperclip, Plus, Search, Send, Smile, SmilePlus, Users } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Badge, Button, IconButton } from "../../components/basics";
import { Checkbox, Input } from "../../components/forms";
import { Dialog, Menu } from "../../components/overlays";
import { EmptyState, MaskedValue, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { DEMO_CARDS, DEMO_PEOPLE, EMOJI, ME, formatKes, isLimitedMember, mentionQuery, mentionsIn, viewCard, type DemoChannel, type DemoMessage, type DemoPerson, type RecordCard } from "./demo/data";
import { chatDemo, useChat } from "./demo/store";

const personById = (id: string) => DEMO_PEOPLE.find((p) => p.id === id);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Who may see a channel: everyone for an open channel, the permission for a gated one, and for a limited member (Restricted Technical) only the channels they were added to. */
function channelVisible(c: DemoChannel, can: (key: string) => boolean): boolean {
  if (isLimitedMember(can)) return Boolean(c.addedLimited);
  return !c.requires || can(c.requires);
}

/**
 * Chat (F6.21, FIG-1379): internal team chat. Channels (public, private, and one attached to a record), direct messages, mentions, emoji, attachments
 * and record cards. A record card shows what the person LOOKING may see, not what the poster saw (hard rule 7). On demo data (`demo/`): messages live
 * in memory until B6.24 to B6.27 supply the API in M13.
 */
export function ChatWorkspace() {
  const { can, userName, orgSlug } = useMember();
  const toast = useToast();
  const { channels, messages, unread, dms } = useChat();
  const visible = useMemo(() => channels.filter((c) => channelVisible(c, can)), [channels, can]);

  const [current, setCurrent] = useState<string>("general");
  const [channelQuery, setChannelQuery] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [find, setFind] = useState("");
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [membersOpen, setMembersOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isDm = current.startsWith("dm:");
  const channel = visible.find((c) => c.id === current);
  const dmPerson = isDm ? personById(current.slice(3)) : undefined;
  const known = isDm ? Boolean(dmPerson) : Boolean(channel);

  useEffect(() => {
    if (!known && visible[0]) setCurrent(visible[0].id);
  }, [known, visible]);

  useEffect(() => {
    chatDemo.markRead(current);
  }, [current, messages.length]);

  const thread = useMemo(() => messages.filter((m) => m.channelId === current && (!find || m.text.toLowerCase().includes(find.toLowerCase()))), [messages, current, find]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread.length, current]);

  const people = useMemo(() => [{ id: ME, name: userName }, ...DEMO_PEOPLE], [userName]);
  const mentionRe = useMemo(() => new RegExp(`(@(?:${people.map((p) => escapeRe(p.name)).join("|")}))`, "g"), [people]);
  const query = mentionQuery(draft);
  const suggestions = query === null ? [] : DEMO_PEOPLE.filter((p) => p.name.toLowerCase().split(" ").some((w) => w.startsWith(query.toLowerCase()))).slice(0, 5);

  function select(id: string) {
    setCurrent(id);
    setFind("");
    setSearching(false);
    setConvOpen(true);
  }

  function send() {
    const text = draft.trim();
    if (!text && files.length === 0) return;
    chatDemo.post(current, text, { attachments: files.length ? files : undefined });
    for (const id of mentionsIn(text, DEMO_PEOPLE)) {
      // The real API notifies a mentioned person only when they may see the record the message names (B6.26); the demo says what would happen.
      if (id) toast.show({ message: `${personById(id)?.name.split(" ")[0]} was notified`, tone: "info" });
    }
    setDraft("");
    setFiles([]);
  }

  function shareCard(card: RecordCard) {
    chatDemo.post(current, `Sharing ${card.name}`, { card });
  }

  const filteredChannels = visible.filter((c) => c.name.toLowerCase().includes(channelQuery.toLowerCase()));
  const dmPeople = dms.map(personById).filter((p): p is DemoPerson => Boolean(p)).filter((p) => p.name.toLowerCase().includes(peopleQuery.toLowerCase()));
  const startable = DEMO_PEOPLE.filter((p) => !dms.includes(p.id));
  const channelUnread = filteredChannels.reduce((n, c) => n + (unread[c.id] ?? 0), 0);
  const dmUnread = dms.reduce((n, id) => n + (unread[`dm:${id}`] ?? 0), 0);

  if (visible.length === 0) {
    return (
      <div className="fb-comm">
        <h1 className="fb-comm__title">Chat</h1>
        <NoAccess area="Chat" denial={{ yourRole: "your role", ownerRoles: ["Management"], whoToAsk: ["Management"] }} />
      </div>
    );
  }

  const title = isDm ? dmPerson?.name ?? "" : channel?.name ?? "";
  const days = Array.from(new Set(thread.map((m) => m.day)));

  return (
    <div className="fb-comm" data-conv-open={convOpen ? "true" : undefined}>
      <div className="fb-comm__head">
        <h1 className="fb-comm__title">Chat</h1>
        <p className="fb-comm__sub">Talk to your team. Customer conversations stay in Conversations, and anything you send to a customer is logged there.</p>
      </div>
      <div className="fb-chat">
        <aside className="fb-chat__side" aria-label="Channels and direct messages">
          <div className="fb-chat__brand">
            <span className="fb-chat__brandicon" aria-hidden="true"><MessagesSquare size={18} /></span>
            <div>
              <strong>Team chat</strong>
              <span>Collaboration starts here</span>
            </div>
          </div>
          <div className="fb-chat__group">
            <div className="fb-chat__grouphead">
              <span>Channels</span>
              {channelUnread > 0 ? <span className="fb-chat__count" aria-label={`${channelUnread} unread`}>{channelUnread}</span> : null}
              <IconButton label="New channel" className="fb-chat__add" onClick={() => setNewOpen(true)}><Plus size={16} /></IconButton>
            </div>
            <label className="fb-chat__search">
              <Search size={14} aria-hidden="true" />
              <input type="search" placeholder="Search channels..." aria-label="Search channels" value={channelQuery} onChange={(e) => setChannelQuery(e.target.value)} />
            </label>
            <ul className="fb-chat__list">
              {filteredChannels.length === 0 ? <li className="fb-chat__none">No channels match.</li> : null}
              {filteredChannels.map((c) => (
                <li key={c.id}>
                  <button type="button" className="fb-chat__item" aria-current={current === c.id ? "true" : undefined} onClick={() => select(c.id)}>
                    <span className="fb-chat__icon" aria-hidden="true">{c.kind === "record" ? <Link2 size={14} /> : c.private ? <Lock size={14} /> : <Hash size={14} />}</span>
                    <span className="fb-chat__name">{c.name}</span>
                    {unread[c.id] ? <span className="fb-chat__count" aria-label={`${unread[c.id]} unread`}>{unread[c.id]}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="fb-chat__group">
            <div className="fb-chat__grouphead">
              <span>Direct messages</span>
              <span className="fb-chat__count" aria-label={`${dmUnread} unread`} data-zero={dmUnread === 0 ? "true" : undefined}>{dmUnread}</span>
              <Menu
                label="Start a direct message"
                triggerClassName="fb-chat__add"
                trigger={<Plus size={16} />}
                align="end"
                items={
                  startable.length
                    ? startable.map((p) => ({ key: p.id, label: `${p.name} · ${p.title}`, onSelect: () => { chatDemo.startDm(p.id); select(`dm:${p.id}`); } }))
                    : [{ key: "none", label: "You already talk to everyone", disabledReason: "Everyone in the demo team is already in your list." }]
                }
              />
            </div>
            <label className="fb-chat__search">
              <Search size={14} aria-hidden="true" />
              <input type="search" placeholder="Search people..." aria-label="Search people" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} />
            </label>
            {dmPeople.length === 0 ? (
              <p className="fb-chat__none">No direct messages. Start a conversation with the plus button.</p>
            ) : (
              <ul className="fb-chat__list">
                {dmPeople.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="fb-chat__item" aria-current={current === `dm:${p.id}` ? "true" : undefined} onClick={() => select(`dm:${p.id}`)}>
                      <span className="fb-chat__avatar"><Avatar name={p.name} size={24} /><i className="fb-chat__dot" data-presence={p.presence} aria-hidden="true" /></span>
                      <span className="fb-chat__name">{p.name}</span>
                      <span className="fb-sr-only">{p.presence}</span>
                      {unread[`dm:${p.id}`] ? <span className="fb-chat__count" aria-label={`${unread[`dm:${p.id}`]} unread`}>{unread[`dm:${p.id}`]}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="fb-chat__me">
            <span className="fb-chat__avatar"><Avatar name={userName} size={32} /><i className="fb-chat__dot" data-presence="online" aria-hidden="true" /></span>
            <div>
              <strong>{userName}</strong>
              <span>Online</span>
            </div>
          </div>
        </aside>

        <section className="fb-chat__main" aria-label={isDm ? `Conversation with ${title}` : `Channel ${title}`}>
          <header className="fb-chat__top">
            <IconButton label="Back to channels" className="fb-comm__back" onClick={() => setConvOpen(false)}><ArrowLeft size={18} /></IconButton>
            <span className="fb-chat__topicon" aria-hidden="true">{isDm ? <Avatar name={title} size={36} /> : channel?.kind === "record" ? <Link2 size={18} /> : <Hash size={18} />}</span>
            <div className="fb-chat__topmain">
              <h2>{isDm ? title : `# ${title}`}</h2>
              <p>
                {isDm
                  ? `${dmPerson?.title} · ${dmPerson?.city} · ${dmPerson?.presence}`
                  : `${channel?.members} members · ${channel?.private ? "Private channel" : "Public channel"}${channel?.record ? ` · attached to ${channel.record.kind} ${channel.record.name}` : ""}`}
              </p>
            </div>
            <div className="fb-chat__tools">
              <IconButton label={muted[current] ? "Turn notifications on" : "Mute notifications"} pressed={Boolean(muted[current])} onClick={() => { setMuted({ ...muted, [current]: !muted[current] }); toast.show({ message: muted[current] ? "Notifications on" : "Notifications muted", tone: "info" }); }}>
                {muted[current] ? <BellOff size={18} /> : <Bell size={18} />}
              </IconButton>
              <IconButton label="Search this conversation" pressed={searching} onClick={() => { setSearching(!searching); setFind(""); }}><Search size={18} /></IconButton>
              {isDm ? null : <IconButton label="Members" onClick={() => setMembersOpen(true)}><Users size={18} /></IconButton>}
            </div>
          </header>
          {searching ? (
            <div className="fb-chat__find">
              <Input label="Find in this conversation" type="search" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
            </div>
          ) : null}

          <div className="fb-chat__scroll" role="log" aria-live="polite" aria-label="Messages">
            {thread.length === 0 ? (
              <EmptyState icon={<MessagesSquare size={22} />} title={find ? "No messages match" : "No messages yet"} body={find ? "Try another word." : "Say hello. Everyone in this conversation will see it."} />
            ) : (
              days.map((day) => (
                <Fragment key={day}>
                  <div className="fb-chat__day"><span>{day}</span></div>
                  {thread.filter((m) => m.day === day).map((m) => (
                    <MessageRow key={m.id} message={m} me={userName} mentionRe={mentionRe} can={can} orgSlug={orgSlug} />
                  ))}
                </Fragment>
              ))
            )}
            <div ref={endRef} />
          </div>

          <footer className="fb-chat__composer">
            {suggestions.length ? (
              <ul className="fb-chat__suggest" aria-label="Mention suggestions">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setDraft(draft.replace(/@[A-Za-z]*$/, `@${p.name} `))}>
                      <Avatar name={p.name} size={20} /> {p.name} <span>{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {files.length ? (
              <div className="fb-chat__files">
                {files.map((f) => (
                  <span key={f} className="fb-chat__file"><Paperclip size={12} aria-hidden="true" /> {f}<button type="button" aria-label={`Remove ${f}`} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button></span>
                ))}
              </div>
            ) : null}
            <textarea
              className="fb-input fb-chat__input"
              aria-label={`Message ${isDm ? title : `#${title}`}`}
              placeholder={`Message ${isDm ? title : `#${title}`}`}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="fb-chat__actions">
              <div className="fb-chat__tools">
                <input ref={fileRef} type="file" multiple hidden aria-label="Attach files" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? []).map((f) => f.name)]); e.target.value = ""; }} />
                <IconButton label="Attach a file" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></IconButton>
                <Menu label="Add an emoji" triggerClassName="fb-iconbtn" trigger={<Smile size={18} />} items={EMOJI.map((e) => ({ key: e, label: e, onSelect: () => setDraft(`${draft}${e}`) }))} />
                <IconButton label="Mention someone" onClick={() => setDraft(`${draft}${draft && !draft.endsWith(" ") ? " " : ""}@`)}><AtSign size={18} /></IconButton>
                <Menu
                  label="Share a record"
                  triggerClassName="fb-iconbtn"
                  trigger={<Link2 size={18} />}
                  items={DEMO_CARDS.map((c) => ({ key: c.id, label: `${c.kind === "deal" ? "Deal" : "Company"}: ${c.name}`, onSelect: () => shareCard(c), disabledReason: can("companies.view") ? undefined : "You do not have access to customer records." }))}
                />
              </div>
              <Button variant="primary" onClick={send} disabledReason={!draft.trim() && files.length === 0 ? "Write a message first." : undefined}>
                <Send size={16} aria-hidden="true" /> Send
              </Button>
            </div>
          </footer>
        </section>
      </div>

      <Dialog open={membersOpen} onClose={() => setMembersOpen(false)} title={`Members of #${title}`} actions={<Button onClick={() => setMembersOpen(false)}>Close</Button>}>
        <ul className="fb-chat__members">
          {[{ id: ME, name: userName, title: "You", city: "", presence: "online" as const }, ...DEMO_PEOPLE].slice(0, Math.max(2, Math.min(channel?.members ?? 2, 7))).map((p) => (
            <li key={p.id}>
              <Avatar name={p.name} size={28} /> <strong>{p.name}</strong> <span>{p.title}</span> <Badge tone={p.presence === "online" ? "success" : "neutral"}>{p.presence}</Badge>
            </li>
          ))}
        </ul>
      </Dialog>
      <NewChannel open={newOpen} onClose={() => setNewOpen(false)} existing={channels.map((c) => c.name)} onCreate={(id) => { select(id); toast.show({ message: "Channel created", tone: "success" }); }} />
    </div>
  );
}

function MessageRow({ message, me, mentionRe, can, orgSlug }: { message: DemoMessage; me: string; mentionRe: RegExp; can: (key: string) => boolean; orgSlug: string }) {
  const author = message.authorId === ME ? { name: me, city: "" } : personById(message.authorId);
  const name = author?.name ?? "Former member";
  const mine = message.authorId === ME;
  const parts = message.text.split(mentionRe);
  return (
    <article className="fb-chat__msg" data-mine={mine ? "true" : undefined} aria-label={`${name} at ${message.time}`}>
      <Avatar name={name} size={32} />
      <div className="fb-chat__bubble">
        <div className="fb-chat__who">
          <strong>{name}</strong>
          {author && "city" in author && author.city ? <span className="fb-chat__city">{author.city}</span> : null}
          <time>{message.time}</time>
          <Menu label={`React to the message from ${name}`} triggerClassName="fb-iconbtn fb-chat__react" trigger={<SmilePlus size={14} />} align="end" items={EMOJI.map((e) => ({ key: e, label: e, onSelect: () => chatDemo.react(message.id, e) }))} />
        </div>
        {message.text ? <p>{parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="fb-chat__mention">{part}</span> : <Fragment key={i}>{part}</Fragment>))}</p> : null}
        {message.card ? <RecordCardView card={message.card} can={can} orgSlug={orgSlug} /> : null}
        {message.attachments?.length ? (
          <div className="fb-chat__files">
            {message.attachments.map((f) => <span key={f} className="fb-chat__file"><Paperclip size={12} aria-hidden="true" /> {f}</span>)}
          </div>
        ) : null}
        {Object.keys(message.reactions).length ? (
          <div className="fb-chat__reactions">
            {Object.entries(message.reactions).map(([emoji, who]) => (
              <button key={emoji} type="button" className="fb-chat__reaction" aria-pressed={who.includes(ME)} aria-label={`${emoji} ${who.length}`} onClick={() => chatDemo.react(message.id, emoji)}>
                {emoji} {who.length}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** A record shared in chat. Each figure is drawn from `viewCard`, which masks by the viewer's permissions; a person who cannot open customer records gets the explained "no access". */
function RecordCardView({ card, can, orgSlug }: { card: RecordCard; can: (key: string) => boolean; orgSlug: string }) {
  if (!can("companies.view")) {
    return (
      <div className="fb-chat__card" data-denied="true">
        <strong>Record not available</strong>
        <span>This message shares a customer record. Your role does not have access to customer records, so nothing from it is shown.</span>
      </div>
    );
  }
  const v = viewCard(card, can);
  return (
    <div className="fb-chat__card">
      <div className="fb-chat__cardhead">
        <Badge tone="info">{v.kind === "deal" ? "Deal" : "Company"}</Badge>
        <a href={`/o/${orgSlug}/${v.kind === "deal" ? "deals" : "companies"}`}>{v.name}</a>
      </div>
      <dl>
        {v.stage ? (<><dt>Stage</dt><dd>{v.stage}</dd></>) : null}
        {v.value !== undefined ? (<><dt>Value</dt><dd>{v.value === null ? <MaskedValue /> : formatKes(v.value)}</dd></>) : null}
        {v.margin !== undefined ? (<><dt>Margin</dt><dd>{v.margin === null ? <MaskedValue /> : `${v.margin}%`}</dd></>) : null}
        {v.paymentDue !== undefined ? (<><dt>Payment due</dt><dd>{v.paymentDue === null ? <MaskedValue reason="Payments are visible only to Finance and Management." /> : formatKes(v.paymentDue)}</dd></>) : null}
      </dl>
    </div>
  );
}

function NewChannel({ open, onClose, existing, onCreate }: { open: boolean; onClose: () => void; existing: string[]; onCreate: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function create() {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (clean.length < 2) return setError("Use at least two letters or numbers.");
    if (existing.includes(clean)) return setError("A channel with this name already exists.");
    const ch = chatDemo.createChannel(clean, isPrivate, description);
    setName("");
    setDescription("");
    setPrivate(false);
    setError(null);
    onClose();
    onCreate(ch.id);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New channel"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create}>Create channel</Button>
        </>
      }
    >
      <Input label="Channel name" required value={name} error={error} onChange={(e) => { setName(e.target.value); setError(null); }} help="Lower case, with dashes: for example site-visits." />
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Checkbox label="Private: only people you add can see it" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
    </Dialog>
  );
}
