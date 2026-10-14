import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { listDeals } from "@/services/dealService";
import { listLeads } from "@/services/leadService";
import { listTasks } from "@/services/taskService";
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
  const canViewDeals =
    hasPermission(ctx, "deals.view.own") ||
    hasPermission(ctx, "deals.view.all");
  const canViewTasks =
    hasPermission(ctx, "tasks.view.own") ||
    hasPermission(ctx, "tasks.view.all");

  const [leads, contacts, companies, deals, overdueTasks, allTasks] = await Promise.all([
    canViewLeads ? listLeads(ctx) : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    canViewDeals ? listDeals(ctx) : Promise.resolve([]),
    canViewTasks ? listTasks(ctx, { overdueOnly: true }) : Promise.resolve([]),
    canViewTasks ? listTasks(ctx) : Promise.resolve([]),
  ]);

  // ---- Overview card: only what this account can actually see ----------
  // Every list above already went through the same server-enforced
  // own/all scoping as the stat cards and list pages, so the overview can
  // never show a record the rest of the app wouldn't.
  const leadLabel = (l: (typeof leads)[number]) =>
    l.company?.name ??
    ([l.contact?.firstName, l.contact?.lastName].filter(Boolean).join(" ") ||
      "Unnamed lead");
  const tempBadge = { HOT: "badge-red", WARM: "badge-orange", COLD: "badge-blue" } as const;

  const latestLeads = leads.slice(0, 3);

  const openDeals = deals.filter((d) => d.outcome === "OPEN");
  const wonDeals = deals.filter((d) => d.outcome === "WON");
  const lostDeals = deals.filter((d) => d.outcome === "LOST");
  // A total is only honest when every open deal's value is visible to this
  // account (deals.view.value) and they share one currency.
  const openValueCurrencies = new Set(openDeals.map((d) => d.currency));
  const openValue =
    openDeals.length > 0 &&
    openDeals.every((d) => !d.valueMasked && d.value != null) &&
    openValueCurrencies.size === 1
      ? `${[...openValueCurrencies][0]} ${openDeals
          .reduce((sum, d) => sum + Number(d.value), 0)
          .toLocaleString()}`
      : null;

  const now = Date.now();
  const upcomingTasks = allTasks
    .filter(
      (t) =>
        (t.status === "PENDING" || t.status === "IN_PROGRESS") &&
        (!t.dueAt || new Date(t.dueAt).getTime() >= now),
    )
    .slice(0, 3);

  const newestCompanies = [...companies]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 3);

  const hasOverview =
    latestLeads.length > 0 ||
    deals.length > 0 ||
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
      value: leads.length,
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
      value: deals.length,
      caption: hasPermission(ctx, "deals.view.all")
        ? "visible organization-wide"
        : "owned by you",
      href: `/o/${orgSlug}/deals`,
    });
  }
  if (canViewTasks) {
    stats.push({
      label: "Overdue Tasks",
      dot: overdueTasks.length > 0 ? "red" : "green",
      icon: <IconTasks />,
      value: overdueTasks.length,
      caption: "past due, still open",
      href: `/o/${orgSlug}/tasks?overdueOnly=true`,
    });
  }
  if (hasPermission(ctx, "companies.view")) {
    stats.push({
      label: "Companies",
      dot: "orange",
      icon: <IconCompanies />,
      value: companies.length,
      caption: `${contacts.length} contact${contacts.length === 1 ? "" : "s"} across them`,
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

              {deals.length > 0 && (
                <section>
                  <div className="overview-section-title">
                    <span>Pipeline</span>
                    <a href={`/o/${orgSlug}/deals`}>View all &rarr;</a>
                  </div>
                  <div className="overview-figures">
                    <div>
                      <div className="overview-figure">{openDeals.length}</div>
                      <div className="panel-row-meta">open</div>
                    </div>
                    <div>
                      <div className="overview-figure">{wonDeals.length}</div>
                      <div className="panel-row-meta">won</div>
                    </div>
                    <div>
                      <div className="overview-figure">{lostDeals.length}</div>
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
            {overdueTasks.length === 0 ? (
              <p className="panel-empty">Nothing overdue right now.</p>
            ) : (
              <ul className="panel-list">
                {overdueTasks.slice(0, 5).map((t) => (
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
            {overdueTasks.length > 5 && (
              <p style={{ marginTop: 12 }}>
                <a href={`/o/${orgSlug}/tasks?overdueOnly=true`}>
                  All {overdueTasks.length} overdue tasks &rarr;
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
