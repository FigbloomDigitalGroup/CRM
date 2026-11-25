"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Dialog, Input, KpiTile, MaskedValue, NoAccess, Select, Textarea, useMember, useToast, type Tone } from "@/ui";
import {
  ACCOUNTS, CAMPAIGNS, CHANNELS, DAILY_ENGAGEMENT, MENTIONS, POSTS, THREADS, dayLabel, kes, short,
  type Campaign, type ChannelKey, type Mention, type Post, type PostStatus, type Thread,
} from "./demo/data";

/**
 * The Social workspace (UC-S4 to UC-S6, FIG-1813 to FIG-1815): overview with per-account dashboards, accounts, monitor and mentions, unified inbox,
 * publishing and calendar, campaigns, analytics, and "Convert to lead". It runs on demo data (`./demo/data.ts`); no network is called and nothing is
 * scraped. Costs, budgets and pipeline value are masked unless the member may see deal values (hard rule 7). A lead made here is record-only for now.
 */

const POST_TONE: Record<PostStatus, Tone> = { Scheduled: "info", "Needs approval": "warning", Draft: "neutral", Published: "success" };
const CAMP_TONE: Record<Campaign["status"], Tone> = { Active: "success", Paused: "warning", Ended: "neutral", Draft: "neutral", Scheduled: "info" };
const SENT_TONE: Record<Mention["sentiment"], Tone> = { Positive: "success", Neutral: "neutral", Negative: "danger" };

function ChannelChip({ ch }: { ch: ChannelKey }) {
  return <span className="fb-social__chip" title={CHANNELS[ch].name}>{CHANNELS[ch].ab}</span>;
}
const Chips = ({ list }: { list: ChannelKey[] }) => <span className="fb-social__chips">{list.map((c) => <ChannelChip key={c} ch={c} />)}</span>;

export interface Ctx {
  money: boolean;
  createLead: (name: string, channel: ChannelKey) => void;
  leadNames: string[];
  /** Go to another Social page, by its path under /social ("/inbox", "/publishing" and so on). */
  go: (sub: string) => void;
}

/** The pages' shared state: money masking, record-only leads (demo) and the in-app route change. */
function useSocialCtx(): Ctx {
  const { can, orgSlug } = useMember();
  const toast = useToast();
  const router = useRouter();
  const [leadNames, setLeadNames] = useState<string[]>([]);
  return {
    money: can("deals.view.value"),
    leadNames,
    go: (sub) => router.push(`/o/${orgSlug}/social${sub}`),
    createLead: (name, channel) => {
      // Record-only (demo): the real action creates a Lead with source and campaign attribution through the leads API, unassigned, in the pool.
      setLeadNames((l) => (l.includes(name) ? l : [...l, name]));
      toast.show({ message: `${name} added to Leads from ${CHANNELS[channel].name}, unassigned. Sales picks it up from the pool.` });
    },
  };
}

/** One Social page: the permission check (the explained no-access), the heading and its actions. */
function Frame({ title, subtitle, need = "social.view", actions, children }: { title: string; subtitle: string; need?: string; actions?: ReactNode; children: (ctx: Ctx) => ReactNode }) {
  const { can } = useMember();
  const ctx = useSocialCtx();
  if (!can(need)) return <NoAccess area={title} />;
  return (
    <div className="fb-social">
      <header className="fb-social__head">
        <div>
          <h1 className="fb-social__title">{title}</h1>
          <p className="fb-social__sub">{subtitle}</p>
        </div>
        <div className="fb-social__actions">
          <Badge tone="info">Marketing team</Badge>
          {actions}
        </div>
      </header>
      {children(ctx)}
    </div>
  );
}

export function SocialInbox() {
  return <Frame title="Unified inbox" subtitle="Messages from every connected account in one place.">{(ctx) => <Inbox ctx={ctx} />}</Frame>;
}
export function SocialPublishing() {
  return <Frame title="Publishing" subtitle="Compose, schedule and approve posts across your accounts." need="social.publish">{() => <Publishing />}</Frame>;
}
export function SocialCampaigns() {
  return <Frame title="Campaigns" subtitle="What you run, what it costs and the leads and deals it brings in.">{(ctx) => <Campaigns ctx={ctx} />}</Frame>;
}
export function SocialAnalytics() {
  return <Frame title="Social analytics" subtitle="Reach, engagement and the leads that came from social.">{(ctx) => <Analytics ctx={ctx} />}</Frame>;
}

/** The Social overview. Also embedded as the Marketing role's home (the dashboard). */
export function SocialOverview() {
  const toast = useToast();
  return (
    <Frame
      title="Social overview"
      subtitle="Your accounts, what people are saying and what needs a reply."
      actions={<Button onClick={() => toast.show({ message: "Connecting needs the connector service, which is not wired yet." })}>Connect account</Button>}
    >
      {(ctx) => <OverviewBody ctx={ctx} />}
    </Frame>
  );
}

function OverviewBody({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [rows, setRows] = useState(ACCOUNTS);
  const unread = THREADS.filter((t) => t.unread).length;
  const expired = rows.filter((a) => !a.connected);
  const awaiting = POSTS.filter((p) => p.status === "Needs approval").length;
  const sentiments = (["Positive", "Neutral", "Negative"] as const).map((s) => ({ s, n: MENTIONS.filter((m) => m.sentiment === s).length }));
  const total = Math.max(1, MENTIONS.length);
  const attention = [
    expired.length > 0 && { id: "x", label: `Reconnect ${expired.map((a) => CHANNELS[a.key].name).join(", ")}: token expired`, cta: "Reconnect all", run: () => setRows((r) => r.map((x) => (x.connected ? x : { ...x, connected: true, syncedAt: "just now" }))) },
    unread > 0 && { id: "reply", label: `${unread} new message${unread === 1 ? "" : "s"} to reply to`, cta: "Open inbox", run: () => ctx.go("/inbox") },
    awaiting > 0 && { id: "appr", label: `${awaiting} boosted post waiting for Management`, cta: "Review", run: () => ctx.go("/publishing") },
  ].filter(Boolean) as { id: string; label: string; cta: string; run: () => void }[];
  return (
    <div className="fb-social__stack">
      <div className="fb-social__cards">
        {rows.map((a) => (
          <Card key={a.key} title={<span><ChannelChip ch={a.key} /> {CHANNELS[a.key].name}</span>}>
            <p className="fb-social__big">{a.handle}</p>
            <p>{a.followers.toLocaleString("en-KE")} followers · +{a.delta} this month</p>
            <p className="fb-social__muted">{a.connected ? `Synced ${a.syncedAt}` : `Token expired · last synced ${a.syncedAt}`}</p>
            {!a.connected && (
              <div className="fb-social__actions">
                <Button onClick={() => { setRows((r) => r.map((x) => (x.key === a.key ? { ...x, connected: true, syncedAt: "just now" } : x))); toast.show({ message: `${CHANNELS[a.key].name} reconnected (demo).` }); }}>Reconnect</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <div className="fb-social__two">
        <Mentions ctx={ctx} />
        <div className="fb-social__stack">
          <Card title="Sentiment this week">
            <div className="fb-social__sentbar" role="img" aria-label={sentiments.map((x) => `${x.s} ${x.n}`).join(", ")}>
              {sentiments.map((x) => <span key={x.s} data-sent={x.s} style={{ width: `${(x.n / total) * 100}%` }} />)}
            </div>
            <p className="fb-social__muted">{sentiments.map((x) => `${x.s} ${x.n}`).join(" · ")}</p>
          </Card>
          <Card title="Needs attention">
            {attention.length === 0 ? <p className="fb-social__muted">Nothing waiting. You are caught up.</p> : (
              <ul className="fb-social__list">
                {attention.map((t) => <li key={t.id}><span>{t.label}</span><Button variant="secondary" onClick={t.run}>{t.cta}</Button></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* Mentions -------------------------------------------------------------------------------------------------------- */

function Mentions({ ctx }: { ctx: Ctx }) {
  const [sent, setSent] = useState<"all" | Mention["sentiment"]>("all");
  const list = MENTIONS.filter((m) => sent === "all" || m.sentiment === sent);
  const count = (s: Mention["sentiment"]) => MENTIONS.filter((m) => m.sentiment === s).length;
  return (
    <div className="fb-social__stack">
      <div className="fb-social__bar">
        {(["all", "Positive", "Neutral", "Negative"] as const).map((s) => (
          <Button key={s} variant={sent === s ? "primary" : "secondary"} aria-pressed={sent === s} onClick={() => setSent(s)}>{s === "all" ? `All ${MENTIONS.length}` : `${s} ${count(s)}`}</Button>
        ))}
      </div>
      <Card title="Mentions">
        <ul className="fb-social__list">
          {list.map((m) => (
            <li key={m.id}>
              <span><ChannelChip ch={m.ch} /> <b>{m.who}</b> <span className="fb-social__muted">{m.handle} · {m.when} · reach {m.reach}</span><br />{m.text}</span>
              <span className="fb-social__actions">
                <Badge tone={SENT_TONE[m.sentiment]}>{m.sentiment}</Badge>
                <Button variant="secondary" onClick={() => ctx.go("/inbox")}>Reply in inbox</Button>
                {m.leadable && (ctx.leadNames.includes(m.who) ? <Badge tone="success">Lead created</Badge> : <Button variant="secondary" onClick={() => ctx.createLead(m.who, m.ch)}>Create lead</Button>)}
              </span>
            </li>
          ))}
        </ul>
        {list.length === 0 && <p className="fb-social__muted">No mentions with this sentiment.</p>}
      </Card>
    </div>
  );
}

/* Unified inbox ----------------------------------------------------------------------------------------------------------------- */

function Inbox({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [threads, setThreads] = useState<Thread[]>(THREADS);
  const [filter, setFilter] = useState<"open" | "unread" | "done">("open");
  const [sel, setSel] = useState<string | null>(THREADS[0]!.id);
  const [reply, setReply] = useState("");
  const shown = threads.filter((t) => (filter === "unread" ? t.unread : t.status === filter));
  const cur = threads.find((t) => t.id === sel) ?? null;
  const patch = (id: string, p: Partial<Thread>) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  return (
    <div className="fb-social__inbox">
      <Card title="Messages">
        <div className="fb-social__bar">
          {(["open", "unread", "done"] as const).map((f) => <Button key={f} variant={filter === f ? "primary" : "secondary"} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0]!.toUpperCase() + f.slice(1)}</Button>)}
        </div>
        {shown.length === 0 ? <p className="fb-social__muted">Nothing here. You are caught up.</p> : (
          <ul className="fb-social__list">
            {shown.map((t) => (
              <li key={t.id}>
                <button type="button" className="fb-social__thread" aria-current={t.id === sel} onClick={() => { setSel(t.id); patch(t.id, { unread: false }); }}>
                  <ChannelChip ch={t.ch} /> <b>{t.who}</b> {t.unread && <Badge tone="info">New</Badge>}
                  <span className="fb-social__muted">{t.messages[t.messages.length - 1]!.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={cur ? `${cur.who} · ${cur.handle}` : "Conversation"}>
        {!cur ? <p className="fb-social__muted">Pick a message to read it.</p> : (
          <>
            <ul className="fb-social__msgs" aria-label="Messages in this conversation">
              {cur.messages.map((m, i) => <li key={i} data-dir={m.dir}><span>{m.text}</span><small>{m.time}</small></li>)}
            </ul>
            <Textarea label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} />
            <div className="fb-social__actions">
              <Button disabled={!reply.trim()} onClick={() => { patch(cur.id, { messages: [...cur.messages, { dir: "out", text: reply.trim(), time: "now" }], assignedTo: "Marketing" }); setReply(""); toast.show({ message: "Reply saved (demo, not sent to the network)." }); }}>Send</Button>
              <Button variant="secondary" onClick={() => ctx.createLead(cur.who, cur.ch)}>Convert to lead</Button>
              <Button variant="secondary" onClick={() => patch(cur.id, { status: cur.status === "done" ? "open" : "done" })}>{cur.status === "done" ? "Reopen" : "Mark done"}</Button>
            </div>
            {ctx.leadNames.includes(cur.who) && <Badge tone="success">Lead created</Badge>}
          </>
        )}
      </Card>
    </div>
  );
}

/* Publishing and calendar ------------------------------------------------------------------------------------------------------ */

function Publishing() {
  const toast = useToast();
  const { can } = useMember();
  const [view, setView] = useState<"calendar" | "queue">("calendar");
  const [posts, setPosts] = useState<Post[]>(POSTS);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ChannelKey[]>(["ig"]);
  const [day, setDay] = useState("1");
  const [campaignId, setCampaignId] = useState("");
  const [boost, setBoost] = useState(false);
  const live = ACCOUNTS.filter((a) => a.connected);
  const canApprove = can("quotes.approve") || can("configuration.manage");
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => i), []);

  function save(draft: boolean) {
    const status: PostStatus = draft ? "Draft" : boost ? "Needs approval" : "Scheduled";
    setPosts((ps) => [...ps, { id: `n${ps.length}`, channels: picked, text: text.trim(), day: Number(day), time: "10:00", status, campaignId, boost }]);
    setComposing(false); setText(""); setBoost(false);
    toast.show({ message: draft ? "Saved as a draft." : boost ? "Waiting for Management to approve the boost." : "Scheduled (demo, nothing is sent to a network)." });
  }
  const error = text.length > 280 ? "Too long for X (280 characters)." : picked.length === 0 ? "Pick at least one account." : "";
  return (
    <div className="fb-social__stack">
      <div className="fb-social__bar">
        <Button variant={view === "calendar" ? "primary" : "secondary"} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>Week</Button>
        <Button variant={view === "queue" ? "primary" : "secondary"} aria-pressed={view === "queue"} onClick={() => setView("queue")}>List</Button>
        <Button onClick={() => setComposing(true)} disabled={live.length === 0}>New post</Button>
      </div>
      {view === "calendar" ? (
        <div className="fb-social__week">
          {days.map((d) => (
            <section key={d} aria-label={dayLabel(d)} className="fb-social__day">
              <h3>{dayLabel(d)}</h3>
              {posts.filter((p) => p.day === d).map((p) => (
                <div key={p.id} className="fb-social__post"><b>{p.time}</b> <Chips list={p.channels} /><p>{p.text}</p><Badge tone={POST_TONE[p.status]}>{p.status}</Badge></div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <Card title="All posts">
          <ul className="fb-social__list">
            {[...posts].sort((a, b) => a.day - b.day).map((p) => (
              <li key={p.id}>
                <span><b>{dayLabel(p.day)} {p.time}</b> <Chips list={p.channels} /> {p.text}{p.campaignId ? <span className="fb-social__muted"> · {CAMPAIGNS.find((c) => c.id === p.campaignId)?.name}</span> : null}</span>
                <span className="fb-social__actions">
                  <Badge tone={POST_TONE[p.status]}>{p.status}</Badge>
                  {p.status === "Needs approval" && (canApprove
                    ? <Button variant="secondary" onClick={() => setPosts((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: "Scheduled" } : x)))}>Approve</Button>
                    : <span className="fb-social__muted">Waiting for Management</span>)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog open={composing} onClose={() => setComposing(false)} title="New post" actions={<><Button variant="secondary" onClick={() => save(true)} disabled={!text.trim()}>Save draft</Button><Button onClick={() => save(false)} disabled={!text.trim() || !!error}>{boost ? "Send for approval" : "Schedule"}</Button></>}>
        <fieldset className="fb-social__fieldset">
          <legend>Post to</legend>
          {live.map((a) => (
            <label key={a.key}><input type="checkbox" checked={picked.includes(a.key)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.key] : p.filter((k) => k !== a.key)))} /> {CHANNELS[a.key].name}</label>
          ))}
        </fieldset>
        <Textarea label="Text" value={text} onChange={(e) => setText(e.target.value)} rows={4} error={error || undefined} help={`${text.length} characters`} />
        <Select label="Day" value={day} onChange={(e) => setDay(e.target.value)} options={days.map((d) => ({ value: String(d), label: dayLabel(d) }))} />
        <Select label="Campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} options={[{ value: "", label: "None" }, ...CAMPAIGNS.filter((c) => c.status !== "Ended").map((c) => ({ value: c.id, label: c.name }))]} />
        <label><input type="checkbox" checked={boost} onChange={(e) => setBoost(e.target.checked)} /> Boost with paid budget (needs Management approval)</label>
      </Dialog>
    </div>
  );
}

/* Campaigns ---------------------------------------------------------------------------------------------------------------------- */

function Campaigns({ ctx }: { ctx: Ctx }) {
  const toast = useToast();
  const [list, setList] = useState<Campaign[]>(CAMPAIGNS);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const cur = list.find((c) => c.id === open) ?? null;
  const money = (v: number): ReactNode => (ctx.money ? kes(v) : <MaskedValue />);
  const cpl = (c: Campaign): ReactNode => (c.leads === 0 ? "n/a" : ctx.money ? kes(c.spent / c.leads) : <MaskedValue />);
  return (
    <div className="fb-social__stack">
      <div className="fb-social__bar"><Button onClick={() => setCreating(true)}>New campaign</Button></div>
      <table className="fb-social__table">
        <caption className="fb-sr-only">Campaigns</caption>
        <thead><tr><th>Campaign</th><th>Status</th><th>Channels</th><th>Spent</th><th>Reach</th><th>Leads</th><th>Cost per lead</th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <th scope="row"><button type="button" className="fb-social__link" onClick={() => setOpen(c.id)}>{c.name}</button><br /><small>Goal: {c.goal}</small></th>
              <td><Badge tone={CAMP_TONE[c.status]}>{c.status}</Badge></td>
              <td><Chips list={c.channels} /></td>
              <td>{money(c.spent)}</td>
              <td>{short(c.reach)}</td>
              <td>{c.leads}</td>
              <td>{cpl(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!cur} onClose={() => setOpen(null)} title={cur?.name ?? "Campaign"}>
        {cur && (
          <div className="fb-social__stack">
            <p>{dayLabel(cur.startDay)} to {dayLabel(cur.endDay).toLowerCase()} · budget {money(cur.budget)}</p>
            <h3>From reach to won deals</h3>
            <ul className="fb-social__funnel">
              <li><span>Reach</span><b>{short(cur.reach)}</b></li>
              <li><span>Clicks</span><b>{short(cur.clicks)}</b></li>
              <li><span>Leads</span><b>{cur.leads}</b></li>
              <li><span>Won deals</span><b>{cur.deals}</b></li>
              <li><span>Pipeline value</span><b>{ctx.money ? kes(cur.pipelineValue) : <MaskedValue />}</b></li>
            </ul>
            <h3>Posts in this campaign</h3>
            {POSTS.filter((p) => p.campaignId === cur.id).length === 0 ? <p className="fb-social__muted">No posts yet. Pick this campaign when you schedule a post.</p> : (
              <ul className="fb-social__list">{POSTS.filter((p) => p.campaignId === cur.id).map((p) => <li key={p.id}><span>{dayLabel(p.day)} · {p.text}</span><Badge tone={POST_TONE[p.status]}>{p.status}</Badge></li>)}</ul>
            )}
          </div>
        )}
      </Dialog>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New campaign" actions={
        <Button disabled={!name.trim()} onClick={() => { setList((l) => [...l, { id: `n${l.length}`, name: name.trim(), goal: "Leads", status: "Draft", channels: [], startDay: 7, endDay: 35, budget: Number(budget) || 0, spent: 0, reach: 0, clicks: 0, leads: 0, deals: 0, pipelineValue: 0 }]); setCreating(false); setName(""); setBudget(""); toast.show({ message: "Campaign created as a draft." }); }}>Create as draft</Button>
      }>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        {ctx.money && <Input label="Budget (KES)" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} />}
      </Dialog>
    </div>
  );
}

/* Analytics ---------------------------------------------------------------------------------------------------------------------- */

function Analytics({ ctx }: { ctx: Ctx }) {
  const [range, setRange] = useState("30");
  const data = DAILY_ENGAGEMENT.slice(-Number(range));
  const peak = Math.max(...data);
  const published = POSTS.filter((p) => p.status === "Published").sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  const live = ACCOUNTS.filter((a) => a.connected);
  const totalReach = live.reduce((n, a) => n + a.reach30, 0);
  return (
    <div className="fb-social__stack">
      <div className="fb-social__bar">
        <Select label="Period" value={range} onChange={(e) => setRange(e.target.value)} options={[{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }]} />
      </div>
      <div className="fb-social__kpis">
        <KpiTile label="Reach" value={short(totalReach)} trend="+12%" tone="up" />
        <KpiTile label="Engagements" value={short(data.reduce((n, v) => n + v, 0))} trend="+9%" tone="up" />
        <KpiTile label="New followers" value={String(live.reduce((n, a) => n + a.delta, 0))} trend="+18%" tone="up" />
        <KpiTile label="Leads" value="29" trend="+4" tone="up" />
      </div>
      <Card title="Engagements per day">
        <p className="fb-social__muted">Likes, comments, shares and saves · peak {peak}</p>
        <div className="fb-social__bars" role="img" aria-label={`Engagements per day over the last ${range} days, peak ${peak}`}>
          {data.map((v, i) => <span key={i} style={{ height: `${Math.round((v / peak) * 100)}%` }} />)}
        </div>
      </Card>
      <div className="fb-social__two">
        <Card title="By channel">
          <table className="fb-social__table">
            <caption className="fb-sr-only">Results by channel</caption>
            <thead><tr><th>Channel</th><th>Reach</th><th>Engagement</th></tr></thead>
            <tbody>{live.map((a) => <tr key={a.key}><th scope="row"><ChannelChip ch={a.key} /> {CHANNELS[a.key].name}</th><td>{short(a.reach30)}</td><td>{a.engagement}%</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Top posts">
          <ol className="fb-social__list">
            {published.slice(0, 5).map((p, i) => <li key={p.id}><span><b>{i + 1}.</b> {p.text} <Chips list={p.channels} /></span><span>{short(p.reach ?? 0)} reach · {p.engaged} engaged</span></li>)}
          </ol>
        </Card>
      </div>
      {!ctx.money && <p className="fb-social__muted">Costs and pipeline value are hidden for your role.</p>}
    </div>
  );
}
