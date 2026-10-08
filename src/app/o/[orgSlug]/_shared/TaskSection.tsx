"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

const STATUSES: TaskStatus[] = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

interface Task {
  id: string;
  title: string;
  description: string | null;
  assigneeMembershipId: string;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
}

interface Member {
  membershipId: string;
  userName: string;
}

function isOverdue(task: Task) {
  return (
    task.dueAt !== null &&
    new Date(task.dueAt).getTime() < Date.now() &&
    (task.status === "PENDING" || task.status === "IN_PROGRESS")
  );
}

/**
 * Reused as both the standalone Tasks page's list and the compact "linked
 * tasks" section on Lead/Deal detail pages (FIG-441). `layout="split"` (the
 * standalone page) puts the create-task form in a side rail next to the
 * table; the default "stacked" (the compact widget embedded in a detail
 * page's narrower column) keeps table and form in one card as before.
 */
export function TaskSection({
  orgSlug,
  parentField,
  parentId,
  tasks,
  members,
  canCreate,
  canAssignAny,
  layout = "stacked",
}: {
  orgSlug: string;
  parentField?: "companyId" | "contactId" | "leadId" | "dealId";
  parentId?: string;
  tasks: Task[];
  members: Member[];
  canCreate: boolean;
  canAssignAny: boolean;
  layout?: "stacked" | "split";
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assigneeMembershipId, setAssigneeMembershipId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const assigneeName = (membershipId: string) =>
    members.find((m) => m.membershipId === membershipId)?.userName ?? "--";

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dueAt: dueAt || undefined,
          priority,
          assigneeMembershipId: assigneeMembershipId || undefined,
          ...(parentField && parentId ? { [parentField]: parentId } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create task.");
      setTitle("");
      setDueAt("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(taskId: string, status: string) {
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update task.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task.");
    }
  }

  const tasksTable = (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Assignee</th>
          <th>Due</th>
          <th>Priority</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td>{assigneeName(t.assigneeMembershipId)}</td>
            <td className={isOverdue(t) ? "overdue" : undefined}>
              {t.dueAt ? new Date(t.dueAt).toLocaleString() : "--"}
              {isOverdue(t) && " (overdue)"}
            </td>
            <td>{t.priority}</td>
            <td>
              <select
                value={t.status}
                onChange={(e) => handleStatusChange(t.id, e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
        {tasks.length === 0 && (
          <tr>
            <td colSpan={5}>No tasks.</td>
          </tr>
        )}
      </tbody>
    </table>
  );

  const createForm = canCreate && (
    <form className="stack" onSubmit={handleCreate}>
      <label>
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label>
        Due
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </label>
      <label>
        Priority
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
      </label>
      {canAssignAny && (
        <label>
          Assignee
          <select
            value={assigneeMembershipId}
            onChange={(e) => setAssigneeMembershipId(e.target.value)}
          >
            <option value="">(myself)</option>
            {members.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.userName}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Creating..." : "Create task"}
      </button>
    </form>
  );

  if (layout === "split") {
    return (
      <div className="list-with-side">
        <div className="list-with-side-main">
          <div className="card">
            <strong>Tasks</strong>
            {tasksTable}
          </div>
        </div>
        {canCreate && (
          <div className="list-with-side-rail">
            <h2>New task</h2>
            <div className="card">{createForm}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <strong>Tasks</strong>
      {tasksTable}
      {createForm}
    </div>
  );
}
