import { resolveRequestContext } from "@/auth/requestContext";
import { hasPermission } from "@/auth/context";
import { listCompanies } from "@/services/companyService";
import { listContacts } from "@/services/contactService";
import { listDeals } from "@/services/dealService";
import { listLeads } from "@/services/leadService";
import { listTasks } from "@/services/taskService";

export default async function OrgDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);

  // Not every role has any lead visibility at all -- Finance and Delivery
  // explicitly should not see the sales pipeline (FIG-297 Q56: "Finance ...
  // Cannot browse open pipeline or unqualified leads"), and Restricted
  // Technical has no CRM-record permissions by design. listLeads() fails
  // closed (throws ForbiddenError) rather than returning an empty list in
  // that case, so this must be gated the same way contacts/companies are.
  const canViewLeads =
    hasPermission(ctx, "leads.view.own") ||
    hasPermission(ctx, "leads.view.all");
  const canViewDeals =
    hasPermission(ctx, "deals.view.own") ||
    hasPermission(ctx, "deals.view.all");
  const canViewTasks =
    hasPermission(ctx, "tasks.view.own") ||
    hasPermission(ctx, "tasks.view.all");

  const [leads, contacts, companies, deals, overdueTasks] = await Promise.all([
    canViewLeads ? listLeads(ctx) : Promise.resolve([]),
    hasPermission(ctx, "contacts.view")
      ? listContacts(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, "companies.view")
      ? listCompanies(ctx)
      : Promise.resolve([]),
    canViewDeals ? listDeals(ctx) : Promise.resolve([]),
    canViewTasks ? listTasks(ctx, { overdueOnly: true }) : Promise.resolve([]),
  ]);

  const stats: {
    label: string;
    dot: "red" | "orange" | "green" | "blue";
    value: number;
    caption: string;
    href: string;
  }[] = [];

  if (canViewLeads) {
    stats.push({
      label: "Leads",
      dot: "blue",
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
      value: deals.length,
      caption: hasPermission(ctx, "deals.view.all")
        ? "visible organization-wide"
        : "owned by you",
      href: `/o/${orgSlug}/deals`,
    });
  }
  if (canViewTasks) {
    stats.push({
      label: "Overdue tasks",
      dot: overdueTasks.length > 0 ? "red" : "green",
      value: overdueTasks.length,
      caption: "past due, still open",
      href: `/o/${orgSlug}/tasks?overdueOnly=true`,
    });
  }
  if (hasPermission(ctx, "companies.view")) {
    stats.push({
      label: "Companies",
      dot: "orange",
      value: companies.length,
      caption: `${contacts.length} contact${contacts.length === 1 ? "" : "s"} across them`,
      href: `/o/${orgSlug}/companies`,
    });
  }

  return (
    <div>
      <h1 className="today-heading">Today</h1>
      <p className="who">
        Signed in as <strong>{ctx.roleKey}</strong> -- every number below already
        reflects your role&apos;s permission boundaries.
      </p>

      {stats.length > 0 && (
        <div className="stat-grid">
          {stats.map((s) => (
            <a key={s.label} href={s.href} className="stat-card" style={{ display: "block" }}>
              <div className="stat-label">
                <span className={`dot dot-${s.dot}`} />
                {s.label}
              </div>
              <div className="stat-value">{s.value}</div>
              <div className={`stat-bar bar-${s.dot}`}>
                <span style={{ width: s.value > 0 ? "100%" : "8%" }} />
              </div>
              <div className="stat-caption">{s.caption}</div>
            </a>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <strong>Overview</strong>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            This dashboard shows what you personally have access to -- a Sales
            membership only ever sees its own leads and deals here, never the
            whole organization&apos;s, and a role with no reporting permission
            at all sees a plainer view than this.
          </p>
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
