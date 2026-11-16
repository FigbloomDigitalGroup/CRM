"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiRequestError } from "@/api-client";
import { DateTimeField, defaultFollowUp, describeError, fieldErrorMap, Input, LoadingState, Select, Textarea, useApi, useApiQuery, useDirtyGuard, useMember, useToast } from "@/ui";
import { Portal, useFocusTrap } from "@/ui/internal";
import { useAssignees, useRefreshTasks } from "./hooks";
import { type LinkType, type TaskPriority, type TaskStatus, STATUS_LABEL } from "./model";
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
  /** Opens as a call or a meeting (the home's "Log a call"), or another kind. */
  initialKind?: Exclude<Kind, "task">;
  /** Called with what was created or saved. */
  onSaved?: () => void;
}

/** What the item is. Everything is one task record with a type, so the Calendar and the Tasks page always show the same things (P2-22). */
type Kind = "task" | "CALL" | "MEETING" | "EMAIL" | "QUOTE" | "VISIT";
const KIND_CHOICES: { value: Kind; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "EMAIL", label: "Email" },
  { value: "QUOTE", label: "Send quote" },
  { value: "VISIT", label: "Visit" },
];
const KIND_NOUN: Record<Kind, string> = { task: "task", CALL: "call", MEETING: "meeting", EMAIL: "email", QUOTE: "quote", VISIT: "visit" };
const toTaskType = (k: Kind) => (k === "task" ? "TASK" : k);
const fromTaskType = (t: string | null | undefined): Kind => (t && t !== "TASK" && KIND_CHOICES.some((c) => c.value === t) ? (t as Kind) : "task");

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
  const [initialNow] = useState(() => new Date());
  const titleId = useId();
  const editing = Boolean(taskId);
  // One key per drawer: a double click or a retry after a dropped connection creates the record once.
  const keyRef = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
  useFocusTrap(ref, onClose);

  const tomorrow = defaultFollowUp(initialNow, timeZone);
  const [form, setForm] = useState<Form>({
    kind: initialKind ?? "task",
    title: "",
    description: "",
    due: (initialDue ?? tomorrow).toISOString(),
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
      kind: fromTaskType(t.type as string | undefined),
      title: t.title,
      description: (t.description as string | null) ?? "",
      due: t.dueAt ? new Date(t.dueAt).toISOString() : "",
      priority: t.priority as TaskPriority,
      assigneeId: t.assigneeMembershipId,
      status: t.status as TaskStatus,
      link: linkId && linkType ? { type: linkType, id: linkId, label: linkType } : null,
    });
  }, [existing.data]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  const titleError = titleTouched && !form.title.trim() ? "Give it a short title so you can find it later." : errors.title;
  const isTask = form.kind === "task";
  const noun = KIND_NOUN[form.kind];

  async function save() {
    setTitleTouched(true);
    if (!form.title.trim()) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const due = form.due || undefined;
      const linkIds = form.link ? ({ Lead: "leadId", Deal: "dealId", Company: "companyId", Contact: "contactId" } as const)[form.link.type] : null;
      if (editing && taskId) {
        await api.call("patchTasksByTaskId", {
          params: { orgSlug, taskId },
          body: {
            title: form.title.trim(),
            description: form.description.trim() || null,
            dueAt: due ?? null,
            type: toTaskType(form.kind),
            priority: form.priority,
            status: form.status,
            ...(canAssign && form.assigneeId !== existing.data?.assigneeMembershipId ? { assigneeMembershipId: form.assigneeId } : {}),
          },
        });
        toast.show({ tone: "success", message: "Task saved." });
      } else {
        await api.call("postTasks", {
          params: { orgSlug },
          idempotencyKey: keyRef.current,
          body: {
            title: form.title.trim(),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            ...(due ? { dueAt: due } : {}),
            type: toTaskType(form.kind),
            priority: form.priority,
            ...(canAssign && form.assigneeId !== membershipId ? { assigneeMembershipId: form.assigneeId } : {}),
            ...(form.link && linkIds ? { [linkIds]: form.link.id } : {}),
          },
        });
        toast.show({ tone: "success", message: `${KIND_NOUN[form.kind][0]!.toUpperCase()}${KIND_NOUN[form.kind].slice(1)} added.` });
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

  const cta = editing ? "Save changes" : isTask ? "Create task" : `Add ${noun}`;
  const heading = editing ? (isTask ? "Edit task" : `Edit ${noun}`) : `New ${noun}`;
  const sub = editing ? "Change who, what or when." : isTask ? "Who does what, by when." : "It shows on the Calendar and on the Tasks page.";

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

          {(allowActivities ?? true) ? (
            <div className="fb-tk-field">
              <span className="fb-label" id={`${titleId}-kind`}>What are you adding?</span>
              <div className="fb-tk-seg" role="radiogroup" aria-labelledby={`${titleId}-kind`}>
                {KIND_CHOICES.map(({ value, label }) => (
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
          <DateTimeField label={isTask ? "Due" : "When"} value={form.due} onChange={(iso) => set("due", iso)} error={errors.dueAt ?? errors.start} />

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

          <Select
              label="Assignee"
              value={form.assigneeId}
              onChange={(e) => set("assigneeId", e.target.value)}
              disabled={!canAssign}
              disabledReason={canAssign ? undefined : "You can assign tasks to yourself. Management can assign to anyone."}
              options={assigneeOptions.map((m) => ({ value: m.membershipId, label: m.membershipId === membershipId ? `${m.name} (me)`.replace("Me (me)", "Me") : m.name }))}
            />

          <RecordPicker value={form.link} onChange={(r) => set("link", r)} label="Linked record" help={errors.link ?? "A lead, deal, company or contact. It shows on that record too."} />
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
