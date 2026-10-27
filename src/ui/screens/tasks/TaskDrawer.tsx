"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiRequestError } from "@/api-client";
import { describeError, fieldErrorMap, Input, LoadingState, Select, Textarea, useApi, useApiQuery, useDirtyGuard, useMember, useToast } from "@/ui";
import { Portal, useFocusTrap } from "@/ui/internal";
import { useAssignees, useRefreshTasks } from "./hooks";
import { fromDateTimeLocal, toDateTimeLocal, type LinkType, type TaskPriority, type TaskStatus, STATUS_LABEL } from "./model";
import { RecordPicker, type PickedRecord } from "./RecordPicker";

export interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Prefills the due time (a calendar slot). */
  initialDue?: Date;
  /** Prefills the linked record (a task made from a record's page). */
  link?: { type: LinkType; id: string; label?: string };
  /** Edit this task instead of creating one. */
  taskId?: string | null;
  /** Calendar slots may add a meeting or a call as well as a task. */
  allowActivities?: boolean;
  /** Opens as a call or a meeting (the home's "Log a call"); a call or meeting needs a linked record. */
  initialKind?: "CALL" | "MEETING";
  /** Called with what was created or saved. */
  onSaved?: () => void;
}

type Kind = "task" | "MEETING" | "CALL";

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

interface Form {
  kind: Kind;
  title: string;
  description: string;
  due: string;
  priority: TaskPriority;
  assigneeId: string;
  status: TaskStatus;
  link: PickedRecord | null;
}

/**
 * The New task drawer from the design (title, description, due, priority, assignee, linked record), also used to edit a task and, from a
 * calendar slot, to add a meeting or a call. Anyone can give a task to themselves; assigning to someone else needs `tasks.assign.any` and the
 * field says so rather than disappearing.
 */
export function TaskDrawer(props: TaskDrawerProps) {
  if (!props.open) return null;
  return (
    <Portal>
      <Body {...props} />
    </Portal>
  );
}

function Body({ onClose, initialDue, link, taskId, allowActivities, initialKind, onSaved }: TaskDrawerProps) {
  const { orgSlug, membershipId, timeZone, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshTasks();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const editing = Boolean(taskId);
  // One key per drawer: a double click or a retry after a dropped connection creates the record once.
  const keyRef = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
  useFocusTrap(ref, onClose);

  const tomorrow = new Date(Date.now() + 864e5);
  const [form, setForm] = useState<Form>({
    kind: initialKind ?? "task",
    title: "",
    description: "",
    due: toDateTimeLocal(initialDue ?? tomorrow, timeZone ?? undefined),
    priority: "MEDIUM",
    assigneeId: membershipId,
    status: "PENDING",
    link: link ? { type: link.type, id: link.id, label: link.label ?? link.type } : null,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  useDirtyGuard(dirty);

  const assignees = useAssignees();
  const canAssign = can("tasks.assign.any");

  const existing = useApiQuery("getTasksByTaskId", { params: { orgSlug, taskId: taskId ?? "" } }, { enabled: editing });
  const loaded = useRef(false);
  useEffect(() => {
    const t = existing.data;
    if (!t || loaded.current) return;
    loaded.current = true;
    const linkId = (t.leadId as string | null) ?? (t.dealId as string | null) ?? (t.companyId as string | null) ?? (t.contactId as string | null);
    const linkType: LinkType | null = t.leadId ? "Lead" : t.dealId ? "Deal" : t.companyId ? "Company" : t.contactId ? "Contact" : null;
    setForm({
      kind: "task",
      title: t.title,
      description: (t.description as string | null) ?? "",
      due: t.dueAt ? toDateTimeLocal(new Date(t.dueAt), timeZone ?? undefined) : "",
      priority: t.priority as TaskPriority,
      assigneeId: t.assigneeMembershipId,
      status: t.status as TaskStatus,
      link: linkId && linkType ? { type: linkType, id: linkId, label: linkType } : null,
    });
  }, [existing.data, timeZone]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  const titleError = titleTouched && !form.title.trim() ? "Give it a short title so you can find it later." : errors.title;
  const isTask = form.kind === "task";

  async function save() {
    setTitleTouched(true);
    if (!form.title.trim()) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const due = form.due ? fromDateTimeLocal(form.due, timeZone ?? undefined).toISOString() : undefined;
      const linkIds = form.link ? ({ Lead: "leadId", Deal: "dealId", Company: "companyId", Contact: "contactId" } as const)[form.link.type] : null;
      if (editing && taskId) {
        await api.call("patchTasksByTaskId", {
          params: { orgSlug, taskId },
          body: {
            title: form.title.trim(),
            description: form.description.trim() || null,
            dueAt: due ?? null,
            priority: form.priority,
            status: form.status,
            ...(canAssign && form.assigneeId !== existing.data?.assigneeMembershipId ? { assigneeMembershipId: form.assigneeId } : {}),
          },
        });
        toast.show({ tone: "success", message: "Task saved." });
      } else if (isTask) {
        await api.call("postTasks", {
          params: { orgSlug },
          idempotencyKey: keyRef.current,
          body: {
            title: form.title.trim(),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            ...(due ? { dueAt: due } : {}),
            priority: form.priority,
            ...(canAssign && form.assigneeId !== membershipId ? { assigneeMembershipId: form.assigneeId } : {}),
            ...(form.link && linkIds ? { [linkIds]: form.link.id } : {}),
          },
        });
        toast.show({ tone: "success", message: "Task created." });
      } else {
        await api.call("postCalendar", {
          params: { orgSlug },
          idempotencyKey: keyRef.current,
          body: {
            kind: "activity",
            type: form.kind === "CALL" ? "CALL" : "MEETING",
            title: form.title.trim(),
            start: due ?? new Date().toISOString(),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            ...(form.link ? { link: { type: form.link.type, id: form.link.id } } : {}),
          },
        });
        toast.show({ tone: "success", message: form.kind === "MEETING" ? "Meeting added." : "Call added." });
      }
      setDirty(false);
      refresh();
      onSaved?.();
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && error.envelope.fieldErrors?.length) {
        const map = fieldErrorMap(error.envelope.fieldErrors);
        setErrors(map);
        if (!Object.keys(map).length) setFormError(error.message);
      } else {
        setFormError(describeError(error).body);
      }
    } finally {
      setSaving(false);
    }
  }

  const cta = editing ? "Save changes" : isTask ? "Create task" : form.kind === "MEETING" ? "Add meeting" : "Add call";
  const heading = editing ? "Edit task" : isTask ? "New task" : form.kind === "MEETING" ? "New meeting" : "New call";
  const sub = editing ? "Change who, what or when." : isTask ? "Who does what, by when." : "Put it on the calendar.";

  const assigneeOptions = canAssign && assignees.members.length ? assignees.members : [{ membershipId, name: "Me" }];

  return (
    <div className="fb-tk-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fb-tk-drawer" tabIndex={-1}>
        <div className="fb-tk-drawer__head">
          <div style={{ flex: 1 }}>
            <h2 id={titleId} className="fb-tk-drawer__title">{heading}</h2>
            <p className="fb-tk-drawer__sub">{sub}</p>
          </div>
          <button type="button" className="fb-tk-drawer__close" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </div>
        <form
          className="fb-tk-drawer__body"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          {editing && existing.isLoading ? <LoadingState lines={4} /> : null}
          {existing.isError ? <p className="fb-error" role="alert">{describeError(existing.error).body}</p> : null}
          {formError ? <p className="fb-error" role="alert">{formError}</p> : null}

          {allowActivities && !editing ? (
            <div className="fb-tk-field">
              <span className="fb-label" id={`${titleId}-kind`}>What are you adding?</span>
              <div className="fb-tk-seg" role="radiogroup" aria-labelledby={`${titleId}-kind`}>
                {([["task", "Task"], ["MEETING", "Meeting"], ["CALL", "Call"]] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={form.kind === value} className="fb-tk-seg__opt" data-on={form.kind === value} onClick={() => set("kind", value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <Input
            label="Title"
            required
            placeholder={isTask ? "What needs doing?" : "What is it about?"}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            onBlur={() => setTitleTouched(true)}
            error={titleError}
            autoFocus
          />
          <Textarea label="Description" rows={3} placeholder="Details, links, next steps..." value={form.description} onChange={(e) => set("description", e.target.value)} />
          <Input label={isTask ? "Due" : "When"} type="datetime-local" value={form.due} onChange={(e) => set("due", e.target.value)} error={errors.dueAt ?? errors.start} />

          {isTask ? (
            <div className="fb-tk-field">
              <span className="fb-label" id={`${titleId}-prio`}>Priority</span>
              <div className="fb-tk-prio" role="radiogroup" aria-labelledby={`${titleId}-prio`}>
                {PRIORITIES.map((p) => (
                  <button key={p.value} type="button" role="radio" aria-checked={form.priority === p.value} className="fb-tk-prio__opt" data-on={form.priority === p.value} onClick={() => set("priority", p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {editing ? (
            <Select
              label="Status"
              value={form.status}
              onChange={(e) => set("status", e.target.value as TaskStatus)}
              options={(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
          ) : null}

          {isTask ? (
            <Select
              label="Assignee"
              value={form.assigneeId}
              onChange={(e) => set("assigneeId", e.target.value)}
              disabled={!canAssign}
              disabledReason={canAssign ? undefined : "You can assign tasks to yourself. Management can assign to anyone."}
              options={assigneeOptions.map((m) => ({ value: m.membershipId, label: m.membershipId === membershipId ? `${m.name} (me)`.replace("Me (me)", "Me") : m.name }))}
            />
          ) : null}

          <RecordPicker value={form.link} onChange={(r) => set("link", r)} label={isTask ? "Linked record" : "Linked record (required)"} help={errors.link ?? (isTask ? undefined : "A call or meeting is logged against a lead, deal, company or contact.")} />
        </form>
        <div className="fb-tk-drawer__foot">
          <button type="button" className="fb-tk-btn fb-tk-btn--secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="fb-tk-btn fb-tk-btn--primary" aria-disabled={saving || !form.title.trim() || undefined} disabled={saving} onClick={() => void save()}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            {saving ? "Saving…" : cta}
          </button>
        </div>
      </aside>
    </div>
  );
}
