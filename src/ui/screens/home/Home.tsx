"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { describeError } from "../../errors";
import { NoAccess } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { demoScreensEnabledClient } from "../../demo/enabled";
import { SupportHome } from "./SupportHome";
import { HCols, HIcon, KpiGrid, Panel, SectionFailed, type KpiDef } from "./kit";
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
import { LoaderBlock } from "../../components/loader";

type Kind = "management" | "sales" | "delivery" | "finance" | "technical" | "support";

interface Quick {
  key: string;
  label: string;
  icon: string;
  href: string;
  primary?: boolean;
}

const COPY: Record<Kind, { scope: string; scopeTone: "organisation" | "read-only" | "mine"; subtitle: string }> = {
  management: { scope: "Whole team", scopeTone: "organisation", subtitle: "Here’s your team’s pipeline and follow-up health." },
  sales: { scope: "My work", scopeTone: "mine", subtitle: "Here’s what needs you today." },
  delivery: { scope: "Delivery view", scopeTone: "read-only", subtitle: "Here’s the won work coming your way." },
  finance: { scope: "Finance view", scopeTone: "read-only", subtitle: "Here’s the won value and what’s still to collect." },
  technical: { scope: "Assigned to me", scopeTone: "mine", subtitle: "Here are the tasks assigned to you." },
  support: { scope: "My work", scopeTone: "mine", subtitle: "Here are your maintenance clients and open tickets." },
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
  return `${now.toLocaleDateString("en-GB", { weekday: "long", timeZone: tz })} ${now.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: tz })}`;
}

/** "Good morning" / "Good afternoon" / "Good evening" by the hour in the member's own time zone. */
export function greetingFor(timeZone: string | null, now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timeZone ?? undefined }).format(now)) % 24;
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
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

  // D-02: the proposed Customer Support role has no dashboard of its own yet; its Support workspace is on demo data and shows only where demo
  // screens are on. Everywhere else it lands on Tasks (which the role can use) and not on "no access" at its front door.
  const router = useRouter();
  const supportOnly = m.can("tickets.manage") && !m.can("leads.view.own") && !m.can("leads.view.all");
  const supportToTasks = supportOnly && !demoScreensEnabledClient() && m.can("tasks.view.own");
  useEffect(() => {
    if (supportToTasks) router.replace(`/o/${m.orgSlug}/tasks`);
  }, [supportToTasks, router, m.orgSlug]);
  if (supportToTasks) return <LoaderBlock label="Opening your tasks" />;

  // The proposed Customer Support role: tickets, no leads. It has its own home (the design's "Support"), which does not wait for the dashboard call.
  if (demoScreensEnabledClient() && m.can("tickets.manage") && !m.can("leads.view.own") && !m.can("leads.view.all")) {
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
        <Header kind={null} timeZone={m.timeZone} quick={[]} />
        <LoaderBlock label="Loading your dashboard" />
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
  const links = linksFor(kind, m.orgSlug, m.can, demoScreensEnabledClient());
  return (
    <div className="fb-home">
      <Header kind={kind} timeZone={m.timeZone} quick={quick.filter((q) => q.primary)} />
      {kind === "sales" ? <SalesHome sections={sections} retry={retry} /> : null}
      {kind === "management" ? <ManagementHome sections={sections} retry={retry} /> : null}
      {kind === "delivery" ? <DeliveryHome sections={sections} retry={retry} /> : null}
      {kind === "finance" ? <FinanceHome sections={sections} retry={retry} /> : null}
      {kind === "technical" ? <TechnicalHome sections={sections} retry={retry} /> : null}
      <QuickLinks links={links} />
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

/** The links along the foot of the page: the role's quick actions first, then the screens it works in (only what its permissions allow). */
function linksFor(kind: Kind, org: string, can: (k: string) => boolean, demo: boolean): Quick[] {
  const base = `/o/${org}`;
  const any = (...keys: string[]) => keys.some((k) => can(k));
  const out: Quick[] = [...quickFor(kind, org, can)];
  const add = (q: Quick, ok: boolean) => ok && out.push(q);
  const tasks = any("tasks.view.own", "tasks.view.all");
  const leads = any("leads.view.own", "leads.view.all", "leads.view.shared");
  const deals = any("deals.view.own", "deals.view.all", "deals.view.won");
  const dealsLabel = any("deals.view.own", "deals.view.all") ? "Deals" : "Won deals";
  if (kind === "sales" || kind === "management") {
    add({ key: "n-leads", label: "Leads", icon: "users", href: `${base}/leads` }, leads);
    add({ key: "n-deals", label: dealsLabel, icon: "briefcase", href: `${base}/deals` }, deals);
    add({ key: "n-tasks", label: "Tasks", icon: "check-square", href: `${base}/tasks` }, tasks);
    add({ key: "n-calendar", label: "Calendar", icon: "calendar", href: `${base}/calendar` }, tasks);
    add({ key: "n-forecast", label: "Forecast & targets", icon: "target", href: `${base}/forecast` }, demo && any("forecast.view.all", "quotes.create", "reporting.view.own", "reporting.view.all"));
  }
  if (kind === "delivery") {
    add({ key: "n-deals", label: dealsLabel, icon: "briefcase", href: `${base}/deals` }, deals);
    add({ key: "n-tasks", label: "Tasks", icon: "check-square", href: `${base}/tasks` }, tasks);
    add({ key: "n-handoffs", label: "Handoffs", icon: "package", href: `${base}/handoffs` }, any("handoff.manage", "deals.handoff"));
    add({ key: "n-calendar", label: "Calendar", icon: "calendar", href: `${base}/calendar` }, tasks);
  }
  if (kind === "finance") {
    add({ key: "n-deals", label: dealsLabel, icon: "briefcase", href: `${base}/deals` }, deals);
    add({ key: "n-payments", label: "Payments", icon: "wallet", href: `${base}/payments` }, can("finance.view.payments"));
    add({ key: "n-reports", label: can("reporting.view.all") ? "Reports" : "My metrics", icon: "chart", href: `${base}/reports` }, any("reporting.view.own", "reporting.view.all"));
  }
  if (kind === "technical") {
    add({ key: "n-tasks", label: "Tasks", icon: "check-square", href: `${base}/tasks` }, tasks);
    add({ key: "n-calendar", label: "Calendar", icon: "calendar", href: `${base}/calendar` }, tasks);
  }
  return out.slice(0, 8);
}

function QuickLinks({ links }: { links: Quick[] }) {
  if (links.length === 0) return null;
  return (
    <nav className="fb-qlinks-wrap" aria-label="Quick links">
      <div className="fb-qlinks__t">Quick links</div>
      <div className="fb-qlinks">
        {links.map((q) => (
          <Link key={q.key} href={q.href} className="fb-qlink">
            <span className="fb-qlink__c" aria-hidden="true">
              <HIcon name={q.icon} size={16} stroke={1.6} />
            </span>
            {q.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function Header({ kind, timeZone, quick }: { kind: Kind | null; timeZone: string | null; quick: Quick[] }) {
  const m = useMember();
  const c = kind ? COPY[kind] : { scope: "", scopeTone: "mine" as const, subtitle: "" };
  const first = m.userName.trim().split(/\s+/)[0] ?? "";
  return (
    <div className="fb-homehead">
      <div>
        <div className="fb-homehead__date">
          {dateLine(timeZone)}
          {c.scope ? <span className={`fb-scope fb-scope--${c.scopeTone}`}>{c.scope}</span> : null}
        </div>
        <h1 className="fb-homehead__title">
          {greetingFor(timeZone)}
          {first ? (
            <>
              , <b>{first}</b>.
            </>
          ) : (
            "."
          )}
        </h1>
        {c.subtitle ? <div className="fb-homehead__sub">{c.subtitle}</div> : null}
      </div>
      <div className="fb-homehead__actions">
        {quick.map((q) => (
          <Link key={q.key} href={q.href} className={`fb-qbtn ${q.primary ? "fb-qbtn--primary" : ""}`}>
            <HIcon name={q.icon} size={14} />
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
