"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Combobox, type ComboOption } from "../_shared/Combobox";
import { IconLock, IconPlus } from "../_shared/icons";
import { PRIORITY_LABELS, type TaskAssigneeOption, type TaskPriority } from "./taskTypes";

/**
 * New-task form for the Tasks page. People with `tasks.assign.any`
 * (Management) can give the task to anyone who can open tasks; everyone
 * else's new task is always assigned to themselves, shown as a locked
 * line -- the server ignores any other assignee from them anyway.
 */
export function CreateTaskForm({
  orgSlug,
  assignees,
  defaultAssigneeMembershipId,
  selfName,
}: {
  orgSlug: string;
  assignees: TaskAssigneeOption[];
  defaultAssigneeMembershipId: string;
  selfName: string;
}) {
  const router = useRouter();
  const canChooseAssignee = assignees.length > 0;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assigneeMembershipId, setAssigneeMembershipId] = useState(
    assignees.some((a) => a.membershipId === defaultAssigneeMembershipId)
      ? defaultAssigneeMembershipId
      : (assignees[0]?.membershipId ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const assigneeOptions: ComboOption[] = assignees.map((a) => ({
    value: a.membershipId,
    label: a.userName,
    sublabel: a.roleName,
    avatarLabel: a.userName.slice(0, 2).toUpperCase(),
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description.trim() || undefined,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
          priority,
          assigneeMembershipId:
            canChooseAssignee && assigneeMembershipId !== defaultAssigneeMembershipId
              ? assigneeMembershipId
              : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to create task.");
      setTitle("");
      setDescription("");
      setDueAt("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack deal-form" onSubmit={handleSubmit}>
      <div className="form-section">Task</div>
      <label>
        Title
        <input
          value={title}
          placeholder="What needs doing?"
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label>
        Description
        <textarea
          value={description}
          placeholder="Details, links, next steps..."
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="form-section">Timing &amp; priority</div>
      <label>
        Due
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </label>
      <div className="lead-edit-field">
        <label>Priority</label>
        <div className="seg" role="radiogroup" aria-label="Priority">
          {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={priority === p}
              className={`seg-option seg-p-${p.toLowerCase()}${priority === p ? " is-on" : ""}`}
              onClick={() => setPriority(p)}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="form-section">Assignee</div>
      {canChooseAssignee ? (
        <Combobox
          value={assigneeMembershipId}
          options={assigneeOptions}
          onChange={setAssigneeMembershipId}
          ariaLabel="Assignee"
          width={300}
        />
      ) : (
        <div>
          <div className="lead-edit-locked">
            <span>{selfName} (you)</span>
            <IconLock />
          </div>
          <p className="lead-edit-help">
            New tasks are assigned to you. Only Management can assign tasks to
            other people.
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn-block" disabled={submitting || !title.trim()}>
        <IconPlus />
        {submitting ? "Creating..." : "Create task"}
      </button>
    </form>
  );
}
