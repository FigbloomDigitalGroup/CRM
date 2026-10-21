import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { getFormReferenceData } from "@/services/referenceDataService";
import { buildReportNameResolvers } from "@/services/reportingNames";
import { getWeeklyPageUsage, recordPageView } from "@/services/pageViewService";
import {
  getMyActionableWork,
  getMyMetrics,
  getOrganizationMetrics,
  getReportScope,
} from "@/services/reportingService";
import { FilterComboField } from "../leads/FilterComboField";
import { NoAccess } from "../_shared/NoAccess";
import { initialsFor } from "../_shared/accountCapabilities";
import {
  IconDeals,
  IconDownload,
  IconLeads,
  IconShield,
  IconTasks,
} from "../_shared/icons";
import { ReportBarChart } from "./charts/ReportBarChart";
import { ReportDonutChart } from "./charts/ReportDonutChart";

const PAGE_DISPLAY_NAMES: Record<string, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  leads_detail: "Lead detail",
  deals: "Deals",
  deals_detail: "Deal detail",
  companies: "Companies",
  companies_detail: "Company detail",
  contacts: "Contacts",
  contacts_detail: "Contact detail",
  tasks: "Tasks",
  reports: "Reports",
  settings: "Settings",
};

function pageDisplayName(page: string): string {
  return PAGE_DISPLAY_NAMES[page] ?? page.replace(/_/g, " ");
}

const STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In progress",
  PENDING: "Pending",
  CANCELLED: "Cancelled",
};
const STATUS_ORDER = ["COMPLETED", "IN_PROGRESS", "PENDING", "CANCELLED"];

const PRESETS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
] as const;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    ownerMembershipId?: string;
    leadSourceId?: string;
    pipelineStageId?: string;
    serviceId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "reports");

  // Restricted Technical holds no reporting permission, so this fails
  // closed; explain and point at the nearest page instead of an error.
  let scope;
  try {
    scope = getReportScope(ctx);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Reports" />;
    }
    throw err;
  }

  const canViewAll = scope.mode === "organization";
  const canExport = hasPermission(ctx, "export.bulk");

  const [referenceData, myWork, orgMetrics, myMetrics, pageUsage] = await Promise.all([
    getFormReferenceData(ctx),
    getMyActionableWork(ctx),
    canViewAll ? getOrganizationMetrics(ctx, filters) : Promise.resolve(null),
    canViewAll ? Promise.resolve(null) : getMyMetrics(ctx, filters),
    canViewAll ? getWeeklyPageUsage(ctx) : Promise.resolve(null),
  ]);

  const metrics = orgMetrics
    ? { ...orgMetrics, scope }
    : (myMetrics as NonNullable<typeof myMetrics>);

  const { sourceName, stageName, serviceName } = buildReportNameResolvers(referenceData);
  const money = (value: unknown) =>
    value === null || value === undefined ? "--" : Number(value).toLocaleString();

  // ---- derived figures -------------------------------------------------
  const conv = metrics.leadConversion;
  const conversionPct = conv && conv.total > 0 ? Math.round((conv.converted / conv.total) * 100) : 0;
  const outcomes = metrics.dealOutcomes;
  const wonLostTotal = outcomes ? outcomes.won.count + outcomes.lost.count : 0;
  const winRatePct =
    outcomes && wonLostTotal > 0 ? Math.round((outcomes.won.count / wonLostTotal) * 100) : null;
  const openDeals = metrics.pipelineByStage?.reduce((n, r) => n + r._count._all, 0) ?? 0;
  const openValue = metrics.pipelineByStage?.reduce((n, r) => n + Number(r._sum.value ?? 0), 0) ?? 0;

  const followUps = metrics.followUpBreakdown ?? [];
  const followUpCount = (s: string) =>
    followUps.find((r) => r.status === s)?._count._all ?? 0;
  const followUpTotal = followUps.reduce((n, r) => n + r._count._all, 0);
  const followUpActive = followUpTotal - followUpCount("CANCELLED");
  const completionPct =
    followUpActive > 0 ? Math.round((followUpCount("COMPLETED") / followUpActive) * 100) : null;

  const leadVolumeChartData = metrics.leadVolumeBySource?.map((row) => ({
    label: sourceName(row.leadSourceId),
    value: row._count._all,
  }));
  const pipelineChartData = metrics.pipelineByStage?.map((row) => ({
    label: stageName(row.pipelineStageId),
    value: metrics.valueMasked ? row._count._all : Number(row._sum.value ?? 0),
  }));
  const salesByServiceChartData = metrics.salesByService?.map((row) => ({
    label: serviceName(row.serviceId),
    value: metrics.valueMasked ? row._count._all : Number(row._sum.value ?? 0),
  }));

  // ---- range presets ---------------------------------------------------
  const today = new Date();
  const rangeKey = (() => {
    if (!filters.dateFrom && !filters.dateTo) return "30";
    if (filters.dateTo !== isoDay(today)) return "custom";
    const hit = PRESETS.find((p) => {
      const from = new Date(today.getTime() - (p.days - 1) * 86_400_000);
      return filters.dateFrom === isoDay(from);
    });
    return hit?.key ?? "custom";
  })();
  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string | undefined> = { ...filters, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return `/o/${orgSlug}/reports${qs ? `?${qs}` : ""}`;
  };
  const presetHref = (days: number) =>
    hrefWith({
      dateFrom: isoDay(new Date(today.getTime() - (days - 1) * 86_400_000)),
      dateTo: isoDay(today),
    });

  const exportQs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();

  // ---- what this role's reports cover ---------------------------------
  const coverage: string[] = [];
  if (scope.leads) coverage.push(scope.leads === "all" ? "all leads" : "leads you own");
  if (scope.deals) coverage.push(scope.deals === "all" ? "all deals" : "deals you own");
  if (scope.tasks) coverage.push(scope.tasks === "all" ? "all tasks" : "tasks assigned to you");

  const attention: {
    key: string;
    label: string;
    value: number;
    caption: string;
    href: string;
    tone: "red" | "orange" | "blue" | "green";
    icon: React.ReactNode;
  }[] = [];
  if (scope.tasks) {
    attention.push(
      {
        key: "overdue",
        label: "Overdue tasks",
        value: myWork.overdue.length,
        caption: myWork.overdue.length === 0 ? "all caught up" : "past their due time",
        href: `/o/${orgSlug}/tasks?view=overdue`,
        tone: "red",
        icon: <IconTasks />,
      },
      {
        key: "today",
        label: "Due today",
        value: myWork.dueToday.length,
        caption: "open follow-ups for today",
        href: `/o/${orgSlug}/tasks?view=today`,
        tone: "orange",
        icon: <IconTasks />,
      },
    );
  }
  if (scope.leads) {
    attention.push({
      key: "leads",
      label: "New leads",
      value: myWork.newLeads.length,
      caption: "created in the last 7 days",
      href: `/o/${orgSlug}/leads`,
      tone: "blue",
      icon: <IconLeads />,
    });
  }
  if (scope.deals) {
    attention.push({
      key: "stalled",
      label: "Stalled deals",
      value: myWork.stalledDeals.length,
      caption: "open and past expected close",
      href: `/o/${orgSlug}/deals`,
      tone: "orange",
      icon: <IconDeals />,
    });
  }

  const hasLeadsSection = Boolean(scope.leads && metrics.leadVolumeBySource);
  const hasDealsSection = Boolean(scope.deals && metrics.pipelineByStage);
  const hasTasksSection = Boolean(scope.tasks && metrics.followUpBreakdown);

  const rangeLabel = `${new Date(metrics.dateFrom).toLocaleDateString()} to ${new Date(
    metrics.dateTo,
  ).toLocaleDateString()}`;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="who">
            {canViewAll
              ? "How the whole organization is performing."
              : "How your own work is performing."}
          </p>
        </div>
        {canViewAll && canExport && (
          <div className="page-head-actions">
            <a
              className="btn-ghost"
              href={`/api/orgs/${orgSlug}/reports/export${exportQs ? `?${exportQs}` : ""}`}
            >
              <IconDownload size={15} />
              Export CSV
            </a>
          </div>
        )}
      </div>

      <div className="list-meta">
        <div className="scope-line">
          <span className={`scope-pill ${canViewAll ? "is-all" : "is-own"}`}>
            {canViewAll ? "Organization reports" : "My reports"}
          </span>
          <span className="scope-text">
            {coverage.length > 0
              ? `Covers ${coverage.join(", ")}.`
              : "Nothing to report on for your role yet."}
          </span>
        </div>
      </div>

      {!canViewAll && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You&rsquo;re viewing reports for your own work.</strong>{" "}
            Organization-wide figures, filtering by owner, page usage and
            exporting are handled by Management.
            {metrics.valueMasked && scope.deals && " Deal values are hidden, so deals are counted instead."}
          </p>
        </div>
      )}

      {attention.length > 0 && (
        <>
          <div className="section-label">Needs attention</div>
          <div className="stat-grid">
            {attention.map((a) => (
              <a key={a.key} href={a.href} className="stat-card">
                <div className="stat-card-head">
                  <div className="stat-label-plain">{a.label}</div>
                  <span className={`stat-icon-chip chip-${a.tone}`}>{a.icon}</span>
                </div>
                <div className="stat-value">{a.value}</div>
                <div className="stat-caption">{a.caption}</div>
              </a>
            ))}
          </div>
        </>
      )}

      <div className="section-label">Performance</div>

      <nav className="lead-tabs report-presets" aria-label="Date range">
        {PRESETS.map((p) => (
          <a
            key={p.key}
            href={presetHref(p.days)}
            className={`lead-tab${rangeKey === p.key ? " is-active" : ""}`}
            aria-current={rangeKey === p.key ? "page" : undefined}
          >
            Last {p.label}
          </a>
        ))}
        {rangeKey === "custom" && (
          <span className="lead-tab is-active">Custom range</span>
        )}
      </nav>

      <form className="filters filters-bar" method="GET">
        {canViewAll && (
          <FilterComboField
            name="ownerMembershipId"
            defaultValue={filters.ownerMembershipId ?? ""}
            placeholder="Any owner"
            options={[
              { value: "", label: "Any owner" },
              ...referenceData.members.map((m) => ({
                value: m.membershipId,
                label: m.userName,
                sublabel: m.roleName,
                avatarLabel: initialsFor(m.userName),
              })),
            ]}
          />
        )}
        {scope.leads && (
          <FilterComboField
            name="leadSourceId"
            defaultValue={filters.leadSourceId ?? ""}
            placeholder="Any source"
            options={[
              { value: "", label: "Any source" },
              ...referenceData.leadSources.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
        {scope.deals && (
          <FilterComboField
            name="pipelineStageId"
            defaultValue={filters.pipelineStageId ?? ""}
            placeholder="Any stage"
            options={[
              { value: "", label: "Any stage" },
              ...referenceData.pipelineStages.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
        {scope.deals && (
          <FilterComboField
            name="serviceId"
            defaultValue={filters.serviceId ?? ""}
            placeholder="Any service"
            options={[
              { value: "", label: "Any service" },
              ...referenceData.services.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}
        <input
          type="date"
          name="dateFrom"
          defaultValue={filters.dateFrom ?? ""}
          title="From"
          aria-label="From date"
        />
        <input
          type="date"
          name="dateTo"
          defaultValue={filters.dateTo ?? ""}
          title="To"
          aria-label="To date"
        />
        <button type="submit">Apply</button>
      </form>

      <p className="who report-range">
        Showing {rangeLabel}. Open pipeline is always a live snapshot.
      </p>

      {!hasLeadsSection && !hasDealsSection && !hasTasksSection ? (
        <div className="card report-empty">
          <strong>Nothing to show here yet.</strong>
          <p className="who">
            Your role doesn&rsquo;t include any area that has report figures.
          </p>
        </div>
      ) : (
        <>
          <div className="kpi-row">
            {hasLeadsSection && conv && (
              <>
                <div className="kpi-card">
                  <div className="kpi-label"><span className="stage-dot tone-blue" />Leads created</div>
                  <div className="kpi-value">{conv.total}</div>
                  <div className="kpi-sub">in the selected range</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><span className="stage-dot tone-green" />Conversion</div>
                  <div className="kpi-value">{conversionPct}%</div>
                  <div className="kpi-sub">{conv.converted} of {conv.total} converted</div>
                </div>
              </>
            )}
            {hasDealsSection && outcomes && (
              <>
                <div className="kpi-card">
                  <div className="kpi-label"><span className="stage-dot tone-green" />Won deals</div>
                  <div className="kpi-value">{outcomes.won.count}</div>
                  <div className="kpi-sub">
                    {metrics.valueMasked ? "value hidden" : `value ${money(outcomes.won.value)}`}
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><span className="stage-dot tone-purple" />Win rate</div>
                  <div className="kpi-value">{winRatePct !== null ? `${winRatePct}%` : "--"}</div>
                  <div className="kpi-sub">
                    {outcomes.won.count} won &middot; {outcomes.lost.count} lost
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label"><span className="stage-dot tone-orange" />Open pipeline</div>
                  <div className="kpi-value">
                    {metrics.valueMasked ? openDeals : money(openValue)}
                  </div>
                  <div className="kpi-sub">
                    {metrics.valueMasked ? "open deals" : `across ${openDeals} open deal${openDeals === 1 ? "" : "s"}`}
                  </div>
                </div>
              </>
            )}
            {hasTasksSection && (
              <div className="kpi-card">
                <div className="kpi-label"><span className="stage-dot tone-blue" />Follow-ups done</div>
                <div className="kpi-value">{completionPct !== null ? `${completionPct}%` : "--"}</div>
                <div className="kpi-sub">
                  {followUpCount("COMPLETED")} of {followUpActive} tasks due in range
                </div>
              </div>
            )}
          </div>

          {hasLeadsSection && conv && (
            <>
              <div className="section-label">Leads</div>
              <div className="grid-2">
                <div className="card">
                  <strong>Lead volume by source</strong>
                  <div style={{ marginBottom: 14 }}>
                    <ReportBarChart data={leadVolumeChartData ?? []} color="var(--info)" />
                  </div>
                  <table className="data-table report-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th className="num">Leads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.leadVolumeBySource?.map((row) => (
                        <tr key={row.leadSourceId ?? "unknown"}>
                          <td>{sourceName(row.leadSourceId)}</td>
                          <td className="num">{row._count._all}</td>
                        </tr>
                      ))}
                      {metrics.leadVolumeBySource?.length === 0 && (
                        <tr>
                          <td colSpan={2}>No leads created in this range.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <strong>Conversion</strong>
                  <ReportDonutChart
                    segments={[
                      { label: "Converted", value: conv.converted, color: "var(--success)" },
                      {
                        label: "Not yet",
                        value: conv.total - conv.converted,
                        color: "var(--border-strong)",
                      },
                    ]}
                    centerLabel={`${conversionPct}%`}
                    centerCaption="of leads in range"
                  />
                </div>
              </div>
            </>
          )}

          {hasDealsSection && outcomes && (
            <>
              <div className="section-label">Deals</div>
              <div className="grid-2">
                <div className="card">
                  <strong>
                    Pipeline by stage ({metrics.valueMasked ? "open deals" : "open value"})
                  </strong>
                  <div style={{ marginBottom: 14 }}>
                    <ReportBarChart data={pipelineChartData ?? []} color="var(--brand-green)" />
                  </div>
                  <table className="data-table report-table">
                    <thead>
                      <tr>
                        <th>Stage</th>
                        <th className="num">Open deals</th>
                        {!metrics.valueMasked && <th className="num">Value</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.pipelineByStage?.map((row) => (
                        <tr key={row.pipelineStageId}>
                          <td>{stageName(row.pipelineStageId)}</td>
                          <td className="num">{row._count._all}</td>
                          {!metrics.valueMasked && <td className="num">{money(row._sum.value)}</td>}
                        </tr>
                      ))}
                      {metrics.pipelineByStage?.length === 0 && (
                        <tr>
                          <td colSpan={metrics.valueMasked ? 2 : 3}>No open deals.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <strong>
                    Sales by service ({metrics.valueMasked ? "won deals" : "won value"})
                  </strong>
                  <div style={{ marginBottom: 14 }}>
                    <ReportBarChart data={salesByServiceChartData ?? []} color="var(--brand-orange)" />
                  </div>
                  <table className="data-table report-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th className="num">Won deals</th>
                        {!metrics.valueMasked && <th className="num">Value</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.salesByService?.map((row) => (
                        <tr key={row.serviceId ?? "unspecified"}>
                          <td>{serviceName(row.serviceId)}</td>
                          <td className="num">{row._count._all}</td>
                          {!metrics.valueMasked && <td className="num">{money(row._sum.value)}</td>}
                        </tr>
                      ))}
                      {metrics.salesByService?.length === 0 && (
                        <tr>
                          <td colSpan={metrics.valueMasked ? 2 : 3}>No won deals in this range.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="card">
                  <strong>Won / lost</strong>
                  <ReportDonutChart
                    segments={[
                      { label: "Won", value: outcomes.won.count, color: "var(--success)" },
                      { label: "Lost", value: outcomes.lost.count, color: "var(--danger)" },
                    ]}
                    centerLabel={winRatePct !== null ? `${winRatePct}%` : "--"}
                    centerCaption="win rate"
                  />
                </div>
              </div>
            </>
          )}

          {hasTasksSection && (
            <>
              <div className="section-label">Tasks</div>
              <div className="card">
                <strong>Follow-up performance (tasks due in range)</strong>
                {followUpTotal === 0 ? (
                  <p className="who">No tasks were due in this range.</p>
                ) : (
                  <>
                    <div className="status-stack" role="img" aria-label="Task status split">
                      {STATUS_ORDER.filter((s) => followUpCount(s) > 0).map((s) => (
                        <span
                          key={s}
                          className={`status-stack-seg rs-${s.toLowerCase().replace("_", "-")}`}
                          style={{ flexGrow: followUpCount(s) }}
                        />
                      ))}
                    </div>
                    <ul className="status-legend">
                      {STATUS_ORDER.map((s) => (
                        <li key={s}>
                          <span className={`status-dot rs-${s.toLowerCase().replace("_", "-")}`} />
                          <span className="status-legend-label">{STATUS_LABEL[s]}</span>
                          <span className="status-legend-count">{followUpCount(s)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}

      {canViewAll && pageUsage && (
        <>
          <div className="section-label">Adoption</div>
          <div className="card">
            <strong>Page usage (last 7 days)</strong>
            <p className="who">
              Who is actually using which page, not what they looked at. Only a page
              label, the viewing member and a timestamp are recorded; nothing about
              record contents.
            </p>
            <div className="kpi-row" style={{ marginBottom: 14 }}>
              <div className="kpi-card">
                <div className="kpi-label"><span className="stage-dot tone-blue" />Weekly active users</div>
                <div className="kpi-value">{pageUsage.totalActiveUsers}</div>
                <div className="kpi-sub">distinct members, any page</div>
              </div>
            </div>
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="num">Visits</th>
                  <th className="num">Active users</th>
                </tr>
              </thead>
              <tbody>
                {pageUsage.pages.map((row) => (
                  <tr key={row.page}>
                    <td>{pageDisplayName(row.page)}</td>
                    <td className="num">{row.visits}</td>
                    <td className="num">{row.activeUsers}</td>
                  </tr>
                ))}
                {pageUsage.pages.length === 0 && (
                  <tr>
                    <td colSpan={3}>No page views recorded in the last 7 days.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details className="card report-defs">
        <summary>Metric definitions</summary>
        <dl>
          {scope.tasks && (
            <>
              <dt>Due today / Overdue</dt>
              <dd>
                {scope.tasks === "all" ? "Tasks" : "Tasks assigned to you"} whose due
                date is today, or already past, while still Pending or In progress.
              </dd>
            </>
          )}
          {scope.leads && (
            <>
              <dt>New leads</dt>
              <dd>
                {scope.leads === "all" ? "Leads" : "Leads you own"} created in the last
                7 days.
              </dd>
            </>
          )}
          {scope.deals && (
            <>
              <dt>Stalled deals</dt>
              <dd>Open deals whose expected close date has already passed.</dd>
            </>
          )}
          {scope.leads && (
            <>
              <dt>Lead volume by source</dt>
              <dd>
                Leads created within the range, grouped by lead source. Archived leads
                still count: they were created.
              </dd>
              <dt>Conversion</dt>
              <dd>
                Of the leads created in the range, the share converted to a deal as of
                today, whenever the conversion happened.
              </dd>
            </>
          )}
          {scope.deals && (
            <>
              <dt>Won / lost and win rate</dt>
              <dd>
                Deals whose outcome became Won or Lost within the range (when it
                happened, not when the deal was created). Win rate is won &divide; (won +
                lost).
              </dd>
              <dt>Open pipeline</dt>
              <dd>
                A live snapshot of open, non-archived deals grouped by stage. The date
                range does not apply.
              </dd>
              <dt>Sales by service</dt>
              <dd>Value of deals won within the range, grouped by service.</dd>
            </>
          )}
          {scope.tasks && (
            <>
              <dt>Follow-ups done</dt>
              <dd>
                Of the tasks due in the range (cancelled ones excluded), the share
                completed.
              </dd>
            </>
          )}
          {canViewAll && (
            <>
              <dt>Page usage</dt>
              <dd>
                A fixed trailing 7 days: visits and distinct active members per page.
                The date range does not apply.
              </dd>
            </>
          )}
          <dt>Deal values</dt>
          <dd>
            {scope.deals === "own"
              ? "Values on deals you own are shown. "
              : ""}
            Where your role can&rsquo;t see deal values they&rsquo;re hidden and charts
            count deals instead.
          </dd>
        </dl>
        <p className="who">
          Full metric reference, including how each figure is queried: see{" "}
          <code>docs/REPORTING_METRICS.md</code> in the repository.
        </p>
      </details>
    </div>
  );
}
