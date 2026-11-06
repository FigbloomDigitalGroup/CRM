"use client";

import { ArrowLeft, AtSign, Hash, Link2, Lock, MessagesSquare, Paperclip, Plus, Search, Send, Smile, SmilePlus, Trash2, Users } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Badge, Banner, Button, IconButton } from "../../components/basics";
import { Checkbox, Input } from "../../components/forms";
import { Dialog, Menu } from "../../components/overlays";
import { EmptyState, LoadingState, MaskedValue, NoAccess } from "../../components/states";
import { useToast } from "../../components/toast";
import { newIdempotencyKey, putSignedUpload } from "../../data/client";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { EMOJI, channelTitle, formatKes, mentionQuery, mentionsIn, useChannelMembers, useChannels, useChatActions, useMessages, usePeople, type CardView, type ChannelItem, type MessageItem, type PersonItem, type RecordRef } from "./api";
import { RecordPicker } from "./RecordPicker";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dayOf = (iso: string) => {
  const d = new Date(iso);
  const key = (x: Date) => x.toDateString();
  if (key(d) === key(new Date())) return "Today";
  if (key(d) === key(new Date(Date.now() - 86_400_000))) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * Chat (F6.21, FIG-1379): internal team chat on the real API (docs/COMMUNICATION.md). Channels (public, private, one attached to a record), direct
 * messages, mentions, emoji, files and record cards. Who may see a channel, and what a record card shows, is decided by the API for the person
 * looking (hard rule 7); the screen draws what it is given. The screen polls for new messages and unread counts.
 */
export function ChatWorkspace() {
  const { can, userName, orgSlug } = useMember();
  const toast = useToast();
  const api = useApi();
  const { channels, isLoading, error, refetch } = useChannels(can("chat.view"));
  const { people } = usePeople(can("chat.view"));

  const [current, setCurrent] = useState<string | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [find, setFind] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const marked = useRef<Record<string, number>>({});

  const rooms = useMemo(() => channels.filter((c) => c.kind !== "DIRECT" && !c.archived), [channels]);
  const dms = useMemo(() => channels.filter((c) => c.kind === "DIRECT"), [channels]);
  const channel = channels.find((c) => c.id === current) ?? null;

  useEffect(() => {
    if (!channel && (rooms[0] ?? dms[0])) setCurrent((rooms[0] ?? dms[0])!.id);
  }, [channel, rooms, dms]);

  const actions = useChatActions(current);
  const { messages, error: messagesError } = useMessages(channel ? channel.id : null);

  useEffect(() => {
    if (channel?.joined && channel.unread > 0 && (marked.current[channel.id] ?? -1) < channel.lastSeq) {
      marked.current[channel.id] = channel.lastSeq;
      actions.markRead(channel.lastSeq);
    }
  }, [channel?.id, channel?.unread, channel?.lastSeq, channel?.joined]);

  const thread = useMemo(() => messages.filter((m) => !find || (m.body ?? "").toLowerCase().includes(find.toLowerCase())), [messages, find]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread.length, current]);

  const everyone = useMemo(() => people, [people]);
  const mentionRe = useMemo(() => (everyone.length ? new RegExp(`(@(?:${everyone.map((p) => escapeRe(p.name)).join("|")}))`, "g") : null), [everyone]);
  const query = mentionQuery(draft);
  const suggestions = query === null ? [] : everyone.filter((p) => !p.you && p.name.toLowerCase().split(" ").some((w) => w.startsWith(query.toLowerCase()))).slice(0, 5);

  function select(id: string) {
    setCurrent(id);
    setFind("");
    setSearching(false);
    setConvOpen(true);
  }

  async function uploadAll(): Promise<string[]> {
    const ids: string[] = [];
    for (const f of files) {
      const started = (await api.call("createFileUpload", { params: { orgSlug }, body: { purpose: "ATTACHMENT", name: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size } as never, idempotencyKey: newIdempotencyKey() })) as unknown as { file: { id: string }; upload: { url: string; method?: string; headers?: Record<string, string> } };
      await putSignedUpload(started.upload, f);
      await api.call("completeFileUpload", { params: { orgSlug, fileId: started.file.id }, idempotencyKey: newIdempotencyKey() } as never);
      ids.push(started.file.id);
    }
    return ids;
  }

  async function send() {
    const text = draft.trim();
    if ((!text && files.length === 0) || !channel || uploading) return;
    try {
      setUploading(true);
      const fileIds = files.length ? await uploadAll() : undefined;
      const mentions = mentionsIn(text, everyone);
      actions.post({ body: text || undefined, mentions: mentions.length ? mentions : undefined, fileIds }, {
        onSuccess: () => {
          setDraft("");
          setFiles([]);
        },
        onError: (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
      });
    } catch (e) {
      toast.show({ message: `The file was not sent. ${describeError(e).body}`, tone: "danger" });
    } finally {
      setUploading(false);
    }
  }

  function shareCard(r: RecordRef) {
    if (r.kind === "contact") return;
    actions.post({ body: `Sharing ${r.label}`, card: { type: r.kind.toUpperCase() as CardView["type"], id: r.id } }, { onError: (e) => toast.show({ message: describeError(e).body, tone: "danger" }) });
    setShareOpen(false);
  }

  async function openAttachment(m: MessageItem, fileId: string) {
    try {
      const r = (await api.call("getChatChannelsByChannelIdMessagesByMessageIdAttachmentsByFileId", { params: { orgSlug, channelId: m.channelId, messageId: m.id, fileId } })) as { download?: { url: string } };
      if (r.download?.url) window.open(r.download.url, "_blank", "noopener");
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
    }
  }

  const filteredRooms = rooms.filter((c) => channelTitle(c).toLowerCase().includes(channelQuery.toLowerCase()));
  const dmList = dms.filter((c) => channelTitle(c).toLowerCase().includes(peopleQuery.toLowerCase()));
  const dmPartners = new Set(dms.map((d) => d.partner?.membershipId));
  const startable = people.filter((p) => !p.you && !dmPartners.has(p.membershipId));
  const presenceOf = (id: string | undefined) => people.find((p) => p.membershipId === id)?.presence ?? "OFFLINE";
  const roomUnread = filteredRooms.reduce((n, c) => n + c.unread, 0);
  const dmUnread = dms.reduce((n, c) => n + c.unread, 0);

  function startDm(p: PersonItem) {
    actions.create({ kind: "DIRECT", memberIds: [p.membershipId] }, { onSuccess: (c) => select(c.id), onError: (e) => toast.show({ message: describeError(e).body, tone: "danger" }) });
  }

  if (!can("chat.view")) {
    return (
      <div className="fb-comm">
        <h1 className="fb-comm__title">Chat</h1>
        <NoAccess area="Chat" denial={{ yourRole: null, ownerRoles: ["Management", "Sales", "Delivery", "Finance"], whoToAsk: ["Management"] }} />
      </div>
    );
  }
  if (isLoading) return <div className="fb-comm"><h1 className="fb-comm__title">Chat</h1><LoadingState label="Loading chat" /></div>;
  if (error) return <div className="fb-comm"><h1 className="fb-comm__title">Chat</h1><QueryFailure error={error} area="Chat" onRetry={() => void refetch()} /></div>;

  const isDm = channel?.kind === "DIRECT";
  const title = channel ? channelTitle(channel) : "";
  const days = Array.from(new Set(thread.map((m) => dayOf(m.createdAt))));
  const canPost = can("chat.post") && Boolean(channel?.joined);

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
              {roomUnread > 0 ? <span className="fb-chat__count" aria-label={`${roomUnread} unread`}>{roomUnread}</span> : null}
              <IconButton label="New channel" className="fb-chat__add" onClick={() => setNewOpen(true)}><Plus size={16} /></IconButton>
            </div>
            <label className="fb-chat__search">
              <Search size={14} aria-hidden="true" />
              <input type="search" placeholder="Search channels..." aria-label="Search channels" value={channelQuery} onChange={(e) => setChannelQuery(e.target.value)} />
            </label>
            <ul className="fb-chat__list">
              {filteredRooms.length === 0 ? <li className="fb-chat__none">{rooms.length === 0 ? "No channels yet. Create the first one with the plus button." : "No channels match."}</li> : null}
              {filteredRooms.map((c) => (
                <li key={c.id}>
                  <button type="button" className="fb-chat__item" aria-current={current === c.id ? "true" : undefined} onClick={() => select(c.id)}>
                    <span className="fb-chat__icon" aria-hidden="true">{c.kind === "RECORD" ? <Link2 size={14} /> : c.private ? <Lock size={14} /> : <Hash size={14} />}</span>
                    <span className="fb-chat__name">{channelTitle(c)}</span>
                    {c.unread ? <span className="fb-chat__count" aria-label={`${c.unread} unread`}>{c.unread}</span> : null}
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
                    ? startable.map((p) => ({ key: p.membershipId, label: `${p.name} · ${p.roleName}`, onSelect: () => startDm(p), disabledReason: can("chat.post") ? undefined : "Your role can read chat but not post." }))
                    : [{ key: "none", label: "You already talk to everyone", disabledReason: "Everyone in your organisation is already in your list." }]
                }
              />
            </div>
            <label className="fb-chat__search">
              <Search size={14} aria-hidden="true" />
              <input type="search" placeholder="Search people..." aria-label="Search people" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} />
            </label>
            {dmList.length === 0 ? (
              <p className="fb-chat__none">No direct messages. Start a conversation with the plus button.</p>
            ) : (
              <ul className="fb-chat__list">
                {dmList.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="fb-chat__item" aria-current={current === c.id ? "true" : undefined} onClick={() => select(c.id)}>
                      <span className="fb-chat__avatar"><Avatar name={channelTitle(c)} size={24} /><i className="fb-chat__dot" data-presence={presenceOf(c.partner?.membershipId).toLowerCase()} aria-hidden="true" /></span>
                      <span className="fb-chat__name">{channelTitle(c)}</span>
                      <span className="fb-sr-only">{presenceOf(c.partner?.membershipId).toLowerCase()}</span>
                      {c.unread ? <span className="fb-chat__count" aria-label={`${c.unread} unread`}>{c.unread}</span> : null}
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
          {!channel ? (
            <EmptyState icon={<MessagesSquare size={22} />} title="No conversation selected" body="Create a channel or start a direct message to begin." />
          ) : (
            <>
              <header className="fb-chat__top">
                <IconButton label="Back to channels" className="fb-comm__back" onClick={() => setConvOpen(false)}><ArrowLeft size={18} /></IconButton>
                <span className="fb-chat__topicon" aria-hidden="true">{isDm ? <Avatar name={title} size={36} /> : channel.kind === "RECORD" ? <Link2 size={18} /> : <Hash size={18} />}</span>
                <div className="fb-chat__topmain">
                  <h2>{isDm ? title : `# ${title}`}</h2>
                  <p>
                    {isDm
                      ? presenceOf(channel.partner?.membershipId).toLowerCase()
                      : `${channel.memberCount} members · ${channel.private ? "Private channel" : "Public channel"}${channel.record ? ` · attached to ${channel.record.type.toLowerCase()}` : ""}`}
                  </p>
                </div>
                <div className="fb-chat__tools">
                  <IconButton label="Search this conversation" pressed={searching} onClick={() => { setSearching(!searching); setFind(""); }}><Search size={18} /></IconButton>
                  {isDm ? null : <IconButton label="Members" onClick={() => setMembersOpen(true)}><Users size={18} /></IconButton>}
                </div>
              </header>
              {searching ? (
                <div className="fb-chat__find">
                  <Input label="Find in this conversation" type="search" value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
                </div>
              ) : null}
              {!channel.joined && !isDm ? (
                <Banner tone="info" title="You are not in this channel." action={<Button size="sm" onClick={actions.join} disabledReason={can("chat.post") ? undefined : "Your role can read chat but not post."}>Join channel</Button>}>
                  You can read it, but you need to join to post.
                </Banner>
              ) : null}

              <div className="fb-chat__scroll" role="log" aria-live="polite" aria-label="Messages">
                {messagesError ? (
                  <QueryFailure error={messagesError} area="This conversation" />
                ) : thread.length === 0 ? (
                  <EmptyState icon={<MessagesSquare size={22} />} title={find ? "No messages match" : "No messages yet"} body={find ? "Try another word." : "Say hello. Everyone in this conversation will see it."} />
                ) : (
                  days.map((day) => (
                    <Fragment key={day}>
                      <div className="fb-chat__day"><span>{day}</span></div>
                      {thread.filter((m) => dayOf(m.createdAt) === day).map((m) => (
                        <MessageRow key={m.id} message={m} mentionRe={mentionRe} orgSlug={orgSlug} canReact={canPost} onReact={(e, mine) => actions.toggleReaction(m.id, e, mine)} onDelete={() => actions.deleteMessage(m.id)} onOpenFile={(f) => void openAttachment(m, f)} />
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
                      <li key={p.membershipId}>
                        <button type="button" onClick={() => setDraft(draft.replace(/@[A-Za-z]*$/, `@${p.name} `))}>
                          <Avatar name={p.name} size={20} /> {p.name} <span>{p.roleName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {files.length ? (
                  <div className="fb-chat__files">
                    {files.map((f, i) => (
                      <span key={`${f.name}${i}`} className="fb-chat__file"><Paperclip size={12} aria-hidden="true" /> {f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>
                    ))}
                  </div>
                ) : null}
                <textarea
                  className="fb-input fb-chat__input"
                  aria-label={`Message ${isDm ? title : `#${title}`}`}
                  placeholder={canPost ? `Message ${isDm ? title : `#${title}`}` : "Join this channel to write a message."}
                  rows={2}
                  disabled={!canPost}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="fb-chat__actions">
                  <div className="fb-chat__tools">
                    <input ref={fileRef} type="file" multiple hidden aria-label="Attach files" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 10)); e.target.value = ""; }} />
                    <IconButton label="Attach a file" onClick={() => fileRef.current?.click()} disabled={!canPost}><Paperclip size={18} /></IconButton>
                    <Menu label="Add an emoji" triggerClassName="fb-iconbtn" trigger={<Smile size={18} />} items={EMOJI.map((e) => ({ key: e, label: e, onSelect: () => setDraft(`${draft}${e}`) }))} />
                    <IconButton label="Mention someone" onClick={() => setDraft(`${draft}${draft && !draft.endsWith(" ") ? " " : ""}@`)} disabled={!canPost}><AtSign size={18} /></IconButton>
                    <IconButton label="Share a record" onClick={() => setShareOpen(true)} disabled={!canPost}><Link2 size={18} /></IconButton>
                  </div>
                  <Button variant="primary" onClick={() => void send()} disabledReason={!canPost ? "Join this channel first." : !draft.trim() && files.length === 0 ? "Write a message first." : undefined}>
                    <Send size={16} aria-hidden="true" /> {uploading || actions.posting ? "Sending" : "Send"}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>

      <MembersDialog open={membersOpen} onClose={() => setMembersOpen(false)} title={title} channelId={current} />
      <Dialog open={shareOpen} onClose={() => setShareOpen(false)} title="Share a record" actions={<Button onClick={() => setShareOpen(false)}>Cancel</Button>}>
        <RecordPicker label="Record" value={null} onChange={(r) => r && shareCard(r)} kinds={["deal", "company", "lead"]} help="The card shows each person only what their role may see." />
      </Dialog>
      <NewChannel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        disabledReason={can("chat.channels.manage") || can("chat.post") ? undefined : "Your role cannot create channels."}
        onCreate={(body, h) => actions.create(body, { onSuccess: (c: ChannelItem) => { select(c.id); toast.show({ message: "Channel created", tone: "success" }); h.ok(); }, onError: (e) => h.fail(describeError(e).body) })}
      />
    </div>
  );
}

function MembersDialog({ open, onClose, title, channelId }: { open: boolean; onClose: () => void; title: string; channelId: string | null }) {
  const { members, isLoading, error } = useChannelMembers(channelId, open);
  return (
    <Dialog open={open} onClose={onClose} title={`Members of #${title}`} actions={<Button onClick={onClose}>Close</Button>}>
      {isLoading ? <LoadingState label="Loading members" lines={2} /> : error ? <QueryFailure error={error} area="Members" /> : (
        <ul className="fb-chat__members">
          {members.map((p) => (
            <li key={p.membershipId}>
              <Avatar name={p.name} size={28} /> <strong>{p.name}</strong> <span>{p.role === "OWNER" ? "Owner" : "Member"}</span> <Badge tone={p.presence === "ONLINE" ? "success" : "neutral"}>{p.presence.toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function MessageRow({ message, mentionRe, orgSlug, canReact, onReact, onDelete, onOpenFile }: { message: MessageItem; mentionRe: RegExp | null; orgSlug: string; canReact: boolean; onReact: (emoji: string, mine: boolean) => void; onDelete: () => void; onOpenFile: (fileId: string) => void }) {
  const name = message.authorName ?? "Former member";
  const time = timeOf(message.createdAt);
  if (message.deleted || message.erased) {
    return <article className="fb-chat__msg" aria-label={`${name} at ${time}`}><Avatar name={name} size={32} /><div className="fb-chat__bubble"><p><em>{message.erased ? "This message was removed." : "This message was deleted."}</em></p></div></article>;
  }
  const parts = mentionRe && message.body ? message.body.split(mentionRe) : [message.body ?? ""];
  return (
    <article className="fb-chat__msg" aria-label={`${name} at ${time}`}>
      <Avatar name={name} size={32} />
      <div className="fb-chat__bubble">
        <div className="fb-chat__who">
          <strong>{name}</strong>
          <time>{time}</time>
          {canReact ? <Menu label={`React to the message from ${name}`} triggerClassName="fb-iconbtn fb-chat__react" trigger={<SmilePlus size={14} />} align="end" items={EMOJI.map((e) => ({ key: e, label: e, onSelect: () => onReact(e, message.reactions.some((r) => r.emoji === e && r.mine)) }))} /> : null}
          {message.canDelete ? <IconButton label={`Delete the message from ${name}`} onClick={onDelete}><Trash2 size={14} /></IconButton> : null}
        </div>
        {message.body ? <p>{parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="fb-chat__mention">{part}</span> : <Fragment key={i}>{part}</Fragment>))}</p> : null}
        {message.card ? <RecordCardView card={message.card} orgSlug={orgSlug} /> : null}
        {message.attachments.length ? (
          <div className="fb-chat__files">
            {message.attachments.map((f) => <button key={f.fileId} type="button" className="fb-chat__file" onClick={() => onOpenFile(f.fileId)}><Paperclip size={12} aria-hidden="true" /> {f.name}</button>)}
          </div>
        ) : null}
        {message.reactions.length ? (
          <div className="fb-chat__reactions">
            {message.reactions.map((r) => (
              <button key={r.emoji} type="button" className="fb-chat__reaction" aria-pressed={r.mine} aria-label={`${r.emoji} ${r.count}`} disabled={!canReact} onClick={() => onReact(r.emoji, r.mine)}>
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const CARD_PATH: Record<CardView["type"], string> = { DEAL: "deals", COMPANY: "companies", LEAD: "leads", INVOICE: "payments" };

/** A record shared in chat, as the API drew it for this viewer: a masked figure is `null`, and a record the viewer cannot open carries no name. */
function RecordCardView({ card, orgSlug }: { card: CardView; orgSlug: string }) {
  if (card.noAccess) {
    return (
      <div className="fb-chat__card" data-denied="true">
        <strong>Record not available</strong>
        <span>This message shares a record your role cannot open, so nothing from it is shown.</span>
      </div>
    );
  }
  return (
    <div className="fb-chat__card">
      <div className="fb-chat__cardhead">
        <Badge tone="info">{card.type === "DEAL" ? "Deal" : card.type === "COMPANY" ? "Company" : card.type === "LEAD" ? "Lead" : "Invoice"}</Badge>
        <a href={`/o/${orgSlug}/${CARD_PATH[card.type]}${card.type === "INVOICE" ? "" : `/${card.id}`}`}>{card.name}</a>
      </div>
      <dl>
        {card.stage ? (<><dt>Stage</dt><dd>{card.stage}</dd></>) : null}
        {card.value !== undefined ? (<><dt>Value</dt><dd>{card.value === null ? <MaskedValue /> : formatKes(card.value)}</dd></>) : null}
        {card.paymentDue !== undefined ? (<><dt>Payment due</dt><dd>{card.paymentDue === null ? <MaskedValue reason="Payments are visible only to Finance and Management." /> : formatKes(card.paymentDue)}</dd></>) : null}
      </dl>
    </div>
  );
}

function NewChannel({ open, onClose, onCreate, disabledReason }: { open: boolean; onClose: () => void; onCreate: (body: { kind: "PUBLIC" | "PRIVATE"; name: string; description?: string }, h: { ok: () => void; fail: (m: string) => void }) => void; disabledReason?: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function create() {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (clean.length < 2) return setError("Use at least two letters or numbers.");
    onCreate({ kind: isPrivate ? "PRIVATE" : "PUBLIC", name: clean, description: description.trim() || undefined }, {
      ok: () => { setName(""); setDescription(""); setPrivate(false); setError(null); onClose(); },
      fail: setError,
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New channel"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} disabledReason={disabledReason}>Create channel</Button>
        </>
      }
    >
      <Input label="Channel name" required value={name} error={error} onChange={(e) => { setName(e.target.value); setError(null); }} help="Lower case, with dashes: for example site-visits." />
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Checkbox label="Private: only people you add can see it" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
    </Dialog>
  );
}
