"use client";

import { AlertTriangle, Calendar as CalendarIcon, CheckCircle2, Check, Info, ListChecks, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { describeError, NoAccess, queryKeyFor, useApiQuery, useMember } from "@/ui";
import { useSetTaskStatus } from "./hooks";
import { dueLabel, dueStateOf, isOpen, linkHref, PRIORITY_LABEL, STATUS_LABEL, type GroupKey, type TaskGroups, type TaskItem, type TaskPriority, type TaskStatus, type Zone } from "./model";

/* My work (D3) ---------------------------------------------------------------------------------------------------------------------- */

interface WorkItem {
  id: string;
  title: string;
  description?: string | null;
  requirements?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt?: string | null;
  files: { attachmentId: string; title: string | null; name: string; sizeBytes: number }[];
}

interface WorkGroups {
  timeZone: string;
  counts: Record<GroupKey, number>;
  groups: { key: GroupKey; label: string; count: number; items: WorkItem[] }[];
}

const bytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * The Restricted Technical home (D3): three tiles, the notice about what this role sees, and one card per assigned task with the client
 * requirements that go with it. The API returns nothing else about the work (no linked record, no deal, no customer, no value), so
 * the cards show nothing else either; that is the design's "internal" client line withheld on purpose.
 */
export function MyWorkList({ onCreate }: { onCreate?: () => void }) {
  const { orgSlug, timeZone, hour12, can } = useMember();
  const zone: Zone = useMemo(() => ({ timeZone: timeZone ?? undefined, hour12 }), [timeZone, hour12]);
  const args = { params: { orgSlug }, query: { pageSize: "50" } } as const;
  const q = useApiQuery("getMyWork", args);
  const key = queryKeyFor("getMyWork", args);
  const data = q.data as WorkGroups | undefined;
  const now = new Date();

  if (q.isError) {
    const d = describeError(q.error);
    if (d.kind === "noAccess") return <NoAccess area="My work" denial={d.denial} />;
    return (
      <div role="alert" className="fb-tk-error">
        <div className="fb-tk-error__title">Your work didn’t load</div>
        <p className="fb-tk-error__body">{d.body}</p>
        <button type="button" className="fb-tk-btn fb-tk-btn--primary" onClick={() => void q.refetch()}>Retry</button>
      </div>
    );
  }
  if (q.isLoading || !data) {
    return (
      <div className="fb-tk-skeletons" role="status" aria-busy="true">
        <span className="fb-sr-only">Loading your work</span>
        {[1, 2, 3].map((i) => (
          <div key={i} className="fb-tk-skel fb-tk-skel--tall" />
        ))}
      </div>
    );
  }

  const open = data.groups.filter((g) => g.key !== "DONE").flatMap((g) => g.items);
  const sorted = [...open].sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity));
  const assigned = data.counts.OVERDUE + data.counts.TODAY + data.counts.THIS_WEEK + data.counts.LATER + data.counts.NO_DATE;
  const thisWeek = data.counts.TODAY + data.counts.THIS_WEEK;
  const overdue = data.counts.OVERDUE;

  const tiles = [
    { label: "Assigned to me", n: assigned, sub: "open tasks", Icon: ListChecks, tbg: "var(--primary-soft)", tfg: "var(--primary-text)", red: false },
    { label: "Due this week", n: thisWeek, sub: "by Sunday", Icon: CalendarIcon, tbg: "var(--orange-soft)", tfg: "var(--orange-text)", red: false },
    { label: "Overdue", n: overdue, sub: overdue ? "needs a look" : "all clear", Icon: AlertTriangle, tbg: "var(--red-soft)", tfg: "var(--red)", red: true },
  ];

  return (
    <div className="fb-tk-mywork">
      <div className="fb-tk-kpis">
        {tiles.map((t) => (
          <Link key={t.label} href={`/o/${orgSlug}/tasks`} className="fb-tk-kpi">
            <span className="fb-tk-kpi__top">
              <span className="fb-tk-kpi__label">{t.label}</span>
              <span className="fb-tk-kpi__icon" style={{ background: t.tbg, color: t.tfg }} aria-hidden="true"><t.Icon size={18} /></span>
            </span>
            <span>
              <span className="fb-tk-kpi__n" style={{ color: t.red && t.n ? "var(--red)" : undefined }}>{t.n}</span>
              <span className="fb-tk-kpi__sub">{t.sub}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="fb-tk-notice" role="note">
        <Info size={17} aria-hidden="true" />
        <span>You see the tasks assigned to you and the client requirements that go with them. Your access to client data is logged in the audit history. Need context on something else? Ask Management.</span>
      </div>

      {sorted.length === 0 ? (
        <div className="fb-tk-emptycard">
          <span className="fb-tk-emptycard__icon" aria-hidden="true"><ListChecks size={26} /></span>
          <div className="fb-tk-emptycard__title">No work assigned yet</div>
          <p className="fb-tk-emptycard__body">When someone assigns you a task, it shows here with the client requirements you need. You can also add tasks for yourself.</p>
          {can("tasks.create") && onCreate ? (
            <button type="button" className="fb-tk-btn fb-tk-btn--primary fb-tk-btn--tall" onClick={onCreate}>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              Add a task for myself
            </button>
          ) : null}
        </div>
      ) : (
        <div className="fb-tk-worklist">
          {sorted.map((t) => (
            <WorkCard key={t.id} task={t} zone={zone} now={now} groupsKey={key} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkCard({ task, zone, now, groupsKey }: { task: WorkItem; zone: Zone; now: Date; groupsKey: ReturnType<typeof queryKeyFor> }) {
  const state = dueStateOf(task.dueAt, !isOpen(task.status), now, zone);
  const status = useSetTaskStatus(groupsKey);
  const lines = (task.requirements ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
  const tone = task.priority === "HIGH" ? "high" : task.priority === "MEDIUM" ? "medium" : "low";
  return (
    <section className="fb-tk-work" aria-label={task.title}>
      <div className="fb-tk-work__row">
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-label={`Mark “${task.title}” done`}
          className="fb-tk-check fb-tk-check--work"
          onClick={() => status.set({ id: task.id, status: task.status } as unknown as TaskItem, "COMPLETED", `Completed “${task.title}”.`)}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fb-tk-work__head">
            <strong className="fb-tk-work__title">{task.title}</strong>
            <span className={`fb-tk-pill fb-tk-pill--${tone} fb-tk-pill--sm`}>{PRIORITY_LABEL[task.priority] ?? task.priority}</span>
            <span className="fb-tk-pill fb-tk-pill--neutral fb-tk-pill--sm">{STATUS_LABEL[task.status] ?? task.status}</span>
          </div>
          <div className="fb-tk-work__due" data-state={state}>{dueLabel(task.dueAt, false, now, zone)}</div>
          {task.description ? <p className="fb-tk-work__desc">{task.description}</p> : null}
          <div className="fb-tk-reqs">
            <div className="fb-tk-reqs__label">CLIENT REQUIREMENTS FOR THIS WORK</div>
            <ul>{(lines.length ? lines : ["No requirements attached yet"]).map((l, i) => <li key={i}>{l}</li>)}</ul>
            {task.files.length ? (
              <ul className="fb-tk-files" aria-label="Files">
                {task.files.map((f) => (
                  <li key={f.attachmentId}>{f.title || f.name} <span className="fb-tk-hint">{bytes(f.sizeBytes)}</span></li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/* A compact "Do these today" panel (D1, D2, D3 homes) ------------------------------------------------------------------------------- */

/**
 * Open tasks that need doing now (by default Overdue and Today), each with a tick to complete, its due time and its record. Matches the
 * "Do these today" card on the Sales home; the other homes pass their own `title` and `groups`.
 */
export function TasksPanel({
  groups = ["OVERDUE", "TODAY"],
  limit = 6,
  title = "Do these today",
  emptyText = "Nothing due today. Nice.",
}: {
  groups?: ("OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | "NO_DATE")[];
  limit?: number;
  title?: string;
  emptyText?: string;
}) {
  const { orgSlug, timeZone, hour12 } = useMember();
  const zone: Zone = useMemo(() => ({ timeZone: timeZone ?? undefined, hour12 }), [timeZone, hour12]);
  const args = { params: { orgSlug }, query: { pageSize: String(limit), groups: groups.join(",") } } as const;
  const q = useApiQuery("getTasksGroups", args);
  const key = queryKeyFor("getTasksGroups", args);
  const status = useSetTaskStatus(key);
  const data = q.data as TaskGroups | undefined;
  const now = new Date();
  const rows = (data?.groups ?? []).flatMap((g) => g.items).slice(0, limit);

  return (
    <section className="fb-tk-panel" aria-label={title}>
      <div className="fb-tk-panel__head">
        <h2>{title}</h2>
        <Link href={`/o/${orgSlug}/tasks`} className="fb-tk-panel__all">All tasks</Link>
      </div>
      {q.isLoading ? (
        <div className="fb-tk-panel__empty" role="status" aria-busy="true"><span className="fb-sr-only">Loading tasks</span>Loading…</div>
      ) : q.isError ? (
        <div className="fb-tk-panel__empty" role="alert">
          Tasks didn’t load.
          <button type="button" className="fb-tk-linkbtn" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="fb-tk-panel__empty">
          <CheckCircle2 size={18} style={{ color: "var(--primary)" }} aria-hidden="true" />
          {emptyText}
        </div>
      ) : (
        rows.map((t) => {
          const state = dueStateOf(t.dueAt, false, now, zone);
          const link = t.link && t.link.label ? t.link : null;
          return (
            <div key={t.id} className="fb-tk-panel__row">
              <button
                type="button"
                role="checkbox"
                aria-checked={false}
                aria-label={`Mark “${t.title}” done`}
                aria-disabled={t.readOnly || undefined}
                title={t.readOnly ? "This isn't your task to complete." : undefined}
                className="fb-tk-check"
                onClick={t.readOnly ? undefined : () => status.set(t, "COMPLETED", `Completed “${t.title}”.`)}
              >
                <Check size={13} strokeWidth={3} aria-hidden="true" style={{ opacity: 0 }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fb-tk-panel__title">{t.title}</div>
                <div className="fb-tk-panel__meta">
                  <span className="fb-tk-due" data-state={state}>{dueLabel(t.dueAt, false, now, zone)}</span>
                  {link ? <Link href={linkHref(orgSlug, link)} className="fb-tk-linkchip">{link.label} ↗</Link> : null}
                </div>
              </div>
              {link ? (
                <Link href={linkHref(orgSlug, link)} className="fb-tk-logbtn" title="Log a call">
                  <Phone size={14} aria-hidden="true" />
                  Log
                </Link>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
