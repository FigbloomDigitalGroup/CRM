import { hasPermission, type AuthContext } from "@/auth/context";
import { canUseResource } from "@/auth/permissions";
import {
  IconCheck,
  IconDeals,
  IconLeads,
  IconLock,
  IconTasks,
} from "./icons";

function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Shown instead of a raw permission error when a role holds no permission
 * for a whole area (Leads or Deals). Explains why and points at the
 * nearest place the role can actually work.
 */
export function NoAccess({
  ctx,
  orgSlug,
  area,
}: {
  ctx: AuthContext;
  orgSlug: string;
  area: "Leads" | "Deals" | "Tasks" | "Companies" | "Contacts" | "Reports";
}) {
  const has = (k: string) => hasPermission(ctx, k);
  const roleName = titleCase(ctx.roleKey);
  const base = `/o/${orgSlug}`;
  const managedBy =
    area === "Leads"
      ? "the Sales and Management teams"
      : area === "Tasks"
        ? "the people they are assigned to"
        : area === "Companies" || area === "Contacts"
          ? "the Sales and Management teams"
          : area === "Reports"
            ? "the people who own the work being measured"
            : "the teams that work them";

  const canLeads = has("leads.view.all") || has("leads.view.own");
  const canDeals = canUseResource(ctx, "deals");
  const canTasks = has("tasks.view.all") || has("tasks.view.own");

  const abilities: { label: string; on: boolean }[] = [
    { label: "Leads", on: canLeads },
    { label: "Deals", on: canDeals },
    { label: "Companies", on: has("companies.view") },
    { label: "Contacts", on: has("contacts.view") },
    { label: "Payments", on: has("finance.view.payments") },
    { label: "Tasks", on: canTasks },
    {
      label: "Activity & communications",
      on: has("activities.view") || has("communications.view"),
    },
    { label: "Reports", on: has("reporting.view.all") || has("reporting.view.own") },
  ];

  const next =
    area !== "Deals" && canDeals
      ? { href: `${base}/deals`, label: "Go to Deals", icon: <IconDeals /> }
      : area !== "Leads" && canLeads
        ? { href: `${base}/leads`, label: "Go to Leads", icon: <IconLeads /> }
        : canTasks && area !== "Tasks"
          ? { href: `${base}/tasks`, label: "Go to Tasks", icon: <IconTasks /> }
          : null;

  return (
    <div className="no-access">
      <div className="no-access-badge">
        <IconLock size={26} />
      </div>
      <h1>{area} aren&rsquo;t available for your role</h1>
      <p>
        Your <strong>{roleName}</strong> role doesn&rsquo;t include access to{" "}
        {area.toLowerCase()} &mdash; they&rsquo;re managed by {managedBy}. If you
        think you need access, ask an administrator to review your role.
      </p>
      <div className="no-access-actions">
        {next && (
          <a className="btn-primary-link" href={next.href}>
            {next.icon}
            {next.label}
          </a>
        )}
        <a className="btn-ghost" href={base}>
          Back to dashboard
        </a>
      </div>
      <div className="no-access-card">
        <div className="no-access-card-title">What your role can do</div>
        <div className="no-access-chips">
          {abilities
            .filter((a) => a.on || a.label === area)
            .map((a) => (
              <span key={a.label} className={`no-access-chip${a.on ? "" : " is-off"}`}>
                {a.on && <IconCheck size={14} />}
                {a.label}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
