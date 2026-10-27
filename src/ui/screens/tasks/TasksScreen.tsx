"use client";

import { Check, ChevronDown, ChevronUp, Clock, Phone, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeError,
  EmptyState,
  Menu,
  NoAccess,
  queryKeyFor,
  useApi,
  useApiQuery,
  useMember,
  useToast,
} from "@/ui";
import { useAssignees, useRefreshTasks, useSetTaskStatus, useSnoozeTask } from "./hooks";
import {
  dayKey,
  dueLabel,
  dueStateOf,
  initials,
  isOpen,
  linkHref,
  PRIORITY_LABEL,
  readOnlyReason,
  shortDate,
  snoozeOptions,
  STATUS_LABEL,
  zonedToInstant,
  addDays,
  type GroupKey,
  type TaskGroups,
  type TaskItem,
  type TaskStatus,
  type Zone,
} from "./model";
import { TaskDrawer } from "./TaskDrawer";
import { TaskHeader } from "./TaskHeader";

type SectionId = "OVERDUE" | "TODAY" | "UPCOMING" | "NO_DATE" | "DONE";

const SECTIONS: { id: SectionId; label: string; dot: string; keys: GroupKey[]; none: string }[] = [
  { id: "OVERDUE", label: "Overdue", dot: "var(--red)", keys: ["OVERDUE"], none: "Nothing overdue." },
  { id: "TODAY", label: "Today", dot: "var(--orange)", keys: ["TODAY"], none: "Nothing else due today." },
  { id: "UPCOMING", label: "Upcoming", dot: "var(--blue)", keys: ["THIS_WEEK", "LATER"], none: "Nothing scheduled." },
  { id: "NO_DATE", label: "No due date", dot: "var(--text-3)", keys: ["NO_DATE"], none: "" },
  { id: "DONE", label: "Done", dot: "var(--primary)", keys: ["DONE"], none: "Nothing completed yet." },
];

const PAGE = 50;

/** The grouped tasks list (T1): stats, filters, Overdue / Today / Upcoming / Done with quick complete, snooze, quick add and bulk complete. */
export function TasksScreen() {
  const { orgSlug, timeZone, hour12, can } = useMember();
  const zone: Zone = useMemo(() => ({ timeZone: timeZone ?? undefined, hour12 }), [timeZone, hour12]);
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const refresh = useRefreshTasks();
  const assignees = useAssignees();
  const seeAll = can("tasks.view.all");

  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [priority, setPriority] = useState("");
  const [who, setWho] = useState("");
  const [closed, setClosed] = useState<Record<SectionId, boolean>>({ OVERDUE: false, TODAY: false, UPCOMING: false, NO_DATE: false, DONE: true });
  const [drawer, setDrawer] = useState<{ open: boolean; taskId?: string | null; kind?: "CALL" | "MEETING" }>({ open: false });
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<{ key: string; items: Partial<Record<GroupKey, TaskItem[]>>; pages: Partial<Record<GroupKey, number>> }>({ key: "", items: {}, pages: {} });
  const [now, setNow] = useState(() => new Date());
  const [quick, setQuick] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const sectionRefs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // A link from a record ("tasks for this lead"): `?leadId=` and the like narrow the list to that record; `?new=1` opens the drawer.
  const record = (["leadId", "dealId", "companyId", "contactId"] as const).map((k) => [k, search.get(k)] as const).find(([, v]) => v);
  const wantsNew = search.get("new");
  useEffect(() => {
    if (wantsNew === "1" || wantsNew === "call" || wantsNew === "note") {
      // "Log a call" and "Log a note" from the home both file a call against a record, so they open the call form.
      setDrawer({ open: true, kind: wantsNew === "1" ? undefined : "CALL" });
      router.replace(pathname);
    }
  }, [wantsNew, router, pathname]);

  const doneOpen = !closed.DONE;
  const query = {
    pageSize: String(PAGE),
    groups: `OVERDUE,TODAY,THIS_WEEK,LATER,NO_DATE${doneOpen ? ",DONE" : ""}`,
    ...(debounced ? { q: debounced } : {}),
    ...(who ? { assigneeMembershipId: who } : {}),
    ...(record ? { [record[0]]: record[1]! } : {}),
  };
  const args = { params: { orgSlug }, query } as const;
  const groupsQuery = useApiQuery("getTasksGroups", args);
  const groupsKey = queryKeyFor("getTasksGroups", args);
  const data = groupsQuery.data as TaskGroups | undefined;
  const status = useSetTaskStatus(groupsKey);

  const filterKey = JSON.stringify(query);
  const extra = more.key === filterKey ? more : { key: filterKey, items: {}, pages: {} };

  const rowsFor = (section: (typeof SECTIONS)[number]): TaskItem[] => {
    if (!data) return [];
    const rows = section.keys.flatMap((k) => [...(data.groups.find((g) => g.key === k)?.items ?? []), ...(extra.items[k] ?? [])]);
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    const filtered = priority ? unique.filter((r) => r.priority === priority) : unique;
    return filtered.sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity));
  };
  const countFor = (section: (typeof SECTIONS)[number]) => section.keys.reduce((n, k) => n + (data?.counts[k] ?? 0), 0);
  const loadedFor = (section: (typeof SECTIONS)[number]) => section.keys.reduce((n, k) => n + (data?.groups.find((g) => g.key === k)?.items.length ?? 0) + (extra.items[k]?.length ?? 0), 0);

  async function showMore(section: (typeof SECTIONS)[number]) {
    for (const key of section.keys) {
      const group = data?.groups.find((g) => g.key === key);
      if (!group) continue;
      const have = group.items.length + (extra.items[key]?.length ?? 0);
      if (have >= group.count) continue;
      const page = (extra.pages[key] ?? 1) + 1;
      try {
        const res = await api.call("getTasksGroupsByGroup", { params: { orgSlug, group: key }, query: { page: String(page), pageSize: String(PAGE), ...(debounced ? { q: debounced } : {}), ...(who ? { assigneeMembershipId: who } : {}), ...(record ? { [record[0]]: record[1]! } : {}) } });
        setMore((m) => {
          const base = m.key === filterKey ? m : { key: filterKey, items: {}, pages: {} };
          return { key: filterKey, items: { ...base.items, [key]: [...(base.items[key] ?? []), ...((res.items as TaskItem[]) ?? [])] }, pages: { ...base.pages, [key]: page } };
        });
      } catch {
        toast.show({ tone: "danger", message: "Couldn't load more tasks. Try again." });
      }
    }
  }

  const openCount = data ? data.counts.OVERDUE + data.counts.TODAY + data.counts.THIS_WEEK + data.counts.LATER + data.counts.NO_DATE : 0;
  const all = SECTIONS.flatMap((s) => (closed[s.id] ? [] : rowsFor(s)));
  const nothingAtAll = Boolean(data) && openCount === 0 && (data?.counts.DONE ?? 0) === 0 && !debounced && !who && !record && !priority;

  const stats = [
    { id: "OVERDUE" as SectionId, label: "Open tasks", n: openCount, sub: "pending or in progress", dot: "var(--blue)", red: false, to: "OVERDUE" as SectionId },
    { id: "OVERDUE" as SectionId, label: "Overdue", n: data?.counts.OVERDUE ?? 0, sub: "past their due time", dot: "var(--red)", red: true, to: "OVERDUE" as SectionId },
    { id: "TODAY" as SectionId, label: "Due today", n: data?.counts.TODAY ?? 0, sub: "still to do before midnight", dot: "var(--orange)", red: false, to: "TODAY" as SectionId },
    { id: "DONE" as SectionId, label: "Completed", n: data?.counts.DONE ?? 0, sub: "done so far", dot: "var(--primary)", red: false, to: "DONE" as SectionId },
  ];

  function jumpTo(id: SectionId) {
    setClosed((c) => ({ ...c, [id]: false }));
    requestAnimationFrame(() => sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function quickAdd() {
    const title = quick.trim();
    if (!title || quickBusy) return;
    setQuickBusy(true);
    try {
      // Due this afternoon, or tomorrow morning when it is already late, so a quick task is never overdue the moment it exists.
      const today = dayKey(now, zone.timeZone);
      const afternoon = zonedToInstant(today, "17:00", zone.timeZone);
      const due = afternoon.getTime() - now.getTime() > 3_600_000 ? afternoon : zonedToInstant(addDays(today, 1), "09:00", zone.timeZone);
      await api.call("postTasks", { params: { orgSlug }, idempotencyKey: crypto.randomUUID(), body: { title, dueAt: due.toISOString(), priority: "MEDIUM" } });
      setQuick("");
      refresh();
      toast.show({ tone: "success", message: `Task added, due ${dueLabel(due.toISOString(), false, now, zone).toLowerCase().replace(/^today · /, "today at ")}.` });
    } catch (e) {
      toast.show({ tone: "danger", message: describeError(e).body });
    } finally {
      setQuickBusy(false);
    }
  }

  async function bulkComplete() {
    const targets = all.filter((t) => selected.has(t.id) && isOpen(t.status) && !t.readOnly);
    const skipped = selected.size - targets.length;
    const results = await Promise.allSettled(targets.map((t) => api.call("patchTasksByTaskId", { params: { orgSlug, taskId: t.id }, body: { status: "COMPLETED" } })));
    const doneOnes = targets.filter((_, i) => results[i]!.status === "fulfilled");
    const failed = targets.length - doneOnes.length;
    refresh();
    setSelected(new Set());
    setSelecting(false);
    const tail = [failed ? `${failed} couldn't be completed` : "", skipped ? `${skipped} ${skipped === 1 ? "was" : "were"} skipped (already done or not yours to change)` : ""].filter(Boolean).join("; ");
    toast.show({
      tone: failed ? "danger" : "success",
      message: `${doneOnes.length} ${doneOnes.length === 1 ? "task" : "tasks"} completed${tail ? `. ${tail}.` : "."}`,
      undo: doneOnes.length
        ? async () => {
            await Promise.all(doneOnes.map((t) => api.call("patchTasksByTaskId", { params: { orgSlug, taskId: t.id }, body: { status: t.status } })));
            refresh();
          }
        : undefined,
    });
  }

  const forbidden = groupsQuery.isError && describeError(groupsQuery.error).kind === "noAccess";
  const scopeTone = seeAll ? "org" : "own";

  return (
    <div className="fb-tk-page">
      <TaskHeader
        title="Tasks"
        view="tasks"
        scopeLabel={`${seeAll ? "All organisation tasks" : "My tasks"} · ${openCount}`}
        hint={seeAll ? "You can create, assign, edit and complete any task." : "You can create tasks for yourself and complete your own."}
        tone={scopeTone}
        onNewTask={() => setDrawer({ open: true })}
      />

      {forbidden ? <NoAccess area="Tasks" denial={describeError(groupsQuery.error).denial} /> : null}

      {!forbidden ? (
        <>
          <div className="fb-tk-stats" aria-label="Task totals">
            {stats.map((s) => (
              <button key={s.label} type="button" className="fb-tk-stat" onClick={() => jumpTo(s.to)}>
                <span className="fb-tk-stat__label">
                  <span className="fb-tk-dot" style={{ background: s.dot }} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="fb-tk-stat__n" style={{ color: s.red && s.n ? "var(--red)" : undefined }}>{groupsQuery.isLoading ? "–" : s.n}</span>
                <span className="fb-tk-stat__sub">{s.sub}</span>
              </button>
            ))}
          </div>

          <div className="fb-tk-filters">
            <div className="fb-tk-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" aria-label="Search tasks" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="fb-tk-select" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Any priority</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            {seeAll ? (
              <select className="fb-tk-select" aria-label="Assignee" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Everyone</option>
                {assignees.members.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>{m.name}</option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="fb-tk-btn fb-tk-btn--secondary"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
            >
              {selecting ? "Done selecting" : "Select"}
            </button>
          </div>

          {record ? (
            <div className="fb-tk-recordchip" role="status">
              Showing the tasks linked to one record.
              <button type="button" className="fb-tk-linkbtn" onClick={() => router.replace(pathname)}>Show all tasks</button>
            </div>
          ) : null}

          {can("tasks.create") ? (
            <form
              className="fb-tk-quick"
              onSubmit={(e) => {
                e.preventDefault();
                void quickAdd();
              }}
            >
              <input aria-label="Quick add a task" placeholder="Quick add: type a task and press Enter" value={quick} onChange={(e) => setQuick(e.target.value)} disabled={quickBusy} />
            </form>
          ) : null}

          {selecting && selected.size > 0 ? (
            <div className="fb-tk-bulk" role="region" aria-label="Bulk actions">
              <span aria-live="polite">{selected.size} selected</span>
              <button type="button" className="fb-tk-btn fb-tk-btn--primary" onClick={() => void bulkComplete()}>
                <Check size={15} aria-hidden="true" />
                Complete {selected.size === 1 ? "task" : "tasks"}
              </button>
              <button type="button" className="fb-tk-btn fb-tk-btn--ghost" onClick={() => setSelected(new Set(all.filter((t) => isOpen(t.status) && !t.readOnly).map((t) => t.id)))}>Select all open</button>
              <button type="button" className="fb-tk-btn fb-tk-btn--ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
            </div>
          ) : null}

          {groupsQuery.isLoading ? (
            <div className="fb-tk-skeletons" role="status" aria-busy="true">
              <span className="fb-sr-only">Loading tasks</span>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="fb-tk-skel" />
              ))}
            </div>
          ) : null}

          {groupsQuery.isError && !forbidden ? (
            <div role="alert" className="fb-tk-error">
              <div className="fb-tk-error__title">Tasks didn’t load</div>
              <p className="fb-tk-error__body">{describeError(groupsQuery.error).body}</p>
              <button type="button" className="fb-tk-btn fb-tk-btn--primary" onClick={() => void groupsQuery.refetch()}>Retry</button>
            </div>
          ) : null}

          {nothingAtAll ? (
            <div className="fb-tk-empty">
              <EmptyState
                title="No tasks yet"
                body="Every follow-up you log can create one. Or add one now."
                action={
                  can("tasks.create") ? (
                    <button type="button" className="fb-tk-btn fb-tk-btn--primary fb-tk-btn--tall" onClick={() => setDrawer({ open: true })}>New task</button>
                  ) : undefined
                }
              />
            </div>
          ) : null}

          {data && !nothingAtAll
            ? SECTIONS.filter((s) => s.id !== "NO_DATE" || countFor(s) > 0).map((section) => {
                const rows = rowsFor(section);
                const open = !closed[section.id];
                const count = priority ? rows.length : countFor(section);
                const canMore = !priority && loadedFor(section) < countFor(section);
                return (
                  <section key={section.id} className="fb-tk-group" ref={(el) => { sectionRefs.current[section.id] = el; }} aria-labelledby={`tk-${section.id}`}>
                    <h2 className="fb-tk-group__h">
                      <button type="button" className="fb-tk-group__btn" aria-expanded={open} aria-controls={`tk-${section.id}-rows`} onClick={() => setClosed((c) => ({ ...c, [section.id]: open }))}>
                        <span className="fb-tk-dot fb-tk-dot--lg" style={{ background: section.dot }} aria-hidden="true" />
                        <strong id={`tk-${section.id}`} style={{ color: section.id === "OVERDUE" ? "var(--red)" : undefined }}>{section.label}</strong>
                        <span className="fb-tk-count">{count}</span>
                        <span style={{ flex: 1 }} />
                        {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                      </button>
                    </h2>
                    {open ? (
                      <div id={`tk-${section.id}-rows`}>
                        {rows.map((t) => (
                          <Row
                            key={t.id}
                            task={t}
                            zone={zone}
                            now={now}
                            orgSlug={orgSlug}
                            selecting={selecting}
                            checked={selected.has(t.id)}
                            onCheck={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(t.id); else n.delete(t.id); return n; })}
                            onToggle={() => status.set(t, isOpen(t.status) ? "COMPLETED" : "PENDING", isOpen(t.status) ? `Completed “${t.title}”.` : undefined)}
                            onStatus={(s) => status.set(t, s, s === "COMPLETED" ? `Completed “${t.title}”.` : undefined)}
                            onEdit={() => setDrawer({ open: true, taskId: t.id })}
                          />
                        ))}
                        {rows.length === 0 ? <div className="fb-tk-none">{section.none}</div> : null}
                        {canMore ? (
                          <div className="fb-tk-more">
                            <button type="button" className="fb-tk-btn fb-tk-btn--ghost" onClick={() => void showMore(section)}>
                              Show more ({countFor(section) - loadedFor(section)} more)
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                );
              })
            : null}
        </>
      ) : null}

      <TaskDrawer open={drawer.open} taskId={drawer.taskId} initialKind={drawer.kind} allowActivities={Boolean(drawer.kind)} onClose={() => setDrawer({ open: false })} />
    </div>
  );
}

function Row({
  task,
  zone,
  now,
  orgSlug,
  selecting,
  checked,
  onCheck,
  onToggle,
  onStatus,
  onEdit,
}: {
  task: TaskItem;
  zone: Zone;
  now: Date;
  orgSlug: string;
  selecting: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onToggle: () => void;
  onStatus: (s: TaskStatus) => void;
  onEdit: () => void;
}) {
  const snooze = useSnoozeTask();
  const done = task.status === "COMPLETED";
  const closed = !isOpen(task.status);
  const state = dueStateOf(task.dueAt, closed, now, zone);
  const reason = task.readOnly ? readOnlyReason(task) : undefined;
  const name = task.assigneeName ?? "Unassigned";
  const prioTone = task.priority === "HIGH" ? "high" : task.priority === "MEDIUM" ? "medium" : "low";
  const dueText = done ? `Done ${task.completedAt ? shortDate(new Date(task.completedAt), zone) : ""}`.trim() : dueLabel(task.dueAt, closed, now, zone);
  const link = task.link && task.link.label ? task.link : null;
  const snoozes = snoozeOptions(now, zone.timeZone);

  return (
    <div className="fb-tk-row" data-state={state}>
      {selecting ? (
        <input
          type="checkbox"
          className="fb-tk-pick"
          aria-label={`Select ${task.title}`}
          checked={checked}
          disabled={task.readOnly || closed}
          title={reason}
          onChange={(e) => onCheck(e.target.checked)}
        />
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Mark “${task.title}” ${done ? "not done" : "done"}`}
          aria-disabled={task.readOnly || undefined}
          title={reason}
          className="fb-tk-check"
          data-on={done}
          onClick={task.readOnly ? undefined : onToggle}
        >
          {done ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
        </button>
      )}
      <div className="fb-tk-main">
        <button type="button" className="fb-tk-titlebtn" data-closed={closed} onClick={onEdit}>{task.title}</button>
        {task.description ? <div className="fb-tk-desc">{task.description}</div> : null}
        {link ? (
          <Link href={linkHref(orgSlug, link)} className="fb-tk-linkchip">{link.label} ↗</Link>
        ) : null}
        {task.readOnly ? <span className="fb-sr-only">{reason}</span> : null}
      </div>
      <span className="fb-tk-who">
        <span className="fb-tk-avatar" aria-hidden="true">{initials(name)}</span>
        <span className="fb-tk-who__name">{name}</span>
      </span>
      <span className="fb-tk-due" data-state={state}>
        <span>{dueText}</span>
        {!closed && !task.readOnly ? (
          <Menu
            label={`Snooze “${task.title}”`}
            trigger={<Clock size={14} aria-hidden="true" />}
            triggerClassName="fb-tk-snooze"
            align="end"
            items={snoozes.map((s) => ({ key: s.key, label: s.label, onSelect: () => void snooze(task, s.at, s.label.toLowerCase()) }))}
          />
        ) : null}
      </span>
      <span className="fb-tk-prio-cell">
        <span className={`fb-tk-pill fb-tk-pill--${prioTone}`}>{PRIORITY_LABEL[task.priority] ?? task.priority}</span>
      </span>
      <select className="fb-tk-select fb-tk-select--sm" aria-label={`Status of ${task.title}`} value={task.status} disabled={task.readOnly} title={reason} onChange={(e) => onStatus(e.target.value as TaskStatus)}>
        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>
      {link ? (
        <Link href={linkHref(orgSlug, link)} className="fb-tk-iconbtn" aria-label={`Log a call or note on ${link.label}`} title="Log a call or note">
          <Phone size={15} aria-hidden="true" />
        </Link>
      ) : (
        <span className="fb-tk-iconbtn fb-tk-iconbtn--off" aria-label="Link this task to a record to log a call or note" role="img" title="Link this task to a record to log a call or note">
          <Phone size={15} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
