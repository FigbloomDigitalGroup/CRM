"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MaskedValue } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { dueLabel, money, moneyShort, pct } from "./format";
import { ChartCard, HIcon, Panel, SectionFailed, type KpiDef } from "./kit";
import { useCompleteTask, useReferenceData } from "./blocks";
import type { DeliveryData, FinanceData, ManagementData, TaskItem, TechnicalData } from "./dash";

const MASK_REASON = "Amounts are shown only to roles that may see them.";

/* Management (D2) ----------------------------------------------------------------------------------------------------------------- */

function delta(now: number, prev: number, opts: { money?: boolean; goodWhenDown?: boolean; unit?: string } = {}) {
  const d = now - prev;
  const text = d === 0 ? "no change" : `${d > 0 ? "▲" : "▼"} ${opts.money ? moneyShort(Math.abs(d)) : Math.abs(d)}${opts.unit ?? ""}`;
  const good = opts.goodWhenDown ? d < 0 : d > 0;
  const tone = d === 0 ? "var(--text-3)" : good ? "var(--primary-text)" : "var(--red)";
  return { text, tone, d };
}

export function MonthVsLast({ data }: { data: ManagementData }) {
  const cur = data.thisMonth.metrics;
  const prev = data.lastMonth.metrics;
  const masked = cur.valueMasked;
  const rate = (m: typeof cur) => (m.leadConversion.total > 0 ? Math.round((m.leadConversion.converted / m.leadConversion.total) * 100) : 0);
  const wonValue = (m: typeof cur) => Number(m.dealOutcomes.won.value ?? 0);
  const cards: { label: string; now: React.ReactNode; prev: React.ReactNode; dot: string; delta: ReturnType<typeof delta> }[] = [
    { label: "New leads", now: cur.leadConversion.total, prev: prev.leadConversion.total, dot: "var(--blue)", delta: delta(cur.leadConversion.total, prev.leadConversion.total) },
    { label: "Conversion", now: `${rate(cur)}%`, prev: `${rate(prev)}%`, dot: "var(--primary)", delta: delta(rate(cur), rate(prev), { unit: " pts" }) },
    { label: "Won", now: cur.dealOutcomes.won.count, prev: prev.dealOutcomes.won.count, dot: "var(--primary)", delta: delta(cur.dealOutcomes.won.count, prev.dealOutcomes.won.count) },
    {
      label: "Won value",
      now: masked ? <MaskedValue reason={MASK_REASON} /> : moneyShort(wonValue(cur)),
      prev: masked ? "hidden" : moneyShort(wonValue(prev)),
      dot: "var(--orange)",
      delta: masked ? { text: "", tone: "var(--text-3)", d: 0 } : delta(wonValue(cur), wonValue(prev), { money: true }),
    },
    { label: "Lost", now: cur.dealOutcomes.lost.count, prev: prev.dealOutcomes.lost.count, dot: "var(--red)", delta: delta(cur.dealOutcomes.lost.count, prev.dealOutcomes.lost.count, { goodWhenDown: true }) },
  ];
  return (
    <>
      <div className="fb-eyebrow">
        THIS MONTH VS LAST<span className="fb-eyebrow__rule" />
      </div>
      <div className="fb-mom">
        {cards.map((c) => (
          <div key={c.label} className="fb-mom__card">
            <div className="fb-mom__label">
              <span className="fb-mom__dot" style={{ background: c.dot }} aria-hidden="true" />
              {c.label}
            </div>
            <div className="fb-mom__row">
              <span className="fb-mom__now">{c.now}</span>
              <span className="fb-mom__delta" style={{ color: c.delta.tone }}>
                {c.delta.text}
              </span>
            </div>
            <div className="fb-mom__prev">Last month {c.prev}</div>
          </div>
        ))}
      </div>
    </>
  );
}

export function RevenueByService({ data }: { data: ManagementData }) {
  const ref = useReferenceData();
  const cur = data.thisMonth.metrics;
  const names = useMemo(() => new Map((ref.data?.services ?? []).map((s) => [s.id, s.name])), [ref.data]);
  const rows = cur.salesByService
    .map((r) => ({ name: (r.serviceId && names.get(r.serviceId)) || "Other", value: Number(r._sum.value ?? 0), count: r._count._all }))
    .sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const masked = cur.valueMasked;
  const summary = rows.length
    ? `Revenue won this month by service line: ${rows.map((r) => `${r.name} ${masked ? "hidden" : moneyShort(r.value)}`).join(", ")}.`
    : "No deals won this month yet.";
  return (
    <ChartCard
      title="Revenue won by service line"
      sub="This month, closed won"
      columns={["Service line", "Won value", "Deals"]}
      rows={rows.map((r) => ({ label: r.name, text: masked ? "Hidden for your role" : money(r.value), extra: [String(r.count)] }))}
      summary={summary}
    >
      <div className="fb-hbars">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="fb-hbars__top">
              <span>{r.name}</span>
              <strong>{masked ? <MaskedValue reason={MASK_REASON} /> : money(r.value)}</strong>
            </div>
            <div className="fb-hbars__track">
              <div className="fb-hbars__fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
        {rows.length === 0 ? <span className="fb-hp__sub">No deals won this month yet.</span> : null}
      </div>
    </ChartCard>
  );
}

export function TeamHealth({ data }: { data: ManagementData }) {
  const { orgSlug } = useMember();
  const sales = useApiQuery("getReportsSalesBySalesperson", { params: { orgSlug }, query: { dateFrom: data.thisMonth.from, dateTo: data.thisMonth.to, period: "total" } });
  const won = new Map(((sales.data?.rows ?? []) as { ownerMembershipId: string; wonCount: number }[]).map((r) => [r.ownerMembershipId, r.wonCount]));
  const people = data.teamWorkload;
  return (
    <Panel title="Team follow-up health" sub="So you can help unblock, not to rank people.">
      <div className="fb-hscroll">
        <table className="fb-htable fb-htable--team">
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>
                Person
              </th>
              <th scope="col">Open tasks</th>
              <th scope="col">Overdue</th>
              <th scope="col">Won (MTD)</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.membershipId}>
                <th scope="row" style={{ textAlign: "left" }}>
                  <span className="fb-who">
                    <span className="fb-hav fb-hav--sm" aria-hidden="true">
                      {(p.name ?? "?").replace(/^Dev /, "").slice(0, 1).toUpperCase()}
                    </span>
                    {p.name ?? "Unnamed"}
                  </span>
                </th>
                <td>{p.openTasks}</td>
                <td style={p.overdueTasks ? { color: "var(--red)", fontWeight: 600 } : undefined}>{p.overdueTasks ? `▲ ${p.overdueTasks}` : p.overdueTasks}</td>
                <td>{sales.isPending ? "…" : (won.get(p.membershipId) ?? 0)}</td>
              </tr>
            ))}
            {people.length === 0 ? (
              <tr>
                <td colSpan={4} className="fb-hrow--quiet" style={{ textAlign: "left", padding: "16px 20px" }}>
                  Nobody on the team has open tasks.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

interface RetentionRow {
  companyId: string;
  companyName: string;
  list: string;
  reason: string;
  service: { daysToRenewal: number } | null;
  quietDays: number | null;
}

export function RetentionCard() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getRenewalsAndRetention", { params: { orgSlug } });
  const lists = (q.data as unknown as { lists?: Record<string, { items: RetentionRow[] }> } | undefined)?.lists ?? {};
  const rows = [...(lists.LAPSED?.items ?? []), ...(lists.DUE_30?.items ?? []), ...(lists.GOING_QUIET?.items ?? [])].slice(0, 4);
  const kind = (r: RetentionRow) =>
    r.list === "LAPSED"
      ? { icon: "alert", tone: "red", when: r.service ? `${Math.abs(r.service.daysToRenewal)} days ago` : "lapsed" }
      : r.list === "DUE_30"
        ? { icon: "refresh", tone: "purple", when: r.service ? (r.service.daysToRenewal <= 0 ? "now" : `in ${r.service.daysToRenewal} days`) : "soon" }
        : { icon: "clock", tone: "orange", when: r.quietDays != null ? `${r.quietDays} days` : "quiet" };
  return (
    <Panel title="Dormant clients and renewals">
      {rows.map((r) => {
        const k = kind(r);
        return (
          <Link key={`${r.list}-${r.companyId}`} href={`/o/${orgSlug}/companies/${r.companyId}`} className="fb-hrow fb-hrow--link">
            <span className={`fb-tile fb-tone--${k.tone}`} aria-hidden="true">
              <HIcon name={k.icon} size={16} />
            </span>
            <span className="fb-hrow__main">
              <span className="fb-hrow__title">{r.companyName}</span>
              <span className="fb-hrow__sub fb-block">{r.reason}</span>
            </span>
            <span className={`fb-when fb-tone--${k.tone}`}>{k.when}</span>
          </Link>
        );
      })}
      {!q.isPending && rows.length === 0 ? <div className="fb-hrow fb-hrow--empty fb-hrow--quiet">No lapsed renewals or quiet customers right now.</div> : null}
    </Panel>
  );
}

export function AdoptionCard({ data }: { data: ManagementData }) {
  const a = data.adoption;
  if (!a) return null;
  const weeks = [...a.weeks].reverse();
  const max = Math.max(1, ...weeks.map((w) => w.activeUsers), a.activeMembers);
  const label = (w: { from: string }) => new Date(w.from).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
  const thisWeek = a.weeks[0];
  return (
    <ChartCard
      title="Adoption health"
      sub="From page-usage tracking · last 4 weeks"
      columns={["Week starting", "Active members", "Page views"]}
      rows={weeks.map((w) => ({ label: label(w), text: String(w.activeUsers), extra: [String(w.views)] }))}
      summary={`Active members each week, oldest first: ${weeks.map((w) => `${label(w)} ${w.activeUsers}`).join(", ")}. This week ${thisWeek?.activeUsers ?? 0} of ${a.activeMembers} members.`}
    >
      <div className="fb-cols" style={{ height: 96 }}>
        {weeks.map((w, i) => (
          <div key={w.from} className="fb-cols__col">
            <span className="fb-cols__n">{w.activeUsers}</span>
            <div className="fb-cols__bar" data-current={i === weeks.length - 1 ? "true" : undefined} style={{ height: `${Math.max(4, (w.activeUsers / max) * 100)}%` }} />
            <span className="fb-cols__label">{i === weeks.length - 1 ? "THIS WEEK" : label(w)}</span>
          </div>
        ))}
      </div>
      <div className="fb-tiles2">
        <div className="fb-tiles2__t">
          <div className="fb-tiles2__n">
            {thisWeek?.activeUsers ?? 0} of {a.activeMembers}
          </div>
          <div className="fb-tiles2__l">members active this week</div>
        </div>
        <div className="fb-tiles2__t">
          <div className="fb-tiles2__n">{Math.round(a.rate * 100)}%</div>
          <div className="fb-tiles2__l">of members used the CRM in the last 4 weeks</div>
        </div>
      </div>
    </ChartCard>
  );
}

const FIRST_RUN = [
  { key: "invite", label: "Invite your team", path: "/settings" },
  { key: "import", label: "Import existing data", path: "/settings" },
  { key: "website", label: "Connect the website form", path: "/settings" },
  { key: "mobile", label: "Install on your phone", path: "" },
] as const;

/** The design's first-run checklist. The ticks live on this device (the app cannot tell whether a phone installed it). */
export function FirstRunChecklist() {
  const { orgSlug, membershipId } = useMember();
  const key = `figbloom-firstrun:${orgSlug}:${membershipId}`;
  const [state, setState] = useState<{ done: string[]; hidden: boolean } | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setState(raw ? JSON.parse(raw) : { done: [], hidden: false });
    } catch {
      setState({ done: [], hidden: false });
    }
  }, [key]);
  if (!state || state.hidden || state.done.length >= FIRST_RUN.length) return null;
  const save = (next: { done: string[]; hidden: boolean }) => {
    setState(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* the checklist simply forgets */
    }
  };
  const tick = (k: string) => save({ ...state, done: state.done.includes(k) ? state.done : [...state.done, k] });
  const done = state.done.length;
  return (
    <section className="fb-firstrun" aria-label="First-run checklist">
      <div className="fb-firstrun__lead">
        <div className="fb-firstrun__title">Get Figbloom ready for the team</div>
        <div className="fb-hp__sub">{done} of 4 done. Each step takes a few minutes.</div>
        <div className="fb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done} aria-label="Setup progress">
          <div style={{ width: `${done * 25}%` }} />
        </div>
      </div>
      <div className="fb-firstrun__steps">
        {FIRST_RUN.map((s) => {
          const on = state.done.includes(s.key);
          const inner = (
            <>
              <span className="fb-firstrun__dot" data-on={on ? "true" : undefined}>
                {on ? <HIcon name="check" size={12} stroke={3} /> : null}
              </span>
              {s.label}
              {on ? <span className="fb-sr-only"> (done)</span> : null}
            </>
          );
          return s.path ? (
            <Link key={s.key} href={`/o/${orgSlug}${s.path}`} className="fb-firstrun__step" data-on={on ? "true" : undefined} onClick={() => tick(s.key)}>
              {inner}
            </Link>
          ) : (
            <button key={s.key} type="button" className="fb-firstrun__step" data-on={on ? "true" : undefined} onClick={() => tick(s.key)}>
              {inner}
            </button>
          );
        })}
      </div>
      <button type="button" className="fb-iconbtn" aria-label="Hide checklist" onClick={() => save({ ...state, hidden: true })}>
        <HIcon name="x" size={15} />
      </button>
    </section>
  );
}

/* Delivery (D3) -------------------------------------------------------------------------------------------------------------------- */

interface HandoffRow {
  id: string;
  dealId: string;
  status: "AWAITING_OWNER" | "ONBOARDING" | "DELIVERED";
  company: { id: string; name: string };
  service: { name: string } | null;
  deliveryOwner: { name: string | null } | null;
  startDate: string | null;
}

export function deliveryKpis(orgSlug: string, d: DeliveryData, openTasks: number | null): KpiDef[] {
  return [
    { key: "awaiting", label: "Handoffs needing an owner", value: d.awaitingOwner, sub: "won deals not yet picked up", icon: "package", tone: "blue", href: `/o/${orgSlug}/handoffs` },
    { key: "mine", label: "My onboardings", value: d.mine.onboarding, sub: "customers you are onboarding", icon: "calendar", tone: "orange", href: `/o/${orgSlug}/handoffs` },
    { key: "tasks", label: "My open tasks", value: openTasks ?? "…", sub: "assigned to you", icon: "tasks", tone: "green", href: `/o/${orgSlug}/tasks` },
    { key: "active", label: "Active onboardings", value: d.onboardingInProgress, sub: "customers in onboarding", icon: "building", tone: "purple", href: `/o/${orgSlug}/handoffs` },
  ];
}

export function HandedOff() {
  const { orgSlug, timeZone } = useMember();
  const q = useApiQuery("getHandoffs", { params: { orgSlug }, query: { pageSize: "8" } });
  const rows = ((q.data?.items ?? []) as unknown as HandoffRow[]).filter((h) => h.status !== "DELIVERED").slice(0, 5);
  return (
    <Panel title="Handed off to Delivery" action={{ label: "All handoffs", href: `/o/${orgSlug}/handoffs` }}>
      {rows.map((h) => {
        const needs = h.status === "AWAITING_OWNER";
        return (
          <div className="fb-hrow fb-hrow--roomy" key={h.id}>
            <span className="fb-tile fb-tile--lg fb-tone--blue" aria-hidden="true">
              <HIcon name="package" size={18} />
            </span>
            <div className="fb-hrow__main">
              <Link href={`/o/${orgSlug}/handoffs`} className="fb-linkname fb-linkname--bold">
                {h.company.name}
              </Link>
              <div className="fb-hrow__sub fb-hrow__sub--2">
                {h.service?.name ?? "Service"}
                {h.startDate ? ` · starts ${new Date(h.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: timeZone ?? undefined })}` : ""}
              </div>
            </div>
            <span className={`fb-pill ${needs ? "fb-tone--orange" : "fb-tone--blue"}`}>{needs ? "Needs an owner" : "Onboarding"}</span>
          </div>
        );
      })}
      {!q.isPending && rows.length === 0 ? <div className="fb-hrow fb-hrow--empty fb-hrow--quiet">No open handoffs.</div> : null}
    </Panel>
  );
}

/** The count of open tasks for a KPI: everything not done, from the same groups the Tasks page uses. */
export function useOpenTaskCount(): number | null {
  const { orgSlug } = useMember();
  const q = useApiQuery("getTasksGroups", { params: { orgSlug }, query: { pageSize: "1", groups: "OVERDUE,TODAY,THIS_WEEK,LATER,NO_DATE" } });
  if (!q.data) return null;
  const c = q.data.counts;
  return c.OVERDUE + c.TODAY + c.THIS_WEEK + c.LATER + c.NO_DATE;
}

/* Finance (D3) --------------------------------------------------------------------------------------------------------------------- */

interface PaymentRow {
  dealId: string;
  companyName: string;
  serviceName: string | null;
  dealValue: string | null;
  currency: string;
  received: string | null;
  outstanding: string | null;
  state: "NOT_INVOICED" | "AWAITING_PAYMENT" | "OVERDUE" | "PAID_IN_FULL";
  nextNote: string | null;
}

const PAY_STATE: Record<PaymentRow["state"], { label: string; tone: string }> = {
  NOT_INVOICED: { label: "To invoice", tone: "blue" },
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "orange" },
  OVERDUE: { label: "Overdue", tone: "red" },
  PAID_IN_FULL: { label: "Paid in full", tone: "green" },
};

export function useWonDealPayments() {
  const { orgSlug } = useMember();
  const q = useApiQuery("listWonDealPayments", { params: { orgSlug }, query: { pageSize: "100" } });
  return { rows: (q.data?.items ?? []) as unknown as PaymentRow[], loading: q.isPending };
}

export function financeKpis(f: FinanceData, rows: PaymentRow[], loading: boolean): KpiDef[] {
  const pay = f.payments;
  const sum = (list: PaymentRow[], pick: (r: PaymentRow) => string | null) => list.reduce((n, r) => n + Number(pick(r) ?? 0), 0);
  const notInvoiced = rows.filter((r) => r.state === "NOT_INVOICED");
  const awaiting = rows.filter((r) => r.state === "AWAITING_PAYMENT" || r.state === "OVERDUE");
  const cur = rows[0]?.currency ?? "KES";
  return [
    { key: "to-invoice", label: "Won, not yet invoiced", value: loading ? "…" : notInvoiced.length, sub: loading ? "" : `${moneyShort(sum(notInvoiced, (r) => r.dealValue), cur)} to invoice`, icon: "file", tone: "blue" },
    { key: "awaiting", label: "Awaiting payment", value: loading ? "…" : awaiting.length, sub: loading ? "" : `${moneyShort(sum(awaiting, (r) => r.outstanding), cur)} outstanding`, icon: "clock", tone: "orange" },
    { key: "overdue", label: "Overdue payments", value: pay.overdue.count, sub: `${moneyShort(pay.overdue.outstanding, cur)} overdue`, icon: "alert", tone: "red", alertWhenPositive: true, numeric: pay.overdue.count },
    { key: "collected", label: "Collected this month", value: moneyShort(pay.collectedThisMonth.amount, cur), sub: `${pay.collectedThisMonth.count} payments received`, icon: "banknote", tone: "green" },
  ];
}

export function WonDealsTable({ rows, loading }: { rows: PaymentRow[]; loading: boolean }) {
  return (
    <Panel title="Won deals · invoice and payment status" sub="A light tracker. Invoicing and payments happen in your accounting tools.">
      <div className="fb-hscroll">
        <table className="fb-htable fb-htable--fin">
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>
                Customer
              </th>
              <th scope="col">Contract</th>
              <th scope="col">Paid</th>
              <th scope="col" style={{ textAlign: "left" }}>
                Status
              </th>
              <th scope="col" style={{ textAlign: "left" }}>
                Next
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = PAY_STATE[r.state];
              return (
                <tr key={r.dealId}>
                  <th scope="row" style={{ textAlign: "left" }}>
                    <div>{r.companyName}</div>
                    <div className="fb-hrow__sub">{r.serviceName}</div>
                  </th>
                  <td>{r.dealValue === null ? <MaskedValue reason={MASK_REASON} /> : money(r.dealValue, r.currency)}</td>
                  <td>{r.received === null ? <MaskedValue reason={MASK_REASON} /> : money(r.received, r.currency)}</td>
                  <td style={{ textAlign: "left" }}>
                    <span className={`fb-pill fb-tone--${s.tone}`}>{s.label}</span>
                  </td>
                  <td style={{ textAlign: "left", color: "var(--text-2)" }}>{r.nextNote ?? "—"}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="fb-hrow--quiet" style={{ textAlign: "left", padding: "16px 20px" }}>
                  No won deals yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* Technical (D3) ------------------------------------------------------------------------------------------------------------------- */

const PRIORITY: Record<string, { tone: string; label: string }> = {
  HIGH: { tone: "red", label: "High" },
  MEDIUM: { tone: "orange", label: "Medium" },
  LOW: { tone: "green", label: "Low" },
};
const STATUS_LABEL: Record<string, string> = { PENDING: "To do", IN_PROGRESS: "In progress", COMPLETED: "Done", CANCELLED: "Cancelled" };

export function technicalKpis(orgSlug: string, t: TechnicalData): KpiDef[] {
  const c = t.counts;
  const open = c.OVERDUE + c.TODAY + c.THIS_WEEK + c.LATER + c.NO_DATE;
  return [
    { key: "assigned", label: "Assigned to me", value: open, sub: "open tasks", icon: "tasks", tone: "green", href: `/o/${orgSlug}/tasks` },
    { key: "week", label: "Due this week", value: c.TODAY + c.THIS_WEEK, sub: "by the end of the week", icon: "calendar", tone: "orange", href: `/o/${orgSlug}/tasks` },
    { key: "overdue", label: "Overdue", value: c.OVERDUE, sub: c.OVERDUE ? "needs a look" : "all clear", icon: "alert", tone: "red", href: `/o/${orgSlug}/tasks`, alertWhenPositive: true, numeric: c.OVERDUE },
  ];
}

export function TechnicalWork() {
  const { orgSlug, timeZone, hour12 } = useMember();
  const q = useApiQuery("getMyWork", { params: { orgSlug }, query: { groups: "OVERDUE,TODAY,THIS_WEEK,LATER", pageSize: "20" } });
  const complete = useCompleteTask();
  const tasks = ((q.data?.groups ?? []) as { items: TaskItem[] }[]).flatMap((g) => g.items);
  return (
    <div className="fb-tech">
      {tasks.map((t) => {
        const due = dueLabel(t.dueAt, { timeZone, hour12 });
        const p = PRIORITY[t.priority] ?? PRIORITY.MEDIUM!;
        const req = (t.requirements ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        return (
          <section key={t.id} className="fb-hp fb-techcard" aria-label={t.title}>
            <button type="button" className="fb-tick fb-tick--top" aria-label={`Mark done: ${t.title}`} onClick={() => void complete(t)} />
            <div className="fb-techcard__main">
              <div className="fb-techcard__head">
                <strong>{t.title}</strong>
                <span className={`fb-pill fb-pill--sm fb-tone--${p.tone}`}>{p.label}</span>
                <span className="fb-pill fb-pill--sm">{STATUS_LABEL[t.status] ?? t.status}</span>
              </div>
              <div className="fb-due fb-due--lg" data-state={due.state}>
                {due.text} · for {t.link?.label ?? "internal"}
              </div>
              {t.description ? <p className="fb-techcard__desc">{t.description}</p> : null}
              <div className="fb-reqbox">
                <div className="fb-reqbox__eyebrow">CLIENT REQUIREMENTS FOR THIS WORK</div>
                <ul>
                  {(req.length ? req : ["No requirements attached yet"]).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export { SectionFailed, pct };
