import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminDb } from "@/db/adminClient";
import { recordPageView } from "@/services/pageViewService";
import {
  describeTaskLinks,
  listAssignableTaskAssignees,
  listTasks,
  taskCapabilities,
} from "@/services/taskService";
import { NoAccess } from "../_shared/NoAccess";
import { IconShield } from "../_shared/icons";
import { FilterComboField } from "../leads/FilterComboField";
import { CreateTaskForm } from "./CreateTaskForm";
import { TaskTable } from "./TaskTable";
import type { TaskPriority, TaskRowData, TaskStatus } from "./taskTypes";

type View = "open" | "overdue" | "today" | "mine" | "completed" | "cancelled";

const LINK_PATHS: Record<string, string> = {
  Lead: "leads",
  Deal: "deals",
  Company: "companies",
  Contact: "contacts",
};

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function formatDue(due: Date, now: Date): string {
  const sameYear = due.getFullYear() === now.getFullYear();
  const date = due.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const time = due.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

/** `datetime-local` wants local wall-clock time without a zone. */
function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    q?: string;
    priority?: string;
    assigneeMembershipId?: string;
    view?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { q, priority, assigneeMembershipId, view: viewParam } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "tasks");

  const canViewAll = hasPermission(ctx, "tasks.view.all");
  const canAssignAny = hasPermission(ctx, "tasks.assign.any");
  const canCreate = hasPermission(ctx, "tasks.create");

  // Finance has no tasks.* permission at all, so listTasks() fails closed
  // rather than returning an empty list -- show an explanation and the
  // nearest page that role can use instead of an error.
  let allTasks;
  try {
    allTasks = await listTasks(ctx, {
      query: q || undefined,
      priority: ["LOW", "MEDIUM", "HIGH"].includes(priority ?? "")
        ? (priority as TaskPriority)
        : undefined,
      assigneeMembershipId: canViewAll ? assigneeMembershipId || undefined : undefined,
      take: 500,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <NoAccess ctx={ctx} orgSlug={orgSlug} area="Tasks" />;
    }
    throw err;
  }

  const [assignees, links, me] = await Promise.all([
    canAssignAny ? listAssignableTaskAssignees(ctx) : Promise.resolve([]),
    describeTaskLinks(ctx, allTasks),
    adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } }),
  ]);

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  type Row = (typeof allTasks)[number];
  const isOpen = (t: Row) => t.status === "PENDING" || t.status === "IN_PROGRESS";
  const isOverdue = (t: Row) => isOpen(t) && t.dueAt !== null && t.dueAt < now;
  const isDueToday = (t: Row) =>
    isOpen(t) && t.dueAt !== null && t.dueAt >= now && t.dueAt <= endOfToday;
  const isMine = (t: Row) => isOpen(t) && t.assigneeMembershipId === ctx.membershipId;

  const open = allTasks.filter(isOpen);
  const overdue = allTasks.filter(isOverdue);
  const dueToday = allTasks.filter(isDueToday);
  const completed = allTasks.filter((t) => t.status === "COMPLETED");
  const cancelled = allTasks.filter((t) => t.status === "CANCELLED");
  const completedThisWeek = completed.filter(
    (t) => t.completedAt !== null && t.completedAt >= weekAgo,
  );

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "open", label: "Open", count: open.length },
    { key: "overdue", label: "Overdue", count: overdue.length },
    { key: "today", label: "Due today", count: dueToday.length },
    ...(canViewAll
      ? [{ key: "mine" as View, label: "Assigned to me", count: allTasks.filter(isMine).length }]
      : []),
    { key: "completed", label: "Completed", count: completed.length },
    { key: "cancelled", label: "Cancelled", count: cancelled.length },
  ];

  const view: View = tabs.some((t) => t.key === viewParam) ? (viewParam as View) : "open";

  const byView: Record<View, Row[]> = {
    open,
    overdue,
    today: dueToday,
    mine: allTasks.filter(isMine),
    completed: [...completed].sort(
      (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    ),
    cancelled,
  };
  const visible = byView[view];

  const rows: TaskRowData[] = visible.map((t) => {
    const caps = taskCapabilities(ctx, t);
    const link = links[t.id];
    const closed = t.status === "COMPLETED" || t.status === "CANCELLED";
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      assigneeMembershipId: t.assigneeMembershipId,
      assigneeName: t.assigneeName,
      dueAtInput: t.dueAt ? toDateTimeLocal(t.dueAt) : "",
      dueLabel: t.dueAt
        ? isOverdue(t)
          ? `Overdue \u00b7 ${formatDue(t.dueAt, now)}`
          : isDueToday(t)
            ? `Today \u00b7 ${t.dueAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            : formatDue(t.dueAt, now)
        : null,
      dueState: closed
        ? "closed"
        : !t.dueAt
          ? "none"
          : isOverdue(t)
            ? "overdue"
            : isDueToday(t)
              ? "today"
              : "upcoming",
      priority: t.priority as TaskPriority,
      status: t.status as TaskStatus,
      link: link
        ? {
            type: link.type,
            label: link.label,
            href: link.label
              ? `/o/${orgSlug}/${LINK_PATHS[link.type]}/${link.id}`
              : null,
          }
        : null,
      canManage: caps.canManage,
      canReassign: caps.canReassign,
      isClosed: caps.isClosed,
    };
  });

  const tabHref = (key: View) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (priority) sp.set("priority", priority);
    if (canViewAll && assigneeMembershipId) sp.set("assigneeMembershipId", assigneeMembershipId);
    if (key !== "open") sp.set("view", key);
    const qs = sp.toString();
    return `/o/${orgSlug}/tasks${qs ? `?${qs}` : ""}`;
  };

  const emptyMessages: Record<View, string> = {
    open: "Nothing open right now. New tasks will appear here.",
    overdue: "Nothing is overdue. Nice work.",
    today: "Nothing else is due today.",
    mine: "You have no open tasks assigned to you.",
    completed: "No completed tasks yet.",
    cancelled: "No cancelled tasks.",
  };
  const filtered = Boolean(q || priority || assigneeMembershipId);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <div className="scope-line">
            <span className={`scope-pill ${canViewAll ? "is-all" : "is-own"}`}>
              {canViewAll ? "All organization tasks" : "My tasks"} &middot; {allTasks.length}
            </span>
            <span className="scope-text">
              {canViewAll
                ? "You can create, assign, edit and complete any task."
                : "Tasks assigned to you."}
            </span>
          </div>
        </div>
      </div>

      {!canViewAll && (
        <div className="scope-notice">
          <IconShield />
          <p>
            <strong>You&rsquo;re viewing only the tasks assigned to you.</strong>{" "}
            You can update and complete them and add new tasks for yourself.
            Assigning tasks to other people is handled by Management.
          </p>
        </div>
      )}

      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-blue" />Open tasks</div>
              <div className="kpi-value">{open.length}</div>
              <div className="kpi-sub">pending or in progress</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-red" />Overdue</div>
              <div className="kpi-value">{overdue.length}</div>
              <div className="kpi-sub">
                {overdue.length === 0 ? "all caught up" : "past their due time"}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-orange" />Due today</div>
              <div className="kpi-value">{dueToday.length}</div>
              <div className="kpi-sub">still to do before midnight</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label"><span className="stage-dot tone-green" />Completed</div>
              <div className="kpi-value">{completedThisWeek.length}</div>
              <div className="kpi-sub">in the last 7 days</div>
            </div>
          </div>

          <nav className="lead-tabs" aria-label="Task views">
            {tabs.map((t) => (
              <a
                key={t.key}
                href={tabHref(t.key)}
                className={`lead-tab${view === t.key ? " is-active" : ""}`}
                aria-current={view === t.key ? "page" : undefined}
              >
                {t.label}
                <span className="lead-tab-count">{t.count}</span>
              </a>
            ))}
          </nav>

          <form className="filters filters-bar" method="GET">
            {view !== "open" && <input type="hidden" name="view" value={view} />}
            <input
              className="filter-search"
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search tasks"
            />
            <FilterComboField
              name="priority"
              defaultValue={priority ?? ""}
              placeholder="Any priority"
              options={[
                { value: "", label: "Any priority" },
                { value: "HIGH", label: "High" },
                { value: "MEDIUM", label: "Medium" },
                { value: "LOW", label: "Low" },
              ]}
            />
            {canViewAll && (
              <FilterComboField
                name="assigneeMembershipId"
                defaultValue={assigneeMembershipId ?? ""}
                placeholder="Any assignee"
                options={[
                  { value: "", label: "Any assignee" },
                  ...assignees.map((a) => ({
                    value: a.membershipId,
                    label: a.userName,
                    sublabel: a.roleName,
                    avatarLabel: initialsFor(a.userName),
                  })),
                ]}
              />
            )}
            <button type="submit">Filter</button>
          </form>

          <div className="card table-card">
            <TaskTable
              orgSlug={orgSlug}
              tasks={rows}
              assignees={assignees}
              showAssignee={canViewAll}
              emptyMessage={filtered ? "No tasks match these filters." : emptyMessages[view]}
            />
            <div className="table-foot">
              <span>
                Showing {rows.length} task{rows.length === 1 ? "" : "s"}
              </span>
              {!canViewAll && <span>Only tasks assigned to you are shown</span>}
            </div>
          </div>
        </div>

        {canCreate && (
          <div className="list-with-side-rail">
            <h2>New task</h2>
            <div className="card">
              <CreateTaskForm
                orgSlug={orgSlug}
                assignees={assignees}
                defaultAssigneeMembershipId={ctx.membershipId}
                selfName={me.name}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
