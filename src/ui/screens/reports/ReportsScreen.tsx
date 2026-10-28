"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { describeError } from "../../errors";
import { Button } from "../../components/basics";
import { NoAccess } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { MyMetricsScreen } from "../home/MyMetrics";
import { HIcon, Seg } from "../home/kit";
import { moneyShort } from "../home/format";
import { useReference } from "../leads/data";
import { CustomersDetail, RenewalsDetail, SalespersonDetail } from "./CustomerReports";
import { ReportCard } from "./ReportCard";
import { barRows, isChartable, PERIODS, percentOf, rangeFor, tableCells, type PeriodId, type ReportData } from "./model";

const SECTIONS: { label: string; keys: string[] }[] = [
  { label: "LEADS", keys: ["LEAD_SOURCES", "CONVERSION_BY_STAGE", "CONVERSION_BY_SOURCE"] },
  { label: "PIPELINE", keys: ["PIPELINE_BY_STAGE", "LOST_REASONS"] },
  { label: "SALES", keys: ["PER_PERSON", "MONTH_VS_LAST"] },
  { label: "CUSTOMERS", keys: ["CUSTOMERS", "RENEWALS"] },
];

const SUBTITLE: Record<string, string> = {
  LEAD_SOURCES: "Where new leads came from",
  CONVERSION_BY_STAGE: "Where leads sit now, and how many became deals",
  CONVERSION_BY_SOURCE: "Share of each source's leads that became deals",
  PIPELINE_BY_STAGE: "Open deals, live",
  LOST_REASONS: "Why deals were lost",
  PER_PERSON: "Leads, conversion, won value and tasks per person",
  MONTH_VS_LAST: "This month so far against last month",
  CUSTOMERS: "Lifecycle today",
  RENEWALS: "Recurring services by renewal state",
};

/** A bar keeps its colour for the thing it stands for, never for its rank. The label is always written beside it. */
const IDENTITY: Record<string, Record<string, string>> = {
  CUSTOMERS: { Active: "var(--primary)", Repeat: "var(--purple)", Dormant: "var(--orange)" },
  RENEWALS: { Active: "var(--primary)", "Due soon": "var(--orange)", Lapsed: "var(--red)", "Starts later": "var(--text-3)" },
};
function colourFor(key: string): ((label: string) => string) | undefined {
  if (key === "LOST_REASONS") return () => "var(--red)";
  const map = IDENTITY[key];
  return map ? (label) => map[label] ?? "var(--primary)" : undefined;
}

const FOLLOW_UP_LABEL: Record<string, string> = { COMPLETED: "Completed", IN_PROGRESS: "In progress", PENDING: "Pending", CANCELLED: "Cancelled" };
const FOLLOW_UP_ORDER = ["COMPLETED", "IN_PROGRESS", "PENDING", "CANCELLED"];

/**
 * Reports (R1, FIG-1101). Management reads the whole organisation: what needs attention now, the headline figures for the chosen range, and one
 * card per report that reads as a chart or a table, with a CSV. Roles that only see their own work get My metrics; a role with no reporting
 * permission gets the explained no-access. Numbers are the API's, never recomputed here; restricted figures come back hidden and stay hidden.
 */
export function ReportsScreen() {
  const { can, roleName } = useMember();
  if (can("reporting.view.all")) return <OrganisationReports />;
  if (can("reporting.view.own")) return <MyMetricsScreen />;
  return (
    <div className="fb-rep" data-screen-label="Reports">
      <h1 className="fb-rep__title">Reports</h1>
      <NoAccess area="Reports" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales", "Delivery", "Finance"], whoToAsk: ["Your Management lead"] }} />
    </div>
  );
}

interface Filters {
  ownerMembershipId: string;
  leadSourceId: string;
  pipelineStageId: string;
  serviceId: string;
}
const NO_FILTERS: Filters = { ownerMembershipId: "", leadSourceId: "", pipelineStageId: "", serviceId: "" };

function OrganisationReports() {
  const { orgSlug, can } = useMember();
  const ref = useReference();
  const refData = useApiQuery("getReferenceData", { params: { orgSlug } }, { staleTime: 5 * 60_000 });
  const [period, setPeriod] = useState<PeriodId>("30");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // The range is fixed when a period is chosen: a range that moved with every render would never settle in the cache.
  const range = useMemo(() => rangeFor(period), [period]);
  const filterQuery = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);

  const work = useApiQuery("getReportsMyWork", { params: { orgSlug } });
  const org = useApiQuery("getReportsOrganization", { params: { orgSlug }, query: { ...range, ...filterQuery } as never }, { placeholderData: (prev) => prev });
  const v2 = useApiQuery("getReportsV2", { params: { orgSlug }, query: range });

  const rangeLabel = `${new Date(range.dateFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} to ${new Date(range.dateTo).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
  const qs = new URLSearchParams({ ...range, ...filterQuery }).toString();

  const header = (
    <div className="fb-rep__head">
      <div>
        <h1 className="fb-rep__title">Reports</h1>
        <div className="fb-rep__sub">How the whole organization is performing.</div>
        <div className="fb-rep__meta">
          <span className="fb-scope fb-scope--organisation">Organisation reports</span>
          <span className="fb-rep__sub">Covers all leads, all deals, all tasks.</span>
        </div>
      </div>
      {can("export.bulk") ? (
        <a className="fb-rep__export" href={`/api/orgs/${orgSlug}/reports/export?${qs}`} download>
          <HIcon name="file" size={16} />
          Export CSV
        </a>
      ) : null}
    </div>
  );

  const failure = v2.isError ? v2.error : org.isError ? org.error : null;
  if (failure) {
    const e = describeError(failure);
    return (
      <div className="fb-rep" data-screen-label="Reports">
        {header}
        {e.kind === "noAccess" ? (
          <NoAccess area="Reports" denial={e.denial} />
        ) : (
          <div role="alert" className="fb-rep__state">
            <div className="fb-rep__statetitle">Reports didn’t load</div>
            <Button variant="primary" onClick={() => { void v2.refetch(); void org.refetch(); }}>Retry</Button>
          </div>
        )}
      </div>
    );
  }

  const d = org.data;
  const masked = d?.valueMasked ?? false;
  const reports = ((v2.data?.reports ?? []) as unknown as ReportData[]).filter(Boolean);
  const byKey = new Map(reports.map((r) => [r.key, r]));
  const loading = org.isPending || v2.isPending;

  // Headline figures: the API's numbers for the range and the filters.
  const conv = d?.leadConversion;
  const won = d?.dealOutcomes?.won;
  const lost = d?.dealOutcomes?.lost;
  const openDeals = d?.pipelineByStage?.reduce((n, r) => n + r._count._all, 0) ?? 0;
  const openValue = d?.pipelineByStage?.reduce((n, r) => n + Number(r._sum.value ?? 0), 0) ?? 0;
  const fu = d?.followUpBreakdown ?? [];
  const fuCount = (s: string) => fu.find((r) => r.status === s)?._count._all ?? 0;
  const fuActive = fu.reduce((n, r) => n + r._count._all, 0) - fuCount("CANCELLED");
  const kpis = d
    ? [
        { key: "leads", label: "Leads created", value: String(conv?.total ?? 0), sub: "in the selected range", dot: "var(--blue)" },
        { key: "conversion", label: "Conversion", value: `${percentOf(conv?.converted ?? 0, conv?.total ?? 0)}%`, sub: `${conv?.converted ?? 0} of ${conv?.total ?? 0} converted`, dot: "var(--primary)" },
        { key: "won", label: "Won deals", value: String(won?.count ?? 0), sub: masked ? "value hidden" : `value ${moneyShort(Number(won?.value ?? 0))}`, dot: "var(--primary)" },
        { key: "winrate", label: "Win rate", value: `${percentOf(won?.count ?? 0, (won?.count ?? 0) + (lost?.count ?? 0))}%`, sub: `${won?.count ?? 0} won · ${lost?.count ?? 0} lost`, dot: "var(--purple)" },
        { key: "pipeline", label: "Open pipeline", value: masked ? "Hidden" : moneyShort(openValue), sub: `across ${openDeals} open deals`, dot: "var(--orange)" },
        { key: "followups", label: "Follow-ups done", value: `${percentOf(fuCount("COMPLETED"), fuActive)}%`, sub: `${fuCount("COMPLETED")} of ${fuActive} tasks due in range`, dot: "var(--blue)" },
      ]
    : [];

  const empty =
    !loading &&
    (conv?.total ?? 0) === 0 &&
    (won?.count ?? 0) + (lost?.count ?? 0) === 0 &&
    openDeals === 0 &&
    reports.every((r) => r.table.rows.every((row) => Object.entries(row).every(([k, v]) => k === "label" || !v)));

  const tiles = [
    { key: "overdue", label: "Overdue tasks", n: work.data?.overdue.length ?? 0, sub: "past their due time", icon: "tasks", tone: "red", href: `/o/${orgSlug}/tasks?view=overdue`, alert: true },
    { key: "today", label: "Due today", n: work.data?.dueToday.length ?? 0, sub: "open follow-ups for today", icon: "calendar", tone: "orange", href: `/o/${orgSlug}/tasks?view=today` },
    { key: "newleads", label: "New leads", n: work.data?.newLeads.length ?? 0, sub: "created in the last 7 days", icon: "users", tone: "blue", href: `/o/${orgSlug}/leads` },
    { key: "stalled", label: "Stalled deals", n: work.data?.stalledDeals.length ?? 0, sub: "no activity for too long", icon: "briefcase", tone: "orange", href: `/o/${orgSlug}/deals` },
  ];

  const select = (name: keyof Filters, label: string, options: { value: string; label: string }[]) => (
    <select aria-label={label} value={filters[name]} onChange={(e) => setFilters((f) => ({ ...f, [name]: e.target.value }))} className="fb-rep__select">
      <option value="">{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="fb-rep" data-screen-label="Reports">
      {header}

      {!work.isError && !work.isPending ? (
        <>
          <div className="fb-rep__eyebrow">NEEDS ATTENTION<span className="fb-rep__rule" /></div>
          <div className="fb-rep__tiles">
            {tiles.map((t) => (
              <Link key={t.key} href={t.href} className="fb-rep__tile" data-testid={`attention-${t.key}`}>
                <div className="fb-rep__tiletop">
                  <span className="fb-rep__tilel">{t.label}</span>
                  <span className={`fb-rep__tilei fb-rep__tilei--${t.tone}`} aria-hidden="true"><HIcon name={t.icon} size={18} /></span>
                </div>
                <div className="fb-rep__tilen" data-alert={t.alert && t.n > 0 ? "true" : undefined}>{t.n}</div>
                <div className="fb-rep__tiles2">{t.sub}</div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="fb-rep__eyebrow">PERFORMANCE<span className="fb-rep__rule" /></div>
      <div className="fb-rep__filters">
        <Seg label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label }))} />
        {select("ownerMembershipId", "Any owner", ref.owners.map((o) => ({ value: o.membershipId, label: o.name })))}
        {select("leadSourceId", "Any source", ref.sources.map((s) => ({ value: s.id, label: s.name })))}
        {select("pipelineStageId", "Any stage", (refData.data?.pipelineStages ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })))}
        {select("serviceId", "Any service", ref.services.map((s) => ({ value: s.id, label: s.name })))}
      </div>
      <div className="fb-rep__range">
        Showing {rangeLabel}. Open pipeline is always a live snapshot.{" "}
        {Object.keys(filterQuery).length > 0 ? "Owner, source, stage and service filters apply to the headline figures; the report cards follow the date range." : ""}
      </div>

      {loading ? (
        <div aria-busy="true">
          <span className="fb-sr-only" role="status">Loading reports</span>
          <div className="fb-rep__kpis">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="fb-rep__skel" style={{ height: 104 }} />)}
          </div>
        </div>
      ) : empty ? (
        <div className="fb-rep__state" role="status">
          <div className="fb-rep__stateicon"><HIcon name="chart" size={26} /></div>
          <div className="fb-rep__statetitle">Not enough data yet</div>
          <div className="fb-rep__statebody">Reports fill in once leads and deals start moving. Check back after your first week.</div>
        </div>
      ) : (
        <>
          <div className="fb-rep__kpis">
            {kpis.map((k) => (
              <div key={k.key} className="fb-rep__kpi" data-testid={`kpi-${k.key}`}>
                <div className="fb-rep__kpil"><span className="fb-rep__dot" style={{ background: k.dot }} aria-hidden="true" />{k.label}</div>
                <div className="fb-rep__kpiv">{k.value}</div>
                <div className="fb-rep__kpis2">{k.sub}</div>
              </div>
            ))}
          </div>

          {SECTIONS.map((sec) => {
            const cards = sec.keys.map((k) => byKey.get(k)).filter((r): r is ReportData => Boolean(r));
            if (cards.length === 0) return null;
            return (
              <div key={sec.label} className="fb-rep__section">
                <div className="fb-rep__eyebrow">{sec.label}<span className="fb-rep__rule" /></div>
                <div className="fb-rep__grid">
                  {cards.map((r) => {
                    const cells = tableCells(r.table.columns, r.table.rows, r.table.totals, r.valueMasked);
                    return (
                      <ReportCard
                        key={r.key}
                        id={r.key.toLowerCase()}
                        title={r.title}
                        sub={SUBTITLE[r.key] ?? r.definition}
                        columns={r.table.columns}
                        cells={cells}
                        hasTotals={Boolean(r.table.totals)}
                        bars={isChartable(r) ? barRows(r) : undefined}
                        colourFor={colourFor(r.key)}
                        csv={can("export.bulk") ? { href: `/api/orgs/${orgSlug}/reports/v2/${r.key}/export?${new URLSearchParams(range).toString()}`, filename: `${r.key.toLowerCase()}.csv` } : null}
                        footer={<p className="fb-rep__def">{r.definition}</p>}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {fuActive + fuCount("CANCELLED") > 0 ? (
            <div className="fb-rep__section">
              <div className="fb-rep__eyebrow">FOLLOW-UP PERFORMANCE<span className="fb-rep__rule" /></div>
              <div className="fb-rep__grid">
                <FollowUps breakdown={fu} />
              </div>
            </div>
          ) : null}

          <div className="fb-rep__section">
            <div className="fb-rep__eyebrow">CUSTOMER REPORTS<span className="fb-rep__rule" /></div>
            <div className="fb-rep__grid">
              <CustomersDetail />
              <RenewalsDetail />
              <SalespersonDetail dateFrom={range.dateFrom} dateTo={range.dateTo} rangeLabel={rangeLabel} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FollowUps({ breakdown }: { breakdown: { status: string; _count: { _all: number } }[] }) {
  const rows = FOLLOW_UP_ORDER.map((s) => ({ label: FOLLOW_UP_LABEL[s]!, n: breakdown.find((r) => r.status === s)?._count._all ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  const columns = [
    { key: "label", label: "Status", type: "text" },
    { key: "tasks", label: "Tasks", type: "number" },
  ];
  return (
    <ReportCard
      id="follow-ups"
      title="Follow-ups by status"
      sub="Tasks due in the range"
      columns={columns}
      cells={rows.map((r) => [r.label, String(r.n)])}
      bars={rows.map((r) => ({ label: r.label, value: r.n, width: r.n > 0 ? Math.max(2, (r.n / max) * 100) : 0, text: String(r.n) }))}
    />
  );
}
