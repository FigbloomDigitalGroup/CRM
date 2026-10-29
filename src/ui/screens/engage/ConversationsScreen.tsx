"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../../errors";
import { ErrorState, LoadingState, NoAccess } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useFormatters, useReference } from "../leads/data";
import { Icon } from "../leads/icons";
import { CreateLeadDialog, DismissDialog, LinkDialog, LogConversationDialog, QuickLogDialog } from "./Dialogs";
import {
  channelStyle,
  counterpartyOf,
  groupByDay,
  linkOf,
  ownerOf,
  quickLogTarget,
  readStore,
  recordPath,
  useDebounced,
  whoOf,
  writeStore,
  type ConversationRow,
} from "./data";

type TabId = "ALL" | "QUEUE" | "EMAIL" | "WHATSAPP" | "CALLS" | "MEETINGS" | "NOTES";

const CHANNEL_TABS: { id: Exclude<TabId, "ALL" | "QUEUE">; label: string; icon: string }[] = [
  { id: "EMAIL", label: "Email", icon: "mail" },
  { id: "WHATSAPP", label: "WhatsApp", icon: "whatsapp" },
  { id: "CALLS", label: "Calls", icon: "phone" },
  { id: "MEETINGS", label: "Meetings", icon: "users" },
  { id: "NOTES", label: "Notes", icon: "note" },
];
const TAB_IDS: TabId[] = ["ALL", "QUEUE", "EMAIL", "WHATSAPP", "CALLS", "MEETINGS", "NOTES"];
const PAGE_SIZE = 50;

type Dialog =
  | { kind: "link"; row: ConversationRow }
  | { kind: "lead"; row: ConversationRow }
  | { kind: "dismiss"; row: ConversationRow }
  | { kind: "quick"; row: ConversationRow; channel: "CALL" | "WHATSAPP" }
  | { kind: "log" };

/**
 * The Conversations hub (E1, FIG-1098): every email, call, WhatsApp message, meeting and note in one feed, with the Needs-linking queue for
 * messages that matched no record. What a role sees is the API's: a message linked to a record the person cannot open is never listed, and a
 * role that may read but not act (Delivery) gets the queue read-only with the API's own explanation.
 */
export function ConversationsScreen() {
  const member = useMember();
  const { orgSlug, can } = member;
  const fmt = useFormatters();
  const ref = useReference();
  const [tab, setTab] = useState<TabId>("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const search = useDebounced(q.trim(), 300);
  // "Log a note" on the Customer Support home lands here with the log dialog already open.
  const wantsLog = useSearchParams()?.get("log");
  useEffect(() => {
    if (wantsLog) setDialog({ kind: "log" });
  }, [wantsLog]);

  // The channel filter is remembered per organisation on this device.
  const storeKey = `figbloom-conversations-tab:${orgSlug}`;
  useEffect(() => {
    const saved = readStore<string>(storeKey, "ALL");
    if ((TAB_IDS as string[]).includes(saved)) setTab(saved as TabId);
  }, [storeKey]);
  const choose = (id: TabId) => {
    setTab(id);
    setPage(1);
    writeStore(storeKey, id);
  };

  const since = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), []);
  const base = { params: { orgSlug } };
  const feedTab = tab === "QUEUE" ? "ALL" : tab;
  const listQ = useApiQuery("listConversations", { ...base, query: { tab: feedTab, q: search || undefined, page: String(page), pageSize: String(PAGE_SIZE) } }, { placeholderData: (prev) => prev });
  const queueQ = useApiQuery("listNeedsLinking", { ...base, query: { pageSize: "25" } });
  const weekQ = useApiQuery("listConversations", { ...base, query: { from: since, pageSize: "1" } });
  const inboundQ = useApiQuery("listConversations", { ...base, query: { from: since, direction: "INBOUND", pageSize: "1" } });
  const waQ = useApiQuery("listConversations", { ...base, query: { from: since, tab: "WHATSAPP", pageSize: "1" } });

  if (listQ.isError && !listQ.data) {
    const d = describeError(listQ.error);
    if (d.kind === "noAccess") return <NoAccess area="Conversations" denial={d.denial} />;
    return <ErrorState error={listQ.error} area="Conversations" onRetry={() => void listQ.refetch()} />;
  }
  if (!listQ.data) {
    return (
      <div className="fb-en-page" data-screen-label="Conversations">
        <h1 className="fb-en-title">Conversations</h1>
        <LoadingState label="Loading conversations" lines={6} />
      </div>
    );
  }

  const data = listQ.data;
  const access = data.access;
  const canAct = access.canAct;
  const queue = queueQ.data?.items ?? [];
  const queueTotal = queueQ.data?.total ?? 0;
  const now = new Date();
  const org = can("reporting.view.all");
  const deliveryLike = !canAct && can("deals.view.won") && !can("deals.view.own");
  const scope = org
    ? { tone: "org", label: "All organisation conversations", hint: "Everything the team logged or received." }
    : canAct
      ? { tone: "own", label: "My customers’ conversations", hint: "Leads, deals and customers you own." }
      : deliveryLike
        ? { tone: "ro", label: "Won customers", hint: "Customers you’re delivering for." }
        : { tone: "ro", label: "Read-only · assigned clients", hint: "" };
  const audited = !canAct && /technical/i.test(member.roleName);

  const week = weekQ.data?.total ?? 0;
  const waShare = week ? Math.round(((waQ.data?.total ?? 0) / week) * 100) : 0;
  const stats = [
    { l: "This week", n: String(week), sub: "conversations logged or received", icon: "message", fg: "var(--primary-text)" },
    { l: "Inbound", n: String(inboundQ.data?.total ?? 0), sub: "customers reaching out", icon: "inbox", fg: "var(--blue)" },
    { l: "WhatsApp share", n: `${waShare}%`, sub: "of this week’s conversations", icon: "whatsapp", fg: "var(--primary-text)" },
    { l: "Needs linking", n: String(queueTotal), sub: "unmatched emails and messages", icon: "alert", fg: "var(--orange-text)" },
  ];

  const counts = (data.tabCounts ?? {}) as Record<string, number>;
  const tabs: { id: TabId; label: string; icon: string; n: number }[] = [
    { id: "ALL", label: "All", icon: "message", n: counts.ALL ?? data.total },
    { id: "QUEUE", label: "Needs linking", icon: "inbox", n: queueTotal },
    ...CHANNEL_TABS.map((t) => ({ ...t, n: counts[t.id] ?? 0 })),
  ];

  const showQueue = (tab === "ALL" || tab === "QUEUE") && !search;
  const showFeed = tab !== "QUEUE";
  const days = groupByDay(data.items, now, member.timeZone);
  const byLine = (r: ConversationRow) => {
    const owner = ownerOf(r);
    const name = owner ? (owner === member.membershipId ? member.userName : ref.memberName(owner) || "Team member") : r.direction === "INBOUND" ? "Received automatically" : "Figbloom";
    return `${name} · ${fmt.when(r.occurredAt)}`;
  };

  return (
    <div className="fb-en-page" data-screen-label="Conversations">
      <div className="fb-en-head">
        <div>
          <h1 className="fb-en-title">Conversations</h1>
          <p className="fb-en-sub">Every WhatsApp, call, email, meeting and social message with customers, in one place.</p>
          <div className="fb-en-scoperow">
            <span className={`fb-en-scope fb-en-scope--${scope.tone}`}>
              <span className="fb-en-scope__dot" aria-hidden="true" />
              {scope.label}
            </span>
            {scope.hint ? <span className="fb-en-hint">{scope.hint}</span> : null}
          </div>
        </div>
        {canAct ? (
          <button type="button" className="fb-en-btn fb-en-btn--primary fb-en-btn--tall" onClick={() => setDialog({ kind: "log" })}>
            <Icon name="plus" size={16} stroke={2.2} />
            Log a conversation
          </button>
        ) : null}
      </div>

      {audited ? (
        <div role="note" className="fb-en-note">
          <Icon name="shield" size={16} />
          <span>
            <strong>Read-only, and your access is logged.</strong> You see conversations for clients you have assigned work for. Opening them is recorded in the audit log.
          </span>
        </div>
      ) : access.readOnly && access.notice ? (
        <div role="note" className="fb-en-note">
          <Icon name="info" size={16} />
          <span>{access.notice}</span>
        </div>
      ) : null}

      <div className="fb-en-stats">
        {stats.map((s) => (
          <div className="fb-en-stat" key={s.l}>
            <div className="fb-en-stat__label">
              <span style={{ color: s.fg, display: "flex" }}>
                <Icon name={s.icon} size={15} />
              </span>
              {s.l}
            </div>
            <div className="fb-en-stat__n">{s.n}</div>
            <div className="fb-en-stat__sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="fb-en-bar">
        <div role="tablist" aria-label="Channels" className="fb-en-tabs">
          {tabs.map((t) => (
            <button type="button" role="tab" key={t.id} aria-selected={tab === t.id} data-on={tab === t.id} className="fb-en-tab" onClick={() => choose(t.id)}>
              <Icon name={t.icon} size={14} />
              {t.label}
              <span className="fb-en-tab__n">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="fb-en-search">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </div>
      </div>

      {showQueue ? (
        <section className="fb-en-card" aria-label="Needs linking">
          <div className="fb-en-queuehead">
            <div className="fb-en-queuehead__t">
              <Icon name="inbox" size={17} />
              <strong>Needs linking · {queueTotal}</strong>
            </div>
            <span>New emails and social messages that don’t match anyone yet. Link them or turn them into a lead.</span>
          </div>
          {queueQ.isError ? (
            <div className="fb-en-empty fb-en-empty--row" role="alert">
              {describeError(queueQ.error).body}
            </div>
          ) : (
            queue.map((m) => {
              const c = channelStyle(m.channel === "EMAIL" ? "EMAIL" : "SOCIAL");
              const cp = counterpartyOf(m);
              return (
                <div className="fb-en-qrow" key={m.id}>
                  <span className="fb-en-ico" style={{ background: c.bg, color: c.fg }}>
                    <Icon name={c.icon} size={17} />
                  </span>
                  <div className="fb-en-qrow__main">
                    <div className="fb-en-qrow__who">
                      <strong>{cp.name || cp.email || cp.phone || "Unknown sender"}</strong>
                      <span className="fb-en-faint">
                        {[cp.email, cp.phone].filter(Boolean).join(" · ")} {fmt.when(m.occurredAt)}
                      </span>
                    </div>
                    {m.subject ? <div className="fb-en-qrow__subject">{m.subject}</div> : null}
                    {m.summary ? <div className="fb-en-qrow__summary">{m.summary}</div> : null}
                  </div>
                  {canAct ? (
                    <div className="fb-en-qrow__actions">
                      <button type="button" className="fb-en-select fb-en-select--btn" aria-label={`Link ${cp.name || cp.email || "this message"} to a record`} onClick={() => setDialog({ kind: "link", row: m })}>
                        Link to existing…
                        <Icon name="chevron-down" size={14} />
                      </button>
                      {can("leads.create") ? (
                        <button type="button" className="fb-en-btn fb-en-btn--primary fb-en-btn--sm" onClick={() => setDialog({ kind: "lead", row: m })}>
                          <Icon name="user-plus" size={14} />
                          Create lead
                        </button>
                      ) : null}
                      <button type="button" className="fb-en-btn fb-en-btn--ghost fb-en-btn--sm" onClick={() => setDialog({ kind: "dismiss", row: m })}>
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {!queueQ.isError && queue.length === 0 ? (
            <div className="fb-en-empty fb-en-empty--row">
              <span style={{ color: "var(--primary)", display: "flex" }}>
                <Icon name="check-circle" size={16} />
              </span>
              Everything is linked.
            </div>
          ) : null}
        </section>
      ) : null}

      {showFeed ? (
        <>
          {days.map((d) => (
            <div key={d.label} className="fb-en-day">
              <div className="fb-en-day__label" aria-hidden="true">
                {d.label}
                <span />
              </div>
              <section className="fb-en-card" aria-label={`Conversations, ${d.label.toLowerCase()}`}>
                {d.items.map((a) => {
                  const c = channelStyle(a.channel);
                  const link = linkOf(a);
                  const cp = counterpartyOf(a);
                  const rec = recordPath(link);
                  const inbound = a.direction === "INBOUND";
                  const target = quickLogTarget(link);
                  const canReply = canAct && Boolean(cp.phone) && Boolean(target);
                  const digits = (cp.phone ?? "").replace(/\D/g, "");
                  const text = [a.subject, a.summary].filter(Boolean).join(" · ");
                  return (
                    <article className="fb-en-row" key={a.id}>
                      <span className="fb-en-ico" style={{ background: c.bg, color: c.fg }}>
                        <Icon name={c.icon} size={17} />
                      </span>
                      <div className="fb-en-row__main">
                        <div className="fb-en-row__top">
                          {rec ? (
                            <Link className="fb-en-who" href={`/o/${orgSlug}${rec.path}`}>
                              {whoOf(a)}
                            </Link>
                          ) : (
                            <strong className="fb-en-who fb-en-who--plain">{whoOf(a)}</strong>
                          )}
                          {a.direction ? (
                            <span className={`fb-en-dir fb-en-dir--${inbound ? "in" : "out"}`}>{inbound ? "INBOUND" : "OUTBOUND"}</span>
                          ) : null}
                          <span className="fb-en-faint">{c.label + (cp.name && cp.name !== whoOf(a) ? ` · ${cp.name}` : "")}</span>
                        </div>
                        <div className="fb-en-row__text">{text || "No details were logged."}</div>
                        <div className="fb-en-row__by">{byLine(a)}</div>
                      </div>
                      {canReply ? (
                        <div className="fb-en-row__reply">
                          <a className="fb-en-sq" href={`tel:${cp.phone}`} aria-label={`Call ${whoOf(a)}`} title="Call" onClick={() => setDialog({ kind: "quick", row: a, channel: "CALL" })}>
                            <Icon name="phone" size={15} />
                          </a>
                          <a className="fb-en-sq" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${whoOf(a)}`} title="WhatsApp" onClick={() => setDialog({ kind: "quick", row: a, channel: "WHATSAPP" })}>
                            <Icon name="whatsapp" size={15} />
                          </a>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </section>
            </div>
          ))}
          {days.length === 0 ? (
            <div className="fb-en-empty fb-en-empty--card">
              {search
                ? `No conversations match “${search}”. Try a name, a phone number or a word from the message.`
                : tab === "ALL"
                  ? "No conversations here yet. Calls and chats you log from any record show up in this feed."
                  : "No conversations in this channel yet. Calls and chats you log from any record show up in this feed."}
            </div>
          ) : null}
          {data.pageCount > 1 ? (
            <nav className="fb-en-pager" aria-label="Pages of conversations">
              <button type="button" className="fb-en-btn fb-en-btn--secondary fb-en-btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {data.page} of {data.pageCount} · {data.total} conversations
              </span>
              <button type="button" className="fb-en-btn fb-en-btn--secondary fb-en-btn--sm" disabled={page >= data.pageCount} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </nav>
          ) : null}
        </>
      ) : null}

      <div className="fb-en-foot">
        <Icon name="info" size={14} />
        WhatsApp and calls open on your phone; you’re asked to log the outcome after. Email and Facebook/Instagram messages arrive automatically once connected in Settings › Integrations.
      </div>

      {dialog?.kind === "link" ? <LinkDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "lead" ? <CreateLeadDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "dismiss" ? <DismissDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "quick" ? (
        <QuickLogDialog target={quickLogTarget(linkOf(dialog.row))} who={counterpartyOf(dialog.row).name ?? whoOf(dialog.row)} phone={counterpartyOf(dialog.row).phone} channel={dialog.channel} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "log" ? <LogConversationDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
