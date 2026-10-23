import { canUseResource } from "@/auth/permissions";
import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { countCompanies, listCompanies } from "@/services/companyService";
import { countContacts } from "@/services/contactService";
import { getDealSummary } from "@/services/dealService";
import { countLeads, listLeads } from "@/services/leadService";
import { countTasks, listTasks } from "@/services/taskService";
import { recordPageView } from "@/services/pageViewService";
import {
  IconCompanies,
  IconDeals,
  IconLeads,
  IconTasks,
} from "./_shared/icons";

export default async function OrgDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "dashboard");

  // Not every role has any lead visibility at all (Finance/Delivery don't
  // see the sales pipeline; Restricted Technical has no CRM-record access
  // by design). listLeads() fails closed with ForbiddenError rather than
  // an empty list in that case, so it needs the same permission gate as
  // contacts/companies below.
  const canViewLeads =
    hasPermission(ctx, "leads.view.own") ||
    hasPermission(ctx, "leads.view.all");
  const canViewDeals = canUseResource(ctx, "deals");
  const canViewTasks =
    hasPermission(ctx, "tasks.view.own") ||
    hasPermission(ctx, "tasks.view.all");

  // FIG-789: counts and aggregates (COUNT/SUM), never full lists -- the
  // dashboard only ever shows numbers plus a handful of "latest" rows, so
  // it must not load every lead, deal and task to produce them. Each call
  // keeps the same server-enforced own/all scoping and value masking as the
  // list pages.
  const canViewCompanies = hasPermission(ctx, "companies.view");
  const [
    leadCount,
    latestLeads,
    contactCount,
    companyCount,
    newestCompanies,
    dealSummary,
    overdueCount,
    overdueTasks,
    upcomingTasks,
  ] = await Promise.all([
    canViewLeads ? countLeads(ctx) : Promise.resolve(0),
    canViewLeads ? listLeads(ctx, { take: 3 }) : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? countContacts(ctx)
      : Promise.resolve(0),
    canViewCompanies ? countCompanies(ctx) : Promise.resolve(0),
    canViewCompanies ? listCompanies(ctx, { take: 3 }) : Promise.resolve([]),
    canViewDeals ? getDealSummary(ctx) : Promise.resolve(null),
    canViewTasks
      ? countTasks(ctx, { overdueOnly: true })
      : Promise.resolve(0),
    canViewTasks
      ? listTasks(ctx, { overdueOnly: true, take: 5 })
      : Promise.resolve([]),
    canViewTasks
      ? listTasks(ctx, { upcomingOnly: true, take: 3 })
      : Promise.resolve([]),
  ]);

  // ---- Overview card: only what this account can actually see ----------
  const leadLabel = (l: (typeof latestLeads)[number]) =>
    l.company?.name ??
    ([l.contact?.firstName, l.contact?.lastName].filter(Boolean).join(" ") ||
      "Unnamed lead");
  const tempBadge = { HOT: "badge-red", WARM: "badge-orange", COLD: "badge-blue" } as const;

  const dealCount = dealSummary?.total ?? 0;
  const openDealCount = dealSummary?.open ?? 0;
  const wonDealCount = dealSummary?.won ?? 0;
  const lostDealCount = dealSummary?.lost ?? 0;
  // A total is only honest when every open deal's value is visible to this
  // account (deals.view.value) and they share one currency -- getDealSummary
  // returns null otherwise.
  const openValue = dealSummary?.openValue
    ? `${dealSummary.openValue.currency} ${dealSummary.openValue.amount.toLocaleString()}`
    : null;

  const hasOverview =
    latestLeads.length > 0 ||
    dealCount > 0 ||
    upcomingTasks.length > 0 ||
    newestCompanies.length > 0;

  const stats: {
    label: string;
    dot: "red" | "orange" | "green" | "blue";
    icon: React.ReactNode;
    value: number;
    caption: string;
    href: string;
  }[] = [];

  if (canViewLeads) {
    stats.push({
      label: "Leads",
      dot: "blue",
      icon: <IconLeads />,
      value: leadCount,
      caption: hasPermission(ctx, "leads.view.all")
        ? "visible organization-wide"
        : "owned by you",
      href: `/o/${orgSlug}/leads`,
    });
  }
  if (canViewDeals) {
    stats.push({
      label: "Deals",
      dot: "green",
      icon: <IconDeals />,
      value: dealCount,
      caption: hasPermission(ctx, "deals.view.all")
        ? "visible organization-wide"
        : hasPermission(ctx, "deals.view.won")
          ? "won deals"
          : "owned by you",
      href: `/o/${orgSlug}/deals`,
    });
  }
  if (canViewTasks) {
    stats.push({
      label: "Overdue Tasks",
      dot: overdueCount > 0 ? "red" : "green",
      icon: <IconTasks />,
      value: overdueCount,
      caption: "past due, still open",
      href: `/o/${orgSlug}/tasks?overdueOnly=true`,
    });
  }
  if (canViewCompanies) {
    stats.push({
      label: "Companies",
      dot: "orange",
      icon: <IconCompanies />,
      value: companyCount,
      caption: `${contactCount} contact${contactCount === 1 ? "" : "s"} across them`,
      href: `/o/${orgSlug}/companies`,
    });
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      <h1 className="today-heading">Today</h1>
      <p className="who">{today} &middot; Your CRM at a glance</p>

      {stats.length > 0 && (
        <div className="stat-grid">
          {stats.map((s) => (
            <a key={s.label} href={s.href} className="stat-card" style={{ display: "block" }}>
              <div className="stat-card-head">
                <div className="stat-label-plain">{s.label}</div>
                <div className={`stat-icon-chip chip-${s.dot}`}>{s.icon}</div>
              </div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-caption">{s.caption}</div>
            </a>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <strong>Overview</strong>
          {!hasOverview ? (
            <p className="panel-empty">Nothing to show here yet.</p>
          ) : (
            <div className="overview-sections">
              {latestLeads.length > 0 && (
                <section>
                  <div className="overview-section-title">
                    <span>Latest leads</span>
                    <a href={`/o/${orgSlug}/leads`}>View all &rarr;</a>
                  </div>
                  <ul className="panel-list">
                    {latestLeads.map((l) => (
                      <li key={l.id} className="panel-row">
                        <div>
                          <a
                            className="panel-row-title"
                            href={`/o/${orgSlug}/leads/${l.id}`}
                          >
                            {leadLabel(l)}
                          </a>
                          <div className="panel-row-meta">
                            {l.leadStatus.name} &middot; added{" "}
                            {new Date(l.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <span className={`badge ${tempBadge[l.temperature]}`}>
                          {l.temperature.toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {dealCount > 0 && (
                <section>
                  <div className="overview-section-title">
                    <span>Pipeline</span>
                    <a href={`/o/${orgSlug}/deals`}>View all &rarr;</a>
                  </div>
                  <div className="overview-figures">
                    <div>
                      <div className="overview-figure">{openDealCount}</div>
                      <div className="panel-row-meta">open</div>
                    </div>
                    <div>
                      <div className="overview-figure">{wonDealCount}</div>
                      <div className="panel-row-meta">won</div>
                    </div>
                    <div>
                      <div className="overview-figure">{lostDealCount}</div>
                      <div className="panel-row-meta">lost</div>
                    </div>
                  </div>
                  {openValue && (
                    <div className="panel-row-meta" style={{ marginTop: 8 }}>
                      {openValue} in open deals
                    </div>
                  )}
                </section>
              )}

              {upcomingTasks.length > 0 && (
                <section>
                  <div className="overview-section-title">
                    <span>Coming up</span>
                    <a href={`/o/${orgSlug}/tasks`}>View all &rarr;</a>
                  </div>
                  <ul className="panel-list">
                    {upcomingTasks.map((t) => (
                      <li key={t.id} className="panel-row">
                        <div>
                          <a
                            className="panel-row-title"
                            href={`/o/${orgSlug}/tasks`}
                          >
                            {t.title}
                          </a>
                          <div className="panel-row-meta">
                            {t.dueAt
                              ? `Due ${new Date(t.dueAt).toLocaleDateString()}`
                              : "No due date"}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {newestCompanies.length > 0 && (
                <section>
                  <div className="overview-section-title">
                    <span>Newest companies</span>
                    <a href={`/o/${orgSlug}/companies`}>View all &rarr;</a>
                  </div>
                  <ul className="panel-list">
                    {newestCompanies.map((c) => (
                      <li key={c.id} className="panel-row">
                        <div>
                          <a
                            className="panel-row-title"
                            href={`/o/${orgSlug}/companies/${c.id}`}
                          >
                            {c.name}
                          </a>
                          <div className="panel-row-meta">
                            {c.industry ?? "Added"} &middot;{" "}
                            {new Date(c.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {canViewTasks && (
          <div className="card">
            <strong>Needs your attention</strong>
            {overdueCount === 0 ? (
              <p className="panel-empty">Nothing overdue right now.</p>
            ) : (
              <ul className="panel-list">
                {overdueTasks.map((t) => (
                  <li key={t.id} className="panel-row">
                    <div>
                      <div className="panel-row-title">{t.title}</div>
                      <div className="panel-row-meta">
                        Due {t.dueAt ? new Date(t.dueAt).toLocaleDateString() : "--"}
                      </div>
                    </div>
                    <span className="badge badge-red">overdue</span>
                  </li>
                ))}
              </ul>
            )}
            {overdueCount > 5 && (
              <p style={{ marginTop: 12 }}>
                <a href={`/o/${orgSlug}/tasks?overdueOnly=true`}>
                  All {overdueCount} overdue tasks &rarr;
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
