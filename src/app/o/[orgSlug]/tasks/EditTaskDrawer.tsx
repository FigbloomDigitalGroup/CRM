"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Combobox, type ComboOption } from "../_shared/Combobox";
import { IconClose, IconLock } from "../_shared/icons";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type TaskAssigneeOption,
  type TaskPriority,
  type TaskRowData,
  type TaskStatus,
} from "./taskTypes";

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Slide-in editor for one task. Details (title, description, due, priority,
 * assignee) lock once a task is Completed or Cancelled -- reopen it first --
 * and the Assignee is a real picker only for people with `tasks.assign.any`
 * (Management); everyone else sees it locked. The API enforces the same.
 */
export function EditTaskDrawer({
  orgSlug,
  task,
  assignees,
  onClose,
}: {
  orgSlug: string;
  task: TaskRowData;
  assignees: TaskAssigneeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? "",
    dueAt: task.dueAtInput,
    priority: task.priority as TaskPriority,
    status: task.status as TaskStatus,
    assigneeMembershipId: task.assigneeMembershipId,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Details are editable while the task is open, or the moment it is being
  // reopened from Completed/Cancelled in this same save.
  const reopening = form.status === "PENDING" || form.status === "IN_PROGRESS";
  const detailsLocked = task.isClosed && !reopening;

  const statusOptions: ComboOption[] = (Object.keys(STATUS_LABELS) as TaskStatus[]).map(
    (s) => ({ value: s, label: STATUS_LABELS[s] }),
  );
  const assigneeOptions: ComboOption[] = assignees.map((a) => ({
    value: a.membershipId,
    label: a.userName,
    sublabel: a.roleName,
    avatarLabel: initialsFor(a.userName),
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!detailsLocked && !form.title.trim()) {
      setError("A task needs a title.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (form.status !== task.status) body.status = form.status;
      if (!detailsLocked) {
        body.title = form.title.trim();
        body.description = form.description.trim() ? form.description : null;
        body.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
        body.priority = form.priority;
        if (task.canReassign && form.assigneeMembershipId !== task.assigneeMembershipId) {
          body.assigneeMembershipId = form.assigneeMembershipId;
        }
      }
      const res = await fetch(`/api/orgs/${orgSlug}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to update task.");
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task.");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label="Edit task">
        <header className="drawer-head">
          <div>
            <div className="drawer-title">Edit task</div>
            <div className="drawer-sub">
              {task.link
                ? `${task.link.type}${task.link.label ? ` · ${task.link.label}` : ""}`
                : "Not linked to a record"}
            </div>
          </div>
          <button type="button" className="row-action-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        <form className="lead-edit-form" onSubmit={handleSubmit}>
          <div className="lead-edit-body">
            {detailsLocked && (
              <p className="lead-edit-note">
                This task is {STATUS_LABELS[task.status].toLowerCase()}. Set its
                status back to Pending or In progress to change its details.
              </p>
            )}

            <div className="lead-edit-field">
              <label>Title</label>
              <input
                value={form.title}
                disabled={detailsLocked}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className="lead-edit-field">
              <label>Status</label>
              <Combobox
                value={form.status}
                options={statusOptions}
                onChange={(v) => setForm({ ...form, status: v as TaskStatus })}
                ariaLabel="Status"
                width={280}
              />
            </div>

            <div className="lead-edit-field">
              <label>Priority</label>
              <div className="seg" role="radiogroup" aria-label="Priority">
                {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={form.priority === p}
                    disabled={detailsLocked}
                    className={`seg-option seg-p-${p.toLowerCase()}${
                      form.priority === p ? " is-on" : ""
                    }`}
                    onClick={() => setForm({ ...form, priority: p })}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            <div className="lead-edit-field">
              <label>Due</label>
              <input
                type="datetime-local"
                value={form.dueAt}
                disabled={detailsLocked}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>

            <div className="lead-edit-field">
              <label>Description</label>
              <textarea
                value={form.description}
                disabled={detailsLocked}
                placeholder="Details, links, next steps..."
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="lead-edit-field">
              <label>Assignee</label>
              {task.canReassign && !detailsLocked ? (
                <>
                  <Combobox
                    value={form.assigneeMembershipId}
                    options={assigneeOptions}
                    onChange={(v) => setForm({ ...form, assigneeMembershipId: v })}
                    ariaLabel="Assignee"
                    width={280}
                  />
                  <p className="lead-edit-help">
                    Only people who can open tasks are listed.
                  </p>
                </>
              ) : (
                <>
                  <div className="lead-edit-locked">
                    <span>{task.assigneeName ?? "--"}</span>
                    <IconLock />
                  </div>
                  <p className="lead-edit-help">
                    Only Management can assign tasks to other people.
                  </p>
                </>
              )}
            </div>

            {error && <p className="error">{error}</p>}
          </div>
          <div className="lead-edit-footer">
            <span className="lead-edit-footer-spacer" />
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </aside>
    </div>,
    document.body,
  );
}
