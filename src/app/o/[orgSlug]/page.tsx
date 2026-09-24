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

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="card">
        <p>
          Signed in as <strong>{ctx.roleKey}</strong>. This dashboard shows what
          you personally have access to -- the counts below already reflect your
          role's permission boundaries (e.g. a Sales membership only ever sees
          its own leads here, never the whole organization's).
        </p>
      </div>
      <div className="card">
        {canViewLeads && (
          <p>
            <a href={`/o/${orgSlug}/leads`}>
              {leads.length} lead(s) visible to you
            </a>
          </p>
        )}
        {hasPermission(ctx, "contacts.view") && (
          <p>
            <a href={`/o/${orgSlug}/contacts`}>{contacts.length} contact(s)</a>
          </p>
        )}
        {hasPermission(ctx, "companies.view") && (
          <p>
            <a href={`/o/${orgSlug}/companies`}>
              {companies.length} compan{companies.length === 1 ? "y" : "ies"}
            </a>
          </p>
        )}
        {canViewDeals && (
          <p>
            <a href={`/o/${orgSlug}/deals`}>
              {deals.length} deal(s) visible to you
            </a>
          </p>
        )}
        {canViewTasks && (
          <p>
            <a
              href={`/o/${orgSlug}/tasks?overdueOnly=true`}
              className={overdueTasks.length > 0 ? "overdue" : undefined}
            >
              {overdueTasks.length} overdue task(s)
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
