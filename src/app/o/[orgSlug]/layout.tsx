import { redirect } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { UnauthorizedError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminDb } from "@/db/adminClient";
import { LogoutButton } from "./LogoutButton";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let ctx;
  try {
    ctx = await resolveRequestContext(orgSlug);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/dev-login");
    }
    return (
      <div className="page">
        <p className="error">
          {err instanceof Error ? err.message : "Access denied."}
        </p>
      </div>
    );
  }

  const user = await adminDb.user.findUniqueOrThrow({
    where: { id: ctx.userId },
  });

  // Hiding a link the role can't use is a usability nicety, not the
  // security boundary -- every underlying page still enforces its own
  // permission check server-side regardless of what the nav shows
  // (FIG-437 section 10: "Role-specific UI improves usability but is not
  // a security boundary").
  const canViewLeads =
    hasPermission(ctx, "leads.view.own") ||
    hasPermission(ctx, "leads.view.all");
  const canViewDeals =
    hasPermission(ctx, "deals.view.own") ||
    hasPermission(ctx, "deals.view.all");
  const canViewTasks =
    hasPermission(ctx, "tasks.view.own") ||
    hasPermission(ctx, "tasks.view.all");
  const canViewReports =
    hasPermission(ctx, "reporting.view.own") ||
    hasPermission(ctx, "reporting.view.all");

  return (
    <>
      <nav className="nav">
        <strong>FigBloom CRM</strong>
        <a href={`/o/${orgSlug}`}>Dashboard</a>
        {canViewLeads && <a href={`/o/${orgSlug}/leads`}>Leads</a>}
        {canViewDeals && <a href={`/o/${orgSlug}/deals`}>Deals</a>}
        {canViewTasks && <a href={`/o/${orgSlug}/tasks`}>Tasks</a>}
        {canViewReports && <a href={`/o/${orgSlug}/reports`}>Reports</a>}
        {hasPermission(ctx, "companies.view") && (
          <a href={`/o/${orgSlug}/companies`}>Companies</a>
        )}
        {hasPermission(ctx, "contacts.view") && (
          <a href={`/o/${orgSlug}/contacts`}>Contacts</a>
        )}
        <div className="spacer" />
        <span className="who">
          {user.name} &middot; {ctx.roleKey}
        </span>
        <LogoutButton />
      </nav>
      <div className="page">{children}</div>
    </>
  );
}
