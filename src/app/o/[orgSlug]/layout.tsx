import { redirect } from "next/navigation";
import { hasPermission } from "@/auth/context";
import { UnauthorizedError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminDb } from "@/db/adminClient";
import { LogoutButton } from "./LogoutButton";
import { Sidebar } from "./_shared/Sidebar";
import { ThemeToggle } from "./_shared/ThemeToggle";
import { NotificationBell } from "./_shared/NotificationBell";
import { IconChevronDown, IconSearch } from "./_shared/icons";

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
      redirect("/login");
    }
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="error">
            {err instanceof Error ? err.message : "Access denied."}
          </p>
        </div>
      </div>
    );
  }

  const user = await adminDb.user.findUniqueOrThrow({
    where: { id: ctx.userId },
  });

  // Hiding a link the role can't use is a usability nicety, not a security
  // boundary -- every page still enforces its own permission check
  // server-side regardless of what the nav shows.
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
  const canViewCompanies = hasPermission(ctx, "companies.view");
  const canViewContacts = hasPermission(ctx, "contacts.view");
  const canManageSettings = hasPermission(ctx, "configuration.manage");

  const roleName = ctx.roleKey
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");

  const now = new Date();
  // Intl doesn't reliably insert the weekday/date comma across runtimes --
  // built explicitly so it always reads "Thursday, 8 October · 10:04".
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  const dayMonth = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const datetime = `${weekday}, ${dayMonth} · ${time}`;

  return (
    <div className="app-shell">
      <Sidebar
        orgSlug={orgSlug}
        userName={user.name}
        roleName={roleName}
        canViewLeads={canViewLeads}
        canViewDeals={canViewDeals}
        canViewTasks={canViewTasks}
        canViewReports={canViewReports}
        canViewCompanies={canViewCompanies}
        canViewContacts={canViewContacts}
        canManageSettings={canManageSettings}
        logoutButton={<LogoutButton />}
      />
      <div className="main">
        <header className="topbar">
          <div>
            <p className="topbar-datetime">{datetime}</p>
          </div>
          <div className="topbar-search">
            <div className="topbar-search-box">
              <IconSearch />
              <input type="search" placeholder="Search Figbloom CRM" aria-label="Search Figbloom CRM" />
            </div>
          </div>
          <div className="topbar-right">
            <NotificationBell orgSlug={orgSlug} />
            <ThemeToggle />
            <details className="account-menu">
              <summary>
                <span className="pill">
                  <span className="avatar">
                    {user.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  {user.name}
                  <IconChevronDown />
                </span>
              </summary>
              <div className="account-menu-panel">
                <div className="account-menu-name">{user.name}</div>
                <div className="account-menu-role">{roleName}</div>
                <LogoutButton withLabel />
              </div>
            </details>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
