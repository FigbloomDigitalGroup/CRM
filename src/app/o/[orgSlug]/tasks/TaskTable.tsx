"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";
import { IconCheck, IconEdit, IconOpen } from "../_shared/icons";
import { EditTaskDrawer } from "./EditTaskDrawer";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskAssigneeOption,
  type TaskRowData,
  type TaskStatus,
} from "./taskTypes";

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

const STATUS_OPTIONS: ComboOption[] = (Object.keys(STATUS_LABELS) as TaskStatus[]).map(
  (s) => ({ value: s, label: STATUS_LABELS[s] }),
);

function priorityTone(priority: TaskRowData["priority"]) {
  if (priority === "HIGH") return "red";
  if (priority === "MEDIUM") return "orange";
  return "blue";
}

/**
 * The tasks table. Who may change what comes in per row (`canManage`,
 * `canReassign`, computed on the server from the same rule `taskService`
 * enforces): people who can manage a task get a quick complete tick, a
 * status picker and an Edit button; everyone else gets a read-only row.
 */
export function TaskTable({
  orgSlug,
  tasks,
  assignees,
  showAssignee,
  emptyMessage,
}: {
  orgSlug: string;
  tasks: TaskRowData[];
  assignees: TaskAssigneeOption[];
  showAssignee: boolean;
  emptyMessage: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editing = tasks.find((t) => t.id === editingId) ?? null;

  async function setStatus(task: TaskRowData, status: TaskStatus) {
    if (status === task.status) return;
    setBusyId(task.id);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update task.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && (
        <p className="error table-error" role="alert">
          {error}
        </p>
      )}
      <table className="data-table task-table">
        <thead>
          <tr>
            <th className="tick-col" aria-label="Done" />
            <th>Task</th>
            {showAssignee && <th>Assignee</th>}
            <th>Due</th>
            <th>Priority</th>
            <th>Status</th>
            <th className="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              id={`task-${task.id}`}
              className={task.isClosed ? "is-closed" : undefined}
            >
              <td className="tick-col">
                {task.canManage && task.status !== "CANCELLED" ? (
                  <button
                    type="button"
                    className={`task-tick${task.status === "COMPLETED" ? " is-done" : ""}`}
                    disabled={busyId === task.id}
                    aria-label={
                      task.status === "COMPLETED" ? "Reopen task" : "Mark task completed"
                    }
                    title={task.status === "COMPLETED" ? "Reopen" : "Mark completed"}
                    onClick={() =>
                      setStatus(task, task.status === "COMPLETED" ? "PENDING" : "COMPLETED")
                    }
                  >
                    <IconCheck size={13} />
                  </button>
                ) : (
                  <span
                    className={`task-tick is-static${task.status === "COMPLETED" ? " is-done" : ""}`}
                    aria-hidden="true"
                  >
                    {task.status === "COMPLETED" && <IconCheck size={13} />}
                  </span>
                )}
              </td>
              <td className="task-title-cell">
                <div className="task-title">{task.title}</div>
                {task.description && (
                  <div className="task-desc">
                    {task.description.length > 90
                      ? `${task.description.slice(0, 90)}...`
                      : task.description}
                  </div>
                )}
                {task.link &&
                  (task.link.href && task.link.label ? (
                    <a className="task-link" href={task.link.href}>
                      {task.link.type} &middot; {task.link.label}
                      <IconOpen size={12} />
                    </a>
                  ) : (
                    <span className="task-link is-locked">
                      Linked {task.link.type.toLowerCase()}
                    </span>
                  ))}
              </td>
              {showAssignee && (
                <td>
                  {task.assigneeName ? (
                    <span className="owner-chip">
                      <span className="owner-chip-avatar">{initialsFor(task.assigneeName)}</span>
                      {task.assigneeName}
                    </span>
                  ) : (
                    <span className="owner-chip is-unassigned">--</span>
                  )}
                </td>
              )}
              <td className="nowrap">
                {task.dueLabel ? (
                  <span className={`due due-${task.dueState}`}>{task.dueLabel}</span>
                ) : (
                  <span className="due due-none">No due date</span>
                )}
              </td>
              <td className="nowrap">
                <span className={`badge badge-${priorityTone(task.priority)}`}>
                  {PRIORITY_LABELS[task.priority]}
                </span>
              </td>
              <td className="nowrap">
                {task.canManage ? (
                  <Combobox
                    value={task.status}
                    options={STATUS_OPTIONS}
                    onChange={(v) => setStatus(task, v as TaskStatus)}
                    disabled={busyId === task.id}
                    width={190}
                    ariaLabel="Task status"
                  />
                ) : (
                  <span className={`status-pill status-${task.status.toLowerCase()}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                )}
              </td>
              <td className="actions-col">
                <div className="row-actions">
                  {task.canManage ? (
                    <button
                      type="button"
                      className="row-action-btn"
                      onClick={() => setEditingId(task.id)}
                      aria-label="Edit task"
                      title="Edit task"
                    >
                      <IconEdit />
                    </button>
                  ) : (
                    <span className="row-action-note">View only</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={showAssignee ? 7 : 6}>{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && (
        <EditTaskDrawer
          orgSlug={orgSlug}
          task={editing}
          assignees={assignees}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}
