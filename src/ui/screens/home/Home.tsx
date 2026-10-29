"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { SupportHome } from "./SupportHome";
import { HCols, HIcon, KpiGrid, KpiSkeleton, Panel, SectionFailed, type KpiDef } from "./kit";
import { NewLeadsPanel, MovingAndStalled, PipelineByStage, TodoPanel, useLastVisit, useNewLeads } from "./blocks";
import {
  AdoptionCard,
  FirstRunChecklist,
  HandedOff,
  MonthVsLast,
  RetentionCard,
  RevenueByService,
  TeamHealth,
  TechnicalWork,
  WonDealsTable,
  deliveryKpis,
  financeKpis,
  technicalKpis,
  useOpenTaskCount,
  useWonDealPayments,
} from "./roles";
import type { DeliveryData, FinanceData, ManagementData, SalesTodayData, SectionAnswer, TechnicalData } from "./dash";

type Kind = "management" | "sales" | "delivery" | "finance" | "technical" | "support";

interface Quick {
  key: string;
  label: string;
  icon: string;
  href: string;
  primary?: boolean;
}

const COPY: Record<Kind, { title: string; scope: string; scopeTone: "organisation" | "read-only" | "mine"; subtitle: string }> = {
  management: { title: "Today", scope: "Whole team", scopeTone: "organisation", subtitle: "team pipeline and follow-up health" },
  sales: { title: "Today", scope: "My work", scopeTone: "mine", subtitle: "what needs you today" },
  delivery: { title: "Today", scope: "Delivery view", scopeTone: "read-only", subtitle: "won work coming your way" },
  finance: { title: "Today", scope: "Finance view", scopeTone: "read-only", subtitle: "won value and what’s still to collect" },
  technical: { title: "My work", scope: "Assigned to me", scopeTone: "mine", subtitle: "tasks assigned to you" },
  support: { title: "Support", scope: "My work", scopeTone: "mine", subtitle: "maintenance clients and open tickets" },
};

const EMPTY: Record<Kind, { icon: string; title: string; body: string }> = {
  management: {
    icon: "user-plus",
    title: "Nothing here yet. Start with your team.",
    body: "Invite the people who sell and deliver, then connect the website form so enquiries land here as leads with an owner and a follow-up.",
  },
  sales: {
    icon: "users",
    title: "Nothing here yet. Start with your first lead.",
    body: "Add someone you spoke to this week. Only the name is required; you can qualify them later. Your follow-ups and deals will show up here every morning.",
  },
  delivery: { icon: "package", title: "No handoffs yet", body: "When Sales marks a deal won, the scope, requirements and onboarding tasks land here with a start date. Nothing to do until then." },
  finance: { icon: "wallet", title: "No won deals yet", body: "Won deals appear here with their contract amount so you can track invoices and payments. The open pipeline stays with Sales." },
  support: { icon: "help", title: "No open tickets", body: "When a maintenance client raises a ticket, it shows here with its status." },
  technical: { icon: "tasks", title: "No work assigned yet", body: "When someone assigns you a task, it shows here with the client requirements you need. You can also add tasks for yourself." },
};

function dateLine(timeZone: string | null): string {
  const now = new Date();
  const tz = timeZone ?? undefined;
  return `${now.toLocaleDateString("en-GB", { weekday: "long", timeZone: tz })}, ${now.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: tz })}`;
}

function section<T>(sections: SectionAnswer[] | undefined, key: string): { state: "absent" } | { state: "failed"; title: string; error?: string } | { state: "ok"; data: T } {
  const s = sections?.find((x) => x.key === key);
  if (!s) return { state: "absent" };
  if (!s.ok) return { state: "failed", title: s.title, error: s.error };
  return { state: "ok", data: s.data as T };
}

/**
 * The home page (D1, D2, D3): one call for the role's sections, each of which can fail on its own. What each role sees is decided by the
 * API (a section it may not have is absent, not empty); this screen only lays the sections out the way the design does.
 */
export function HomeScreen() {
  const m = useMember();
  const qc = useQueryClient();
  const dash = useApiQuery("getDashboard", { params: { orgSlug: m.orgSlug } }, { refetchInterval: 120_000 });
  const sections = dash.data?.sections as SectionAnswer[] | undefined;

  const kind: Kind | null = useMemo(() => {
    if (!sections) return null;
    const has = (k: string) => sections.some((s) => s.key === k);
    if (has("management")) return "management";
    if (has("sales_today")) return "sales";
    if (has("delivery")) return "delivery";
    if (has("finance")) return "finance";
    if (has("technical")) return "technical";
    return null;
  }, [sections]);

  const retry = () => void qc.invalidateQueries({ queryKey: ["getDashboard"] });

  // The proposed Customer Support role: tickets, no leads. It has its own home (the design's "Support"), which does not wait for the dashboard call.
  if (m.can("tickets.manage") && !m.can("leads.view.own") && !m.can("leads.view.all")) {
    return (
      <div className="fb-home">
        <Header kind="support" timeZone={m.timeZone} quick={quickFor("support", m.orgSlug, m.can)} />
        <SupportHome />
      </div>
    );
  }

  if (dash.isError) {
    const e = describeError(dash.error);
    if (e.kind === "noAccess") return <NoAccess area="The dashboard" denial={e.denial} />;
    return (
      <div className="fb-home">
        <Header kind={null} timeZone={m.timeZone} quick={[]} />
        <div role="alert" className="fb-homeerr">
          <span className="fb-homeerr__icon">
            <HIcon name="alert" size={24} />
          </span>
          <h2>We couldn’t load your dashboard</h2>
          <p>The server didn’t respond in time. Nothing you saved is lost. Try again in a moment.</p>
          {e.reference ? <p className="fb-hp__sub">Reference {e.reference}</p> : null}
          <button type="button" className="fb-btn fb-btn--primary" onClick={() => void dash.refetch()}>
            <HIcon name="refresh" size={16} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (dash.isPending || !sections) {
    return (
      <div className="fb-home" aria-busy="true">
        <span className="fb-sr-only" role="status">
          Loading your dashboard
        </span>
        <Header kind={null} timeZone={m.timeZone} quick={[]} />
        <KpiSkeleton />
      </div>
    );
  }

  if (!kind) {
    return (
      <div className="fb-home">
        <Header kind={null} timeZone={m.timeZone} quick={[]} />
        <NoAccess area="A dashboard for your role" />
      </div>
    );
  }

  const quick = quickFor(kind, m.orgSlug, m.can);
  return (
    <div className="fb-home">
      <Header kind={kind} timeZone={m.timeZone} quick={quick} />
      {kind === "sales" ? <SalesHome sections={sections} retry={retry} /> : null}
      {kind === "management" ? <ManagementHome sections={sections} retry={retry} /> : null}
      {kind === "delivery" ? <DeliveryHome sections={sections} retry={retry} /> : null}
      {kind === "finance" ? <FinanceHome sections={sections} retry={retry} /> : null}
      {kind === "technical" ? <TechnicalHome sections={sections} retry={retry} /> : null}
    </div>
  );
}

function quickFor(kind: Kind, org: string, can: (k: string) => boolean): Quick[] {
  const base = `/o/${org}`;
  const out: Quick[] = [];
  const add = (q: Quick, ok: boolean) => ok && out.push(q);
  if (kind === "sales" || kind === "management") {
    add({ key: "lead", label: "New lead", icon: "user-plus", href: `${base}/leads?new=1`, primary: true }, can("leads.create"));
    add({ key: "call", label: "Log a call", icon: "phone", href: `${base}/tasks?new=call` }, can("activities.create"));
    add({ key: "task", label: "New task", icon: "tasks", href: `${base}/tasks?new=1` }, can("tasks.create"));
    if (kind === "management") add({ key: "reports", label: "Reports", icon: "chart", href: `${base}/reports` }, true);
  }
  if (kind === "delivery") {
    add({ key: "note", label: "Log a note", icon: "file", href: `${base}/tasks?new=note`, primary: true }, can("activities.create"));
    add({ key: "task", label: "New task", icon: "tasks", href: `${base}/tasks?new=1` }, can("tasks.create"));
  }
  if (kind === "support") add({ key: "note", label: "Log a note", icon: "note", href: `${base}/conversations?log=note`, primary: true }, can("activities.create"));
  if (kind === "technical") add({ key: "task", label: "New task for myself", icon: "plus", href: `${base}/tasks?new=1`, primary: true }, can("tasks.create"));
  return out;
}

function Header({ kind, timeZone, quick }: { kind: Kind | null; timeZone: string | null; quick: Quick[] }) {
  const c = kind ? COPY[kind] : { title: "Today", scope: "", scopeTone: "mine" as const, subtitle: "" };
  return (
    <div className="fb-homehead">
      <div>
        <h1 className="fb-homehead__title">{c.title}</h1>
        <div className="fb-homehead__meta">
          {c.scope ? <span className={`fb-scope fb-scope--${c.scopeTone}`}>{c.scope}</span> : null}
          <span className="fb-homehead__sub">{kind ? `${dateLine(timeZone)} · ${c.subtitle}` : dateLine(timeZone)}</span>
        </div>
      </div>
      <div className="fb-homehead__actions">
        {quick.map((q) => (
          <Link key={q.key} href={q.href} className={`fb-qbtn ${q.primary ? "fb-qbtn--primary" : ""}`}>
            <HIcon name={q.icon} size={16} />
            {q.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function EmptyHome({ kind }: { kind: Kind }) {
  const m = useMember();
  const e = EMPTY[kind];
  const base = `/o/${m.orgSlug}`;
  const actions: Quick[] =
    kind === "management"
      ? [
          { key: "invite", label: "Invite members", icon: "user-plus", href: `${base}/settings`, primary: true },
          { key: "web", label: "Connect the website form", icon: "globe", href: `${base}/settings` },
        ]
      : kind === "sales"
        ? [
            { key: "lead", label: "Add your first lead", icon: "user-plus", href: `${base}/leads?new=1`, primary: true },
            { key: "contact", label: "Add a contact", icon: "contact", href: `${base}/contacts` },
          ]
        : kind === "technical" && m.can("tasks.create")
          ? [{ key: "task", label: "Add a task for myself", icon: "plus", href: `${base}/tasks?new=1`, primary: true }]
          : [];
  return (
    <div className="fb-homeempty">
      <span className="fb-homeempty__icon">
        <HIcon name={e.icon} size={26} />
      </span>
      <h2>{e.title}</h2>
      <p>{e.body}</p>
      {actions.length ? (
        <div className="fb-homeempty__actions">
          {actions.map((a) => (
            <Link key={a.key} href={a.href} className={`fb-qbtn fb-qbtn--lg ${a.primary ? "fb-qbtn--primary" : ""}`}>
              <HIcon name={a.icon} size={16} />
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface RoleProps {
  sections: SectionAnswer[];
  retry: () => void;
}

/* Sales (D1) ----------------------------------------------------------------------------------------------------------------------- */

function SalesHome({ sections, retry }: RoleProps) {
  const m = useMember();
  const s = section<SalesTodayData>(sections, "sales_today");
  const leads = useNewLeads();
  const since = useLastVisit(m.membershipId);
  // The design's Overdue card says how old the oldest overdue task is ("oldest 9 days"); the list comes oldest first.
  const oldest = useApiQuery("getTasksGroupsByGroup", { params: { orgSlug: m.orgSlug, group: "OVERDUE" }, query: { pageSize: "1" } });
  const oldestDue = (oldest.data?.items?.[0] as { dueAt?: string | null } | undefined)?.dueAt;
  const oldestDays = oldestDue ? Math.max(1, Math.floor((Date.now() - Date.parse(oldestDue)) / 86_400_000)) : null;
  if (s.state === "failed") return <SectionFailed title={s.title} message={s.error} onRetry={retry} />;
  if (s.state !== "ok") return null;
  const d = s.data;
  const tasks = (d.myDay.tasksOverdue ?? 0) + (d.myDay.tasksToday ?? 0);
  const fresh = since === null ? leads.rows : leads.rows.filter((r) => Date.parse(r.createdAt) > since);
  const empty = tasks === 0 && (d.pipeline?.open ?? 0) === 0 && !leads.loading && leads.rows.length === 0 && (d.hotLeads?.count ?? 0) === 0;
  if (empty) return <EmptyHome kind="sales" />;
  const kpis: KpiDef[] = [
    { key: "today", label: "Follow-ups due today", value: d.myDay.tasksToday ?? 0, sub: "tasks and lead follow-ups", icon: "calendar", tone: "orange", href: `/o/${m.orgSlug}/tasks` },
    {
      key: "overdue",
      label: "Overdue",
      value: d.myDay.tasksOverdue ?? 0,
      sub: (d.myDay.tasksOverdue ?? 0) ? (oldestDays ? `oldest ${oldestDays} day${oldestDays === 1 ? "" : "s"}` : "needs a look") : "all clear",
      icon: "alert",
      tone: "red",
      href: `/o/${m.orgSlug}/tasks`,
      alertWhenPositive: true,
      numeric: d.myDay.tasksOverdue ?? 0,
    },
    { key: "new", label: "New leads since last visit", value: leads.loading ? "…" : fresh.length >= 20 ? "20+" : fresh.length, sub: "yours and the shared pool", icon: "users", tone: "blue", href: `/o/${m.orgSlug}/leads` },
    { key: "stalled", label: "Stalled deals", value: d.stalledDeals ?? 0, sub: "no activity for 10+ days", icon: "briefcase", tone: "orange", href: `/o/${m.orgSlug}/deals` },
  ];
  return (
    <>
      <KpiGrid items={kpis} />
      <HCols
        left={[<TodoPanel key="todo" />, ...(d.pipeline ? [<PipelineByStage key="pipe" />] : [])]}
        right={[<NewLeadsPanel key="new" rows={leads.rows} since={since} />, ...(d.pipeline ? [<MovingAndStalled key="moving" />] : [])]}
      />
    </>
  );
}

/* Management (D2) ------------------------------------------------------------------------------------------------------------------ */

function ManagementHome({ sections, retry }: RoleProps) {
  const m = useMember();
  const s = section<ManagementData>(sections, "management");
  const leads = useNewLeads();
  const since = useLastVisit(m.membershipId);
  if (s.state === "failed") return <SectionFailed title={s.title} message={s.error} onRetry={retry} />;
  if (s.state !== "ok") return null;
  const d = s.data;
  const open = d.teamWorkload.reduce((n, p) => n + p.openTasks, 0);
  const overdue = d.overdueByOwner.tasks?.total ?? d.teamWorkload.reduce((n, p) => n + p.overdueTasks, 0);
  const stalled = d.overdueByOwner.stalledDeals?.total ?? 0;
  const fresh = since === null ? leads.rows : leads.rows.filter((r) => Date.parse(r.createdAt) > since);
  const nothing = d.thisMonth.metrics.leadConversion.total === 0 && open === 0 && stalled === 0 && !leads.loading && leads.rows.length === 0;
  if (nothing) return <EmptyHome kind="management" />;
  const kpis: KpiDef[] = [
    { key: "open", label: "Open tasks", value: open, sub: "across the team", icon: "calendar", tone: "orange", href: `/o/${m.orgSlug}/tasks` },
    { key: "overdue", label: "Overdue", value: overdue, sub: overdue ? "across the team" : "all clear", icon: "alert", tone: "red", href: `/o/${m.orgSlug}/tasks`, alertWhenPositive: true, numeric: overdue },
    { key: "new", label: "New leads since last visit", value: leads.loading ? "…" : fresh.length >= 20 ? "20+" : fresh.length, sub: "organisation-wide", icon: "users", tone: "blue", href: `/o/${m.orgSlug}/leads` },
    { key: "stalled", label: "Stalled deals", value: stalled, sub: "no activity for 10+ days", icon: "briefcase", tone: "orange", href: `/o/${m.orgSlug}/deals` },
  ];
  return (
    <>
      <FirstRunChecklist />
      <KpiGrid items={kpis} />
      <HCols
        left={[<TodoPanel key="todo" showOwner />, <PipelineByStage key="pipe" />]}
        right={[<NewLeadsPanel key="new" rows={leads.rows} since={since} />, <MovingAndStalled key="moving" showOwner />]}
      />
      <MonthVsLast data={d} />
      <HCols left={[<RevenueByService key="rev" data={d} />, <RetentionCard key="ret" />]} right={[<TeamHealth key="team" data={d} />, <AdoptionCard key="adopt" data={d} />]} />
    </>
  );
}

/* Delivery, Finance, Technical (D3) --------------------------------------------------------------------------------------------------- */

function DeliveryHome({ sections, retry }: RoleProps) {
  const m = useMember();
  const s = section<DeliveryData>(sections, "delivery");
  const open = useOpenTaskCount();
  if (s.state === "failed") return <SectionFailed title={s.title} message={s.error} onRetry={retry} />;
  if (s.state !== "ok") return null;
  const d = s.data;
  if (d.awaitingOwner + d.onboardingInProgress + d.delivered === 0 && open === 0) return <EmptyHome kind="delivery" />;
  return (
    <>
      <KpiGrid items={deliveryKpis(m.orgSlug, d, open)} />
      <div className="fb-hgrid fb-hgrid--wide">
        <HandedOff />
        <TodoPanel title="My tasks" groups={["OVERDUE", "TODAY", "THIS_WEEK"]} emptyText="No open tasks." bare />
      </div>
    </>
  );
}

function FinanceHome({ sections, retry }: RoleProps) {
  const s = section<FinanceData>(sections, "finance");
  const pay = useWonDealPayments();
  if (s.state === "failed") return <SectionFailed title={s.title} message={s.error} onRetry={retry} />;
  if (s.state !== "ok") return null;
  if (s.data.wonDeals === 0) return <EmptyHome kind="finance" />;
  return (
    <>
      <KpiGrid items={financeKpis(s.data, pay.rows, pay.loading)} />
      <WonDealsTable rows={pay.rows} loading={pay.loading} />
    </>
  );
}

function TechnicalHome({ sections, retry }: RoleProps) {
  const m = useMember();
  const s = section<TechnicalData>(sections, "technical");
  if (s.state === "failed") return <SectionFailed title={s.title} message={s.error} onRetry={retry} />;
  if (s.state !== "ok") return null;
  const c = s.data.counts;
  if (c.OVERDUE + c.TODAY + c.THIS_WEEK + c.LATER + c.NO_DATE === 0) return <EmptyHome kind="technical" />;
  return (
    <>
      <KpiGrid items={technicalKpis(m.orgSlug, s.data)} />
      <div className="fb-infobar">
        <HIcon name="info" size={17} />
        <span>
          You see the tasks assigned to you and the client requirements that go with them. Your access to client data is logged in the audit history. Need
          context on something else? Ask your organisation’s Management.
        </span>
      </div>
      <TechnicalWork />
    </>
  );
}

export { Panel };
