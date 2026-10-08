import { hasPermission } from "@/auth/context";
import { ForbiddenError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { getFormReferenceData } from "@/services/referenceDataService";
import { listTasks } from "@/services/taskService";
import { TaskSection } from "../_shared/TaskSection";

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ overdueOnly?: string; status?: string }>;
}) {
  const { orgSlug } = await params;
  const { overdueOnly, status } = await searchParams;
  const ctx = await resolveRequestContext(orgSlug);

  // Finance has no tasks.* permission at all -- listTasks() fails closed
  // rather than returning [], same pattern as Leads/Deals.
  let tasks;
  try {
    tasks = await listTasks(ctx, {
      overdueOnly: overdueOnly === "true",
      status: status as
        | "PENDING"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "CANCELLED"
        | undefined,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <p className="error">Your role does not have access to Tasks.</p>;
    }
    throw err;
  }

  const referenceData = await getFormReferenceData(ctx);

  return (
    <div>
      <h1>Tasks</h1>
      <p className="who">
        {hasPermission(ctx, "tasks.view.all")
          ? "Showing all organization tasks (tasks.view.all)."
          : "Showing only tasks assigned to you (tasks.view.own) -- enforced server-side."}
      </p>

      <form className="filters" method="GET">
        <select name="status" defaultValue={status ?? ""}>
          <option value="">Any status</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <label>
          <input
            type="checkbox"
            name="overdueOnly"
            value="true"
            defaultChecked={overdueOnly === "true"}
          />{" "}
          Overdue only
        </label>
        <button type="submit" className="secondary">
          Filter
        </button>
      </form>

      <TaskSection
        orgSlug={orgSlug}
        tasks={tasks.map((t) => ({
          ...t,
          dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        }))}
        members={referenceData.members}
        canCreate={hasPermission(ctx, "tasks.create")}
        canAssignAny={hasPermission(ctx, "tasks.assign.any")}
        layout="split"
      />
    </div>
  );
}
