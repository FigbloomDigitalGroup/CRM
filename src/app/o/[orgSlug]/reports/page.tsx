import { hasPermission } from "@/auth/context";
import { resolveRequestContext } from "@/auth/requestContext";
import { getFormReferenceData } from "@/services/referenceDataService";
import { getMyActionableWork, getOrganizationMetrics } from "@/services/reportingService";

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

  const canViewOwn = hasPermission(ctx, "reporting.view.own");
  const canViewAll = hasPermission(ctx, "reporting.view.all");
  if (!canViewOwn && !canViewAll) {
    return <p className="error">Your role does not have access to Reports.</p>;
  }

  const referenceData = await getFormReferenceData(ctx);
  const myWork = await getMyActionableWork(ctx);
  const orgMetrics = canViewAll
    ? await getOrganizationMetrics(ctx, filters)
    : null;

  const sourceName = (id: string | null) =>
    referenceData.leadSources.find((s) => s.id === id)?.name ?? "(unknown)";
  const stageName = (id: string | null) =>
    referenceData.pipelineStages.find((s) => s.id === id)?.name ?? "(unknown)";
  const serviceName = (id: string | null) =>
    referenceData.services.find((s) => s.id === id)?.name ?? "(unspecified)";
  const money = (value: unknown) =>
    value === null || value === undefined
      ? "--"
      : Number(value).toLocaleString();

  return (
    <div>
      <h1>Reports</h1>

      <div className="card">
        <strong>Your actionable work</strong>
        {hasPermission(ctx, "tasks.view.own") || hasPermission(ctx, "tasks.view.all") ? (
          <>
            <p>
              Due today: {myWork.dueToday.length} &middot; Overdue:{" "}
              <span className={myWork.overdue.length > 0 ? "overdue" : undefined}>
                {myWork.overdue.length}
              </span>{" "}
              (<a href={`/o/${orgSlug}/tasks?overdueOnly=true`}>view</a>)
            </p>
          </>
        ) : null}
        {hasPermission(ctx, "leads.view.own") || hasPermission(ctx, "leads.view.all") ? (
          <p>
            New leads (last 7 days): {myWork.newLeads.length} (
            <a href={`/o/${orgSlug}/leads`}>view</a>)
          </p>
        ) : null}
        {hasPermission(ctx, "deals.view.own") || hasPermission(ctx, "deals.view.all") ? (
          <p>
            Stalled deals (open, past expected close): {myWork.stalledDeals.length}{" "}
            (<a href={`/o/${orgSlug}/deals`}>view</a>)
          </p>
        ) : null}
        {myWork.dueToday.length === 0 &&
          myWork.overdue.length === 0 &&
          myWork.newLeads.length === 0 &&
          myWork.stalledDeals.length === 0 && (
            <p className="who">Nothing actionable right now.</p>
          )}
      </div>

      {canViewAll && orgMetrics && (
        <>
          <form className="filters" method="GET">
            <select name="ownerMembershipId" defaultValue={filters.ownerMembershipId ?? ""}>
              <option value="">Any owner</option>
              {referenceData.members.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.userName}
                </option>
              ))}
            </select>
            <select name="leadSourceId" defaultValue={filters.leadSourceId ?? ""}>
              <option value="">Any source</option>
              {referenceData.leadSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select name="pipelineStageId" defaultValue={filters.pipelineStageId ?? ""}>
              <option value="">Any stage</option>
              {referenceData.pipelineStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select name="serviceId" defaultValue={filters.serviceId ?? ""}>
              <option value="">Any service</option>
              {referenceData.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom ?? ""}
              title="From"
            />
            <input type="date" name="dateTo" defaultValue={filters.dateTo ?? ""} title="To" />
            <button type="submit" className="secondary">
              Filter
            </button>
          </form>

          <p className="who">
            Showing {new Date(orgMetrics.dateFrom).toLocaleDateString()} to{" "}
            {new Date(orgMetrics.dateTo).toLocaleDateString()} (defaults to the last
            30 days when no dates are chosen).
          </p>

          <h2>Lead volume by source</h2>
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {orgMetrics.leadVolumeBySource.map((row) => (
                <tr key={row.leadSourceId ?? "unknown"}>
                  <td>{sourceName(row.leadSourceId)}</td>
                  <td>{row._count._all}</td>
                </tr>
              ))}
              {orgMetrics.leadVolumeBySource.length === 0 && (
                <tr>
                  <td colSpan={2}>No leads in range.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Conversion</h2>
          <p>
            {orgMetrics.leadConversion.converted} of {orgMetrics.leadConversion.total}{" "}
            leads created in range have converted (
            {orgMetrics.leadConversion.total > 0
              ? Math.round(
                  (orgMetrics.leadConversion.converted /
                    orgMetrics.leadConversion.total) *
                    100,
                )
              : 0}
            %).
          </p>

          <h2>Won / Lost deals</h2>
          <p>
            Won: {orgMetrics.dealOutcomes.won.count} deal(s), value{" "}
            {money(orgMetrics.dealOutcomes.won.value)} &nbsp; Lost:{" "}
            {orgMetrics.dealOutcomes.lost.count} deal(s)
          </p>

          <h2>Pipeline value by stage (current snapshot)</h2>
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Open deals</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {orgMetrics.pipelineByStage.map((row) => (
                <tr key={row.pipelineStageId}>
                  <td>{stageName(row.pipelineStageId)}</td>
                  <td>{row._count._all}</td>
                  <td>{money(row._sum.value)}</td>
                </tr>
              ))}
              {orgMetrics.pipelineByStage.length === 0 && (
                <tr>
                  <td colSpan={3}>No open deals.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Sales by service</h2>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Won deals</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {orgMetrics.salesByService.map((row) => (
                <tr key={row.serviceId ?? "unspecified"}>
                  <td>{serviceName(row.serviceId)}</td>
                  <td>{row._count._all}</td>
                  <td>{money(row._sum.value)}</td>
                </tr>
              ))}
              {orgMetrics.salesByService.length === 0 && (
                <tr>
                  <td colSpan={3}>No won deals in range.</td>
                </tr>
              )}
            </tbody>
          </table>

          <h2>Follow-up performance (tasks due in range)</h2>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {orgMetrics.followUpBreakdown.map((row) => (
                <tr key={row.status}>
                  <td>{row.status}</td>
                  <td>{row._count._all}</td>
                </tr>
              ))}
              {orgMetrics.followUpBreakdown.length === 0 && (
                <tr>
                  <td colSpan={2}>No tasks due in range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <details className="card">
        <summary>Metric definitions</summary>
        <ul>
          <li>
            <strong>Due today / Overdue</strong>: your own assigned tasks (Management
            sees the same for whichever owner filter is chosen elsewhere) whose due date
            falls today, or is in the past, while status is Pending or In Progress.
          </li>
          <li>
            <strong>New leads</strong>: leads created in the last 7 days that you can
            see (your own for Sales, all for Management).
          </li>
          <li>
            <strong>Stalled deals</strong>: open deals whose expected close date has
            already passed.
          </li>
          <li>
            <strong>Lead volume by source</strong>: count of leads created within the
            selected date range (default: last 30 days), grouped by lead source.
          </li>
          <li>
            <strong>Conversion</strong>: of the leads created in the selected range,
            the percentage that have been converted to a deal as of today (regardless
            of when the conversion itself happened).
          </li>
          <li>
            <strong>Won / Lost</strong>: deals whose outcome changed to Won or Lost
            within the selected date range (based on when that happened, not when the
            deal was created).
          </li>
          <li>
            <strong>Pipeline value by stage</strong>: a current snapshot of open
            deals&apos; total value, grouped by pipeline stage -- not affected by the
            date range.
          </li>
          <li>
            <strong>Sales by service</strong>: total value of deals won within the
            selected date range, grouped by service.
          </li>
          <li>
            <strong>Follow-up performance</strong>: tasks whose due date fell within
            the selected range, grouped by their current status.
          </li>
          <li>
            Deal-value figures are hidden (shown as &quot;--&quot;) for roles without
            org-wide value visibility.
          </li>
        </ul>
      </details>
    </div>
  );
}
