"use client";

import { ChevronLeft, ChevronRight, Lock, Phone, Video } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { describeError, NoAccess, useApiQuery, useMember } from "@/ui";
import { useAssignees } from "./hooks";
import {
  addDays,
  addMonths,
  dayKey,
  dayLabel,
  dayNumber,
  mondayOf,
  monthName,
  timeText,
  weekdayOf,
  zonedToInstant,
  linkHref,
  shortDate,
  type LinkType,
  type Zone,
} from "./model";
import { TaskDrawer } from "./TaskDrawer";
import { TaskHeader } from "./TaskHeader";

type Mode = "month" | "week" | "day" | "list";

interface CalItem {
  kind: "task" | "activity";
  id: string;
  type: string;
  title: string;
  start: string;
  status: string | null;
  priority: string | null;
  overdue: boolean;
  assigneeMembershipId: string;
  assigneeName: string | null;
  link: { type: LinkType; id: string } | null;
  localDate: string;
  localTime: string;
  linkLabel?: string | null;
  description?: string | null;
}

const DOWS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MODES: { id: Mode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "list", label: "List" },
];
const HOURS = Array.from({ length: 11 }, (_, i) => 8 + i);

/** A short time the way the design writes it on a chip: "9 AM", "10:30 AM", or "09:00" on a 24-hour clock. */
const shortTime = (d: Date, zone: Zone) => (zone.hour12 ? timeText(d, zone).replace(":00", "") : timeText(d, zone));

/**
 * The calendar (T2): month, week, day and list of the person's tasks, calls and meetings; the team filter (locked, with the reason, for roles
 * without team scope); create a task or meeting by clicking a slot; an agenda on a phone; arrow keys between days and events.
 */
export function CalendarScreen() {
  const { orgSlug, timeZone, hour12, can } = useMember();
  const zone: Zone = useMemo(() => ({ timeZone: timeZone ?? undefined, hour12 }), [timeZone, hour12]);
  const router = useRouter();
  const search = useSearchParams();
  const today = dayKey(new Date(), zone.timeZone);
  const startMode = (search.get("view") as Mode | null) ?? "month";
  const [mode, setMode] = useState<Mode>(MODES.some((m) => m.id === startMode) ? startMode : "month");
  const [anchor, setAnchor] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(search.get("date") ?? "") ? search.get("date")! : today);
  const [who, setWho] = useState("");
  const [drawer, setDrawer] = useState<{ open: boolean; due?: Date; taskId?: string | null }>({ open: false });
  const assignees = useAssignees();
  const seeAll = can("tasks.view.all");

  // Management opens on everyone's calendar (the design's default); everyone else on their own.
  const effective = seeAll && !who ? "all" : who;
  // The window each view asks for. The month asks for its whole 6-week grid, so the leading and trailing days show their tasks too.
  const first = `${anchor.slice(0, 8)}01`;
  const gridStart = mondayOf(first);
  const range = (() => {
    if (mode === "month") return { from: zonedToInstant(gridStart, "00:00", zone.timeZone), to: zonedToInstant(addDays(gridStart, 42), "00:00", zone.timeZone) };
    if (mode === "week") {
      const mon = mondayOf(anchor);
      return { from: zonedToInstant(mon, "00:00", zone.timeZone), to: zonedToInstant(addDays(mon, 7), "00:00", zone.timeZone) };
    }
    if (mode === "day") return { from: zonedToInstant(anchor, "00:00", zone.timeZone), to: zonedToInstant(addDays(anchor, 1), "00:00", zone.timeZone) };
    // List: what is overdue (the last month) and what is coming (the next 30 days).
    return { from: zonedToInstant(addDays(today, -31), "00:00", zone.timeZone), to: zonedToInstant(addDays(today, 30), "00:00", zone.timeZone) };
  })();
  const query = {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    ...(effective ? { membershipId: effective } : {}),
  };
  // Day asks by view so the answer carries the full detail (description, the linked record's name).
  const dayQuery = { view: "day" as const, date: anchor, ...(effective ? { membershipId: effective } : {}) };
  const cal = useApiQuery("getCalendar", { params: { orgSlug }, query: mode === "day" ? dayQuery : query });
  const items = ((cal.data?.items ?? []) as CalItem[]).filter((i) => !(i.kind === "task" && i.status === "CANCELLED"));
  const filter = cal.data?.teamFilter;
  const locked = filter ? !filter.canChoose : !seeAll;
  // The design's wording; the API says the same thing in its own words (`teamFilter.reason`), which is kept as the tooltip.
  const lockReason = "The team calendar is visible to Management. You see your own tasks.";

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const i of items) {
      const list = map.get(i.localDate) ?? [];
      list.push(i);
      map.set(i.localDate, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [items]);

  function shift(n: number) {
    setAnchor((a) => (mode === "month" ? addMonths(a, n) : mode === "week" ? addDays(a, 7 * n) : addDays(a, n)));
  }
  const title =
    mode === "month" ? `${monthName(Number(anchor.slice(5, 7)) - 1)} ${anchor.slice(0, 4)}` : mode === "week" ? `Week of ${shortDate(new Date(range.from), zone)}` : mode === "day" ? `${dayLabel(anchor)} ${anchor.slice(0, 4)}` : "Upcoming and overdue";

  const open = items.filter((i) => i.kind === "task" && (i.status === "PENDING" || i.status === "IN_PROGRESS")).length;

  function slot(day: string, hour = 10) {
    if (!can("tasks.create")) return;
    setDrawer({ open: true, due: zonedToInstant(day, `${String(hour).padStart(2, "0")}:00`, zone.timeZone) });
  }

  function openItem(item: CalItem) {
    if (item.kind === "task") setDrawer({ open: true, taskId: item.id });
    else if (item.link) router.push(linkHref(orgSlug, item.link));
  }

  /* Keyboard: arrows move between the day slots, and up and down move between the events inside one. */
  const gridRef = useRef<HTMLDivElement>(null);
  function onGridKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const root = gridRef.current;
    if (!root) return;
    const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-cell]"));
    if (target.hasAttribute("data-cell")) {
      const i = cells.indexOf(target);
      const step = mode === "month" ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } : mode === "week" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
      const delta = (step as Record<string, number>)[e.key];
      if (delta !== undefined) {
        e.preventDefault();
        cells[Math.max(0, Math.min(cells.length - 1, i + delta))]?.focus();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        cells[e.key === "Home" ? 0 : cells.length - 1]?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // In the week and month views down also steps into the day's first event.
        const evs = target.closest("[data-day]")?.querySelectorAll<HTMLElement>("[data-ev]");
        if (e.key === "ArrowDown" && evs?.length) {
          e.preventDefault();
          evs[0]!.focus();
        }
      }
      return;
    }
    if (target.hasAttribute("data-ev") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const holder = target.closest("[data-day]");
      const evs = Array.from(holder?.querySelectorAll<HTMLElement>("[data-ev]") ?? []);
      const i = evs.indexOf(target);
      e.preventDefault();
      if (e.key === "ArrowDown") evs[Math.min(evs.length - 1, i + 1)]?.focus();
      else if (i === 0) holder?.querySelector<HTMLElement>("[data-cell]")?.focus();
      else evs[i - 1]?.focus();
    }
  }

  useEffect(() => {
    // Keep a valid mode in the address so a reload comes back to the same view.
    const url = new URL(window.location.href);
    url.searchParams.set("view", mode);
    window.history.replaceState(null, "", url);
  }, [mode]);

  const forbidden = cal.isError && describeError(cal.error).kind === "noAccess";
  const dayItems = (d: string) => byDay.get(d) ?? [];

  return (
    <div className="fb-tk-page">
      <TaskHeader
        title="Calendar"
        view="calendar"
        scopeLabel={`${seeAll && effective === "all" ? "All organisation tasks" : "My tasks"} · ${open}`}
        hint={seeAll ? "You can create, assign, edit and complete any task." : "You can create tasks for yourself and complete your own."}
        tone={seeAll ? "org" : "own"}
        onNewTask={() => setDrawer({ open: true })}
      />

      <div className="fb-tk-calbar">
        <div className="fb-tk-calbar__nav">
          <button type="button" className="fb-tk-sqbtn" aria-label={mode === "month" ? "Previous month" : mode === "week" ? "Previous week" : "Previous day"} aria-disabled={mode === "list" || undefined} onClick={mode === "list" ? undefined : () => shift(-1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" className="fb-tk-btn fb-tk-btn--secondary fb-tk-btn--md" onClick={() => setAnchor(today)}>Today</button>
          <button type="button" className="fb-tk-sqbtn" aria-label={mode === "month" ? "Next month" : mode === "week" ? "Next week" : "Next day"} aria-disabled={mode === "list" || undefined} onClick={mode === "list" ? undefined : () => shift(1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <strong className="fb-tk-caltitle" aria-live="polite">{title}</strong>
        </div>
        <div className="fb-tk-calbar__tools">
          <select
            className="fb-tk-select fb-tk-select--md"
            aria-label="Whose calendar"
            value={who}
            disabled={locked}
            title={locked ? (typeof filter?.reason === "string" ? filter.reason : lockReason) : undefined}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">{seeAll ? "Everyone" : "Just me"}</option>
            {!locked ? assignees.members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>) : null}
          </select>
          <div className="fb-tk-modes" role="group" aria-label="Calendar range">
            {MODES.map((m) => (
              <button key={m.id} type="button" className="fb-tk-modes__opt" data-on={mode === m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
      </div>
      {locked ? (
        <div className="fb-tk-lockline">
          <Lock size={12} aria-hidden="true" />
          {lockReason}
        </div>
      ) : null}

      {forbidden ? <NoAccess area="The calendar" denial={describeError(cal.error).denial} /> : null}
      {cal.isError && !forbidden ? (
        <div role="alert" className="fb-tk-error">
          <div className="fb-tk-error__title">The calendar didn’t load</div>
          <p className="fb-tk-error__body">{describeError(cal.error).body}</p>
          <button type="button" className="fb-tk-btn fb-tk-btn--primary" onClick={() => void cal.refetch()}>Retry</button>
        </div>
      ) : null}
      {cal.isLoading ? (
        <div className="fb-tk-skeletons" role="status" aria-busy="true">
          <span className="fb-sr-only">Loading the calendar</span>
          <div className="fb-tk-skel fb-tk-skel--grid" />
        </div>
      ) : null}
      {cal.data?.truncated ? <div className="fb-tk-lockline" role="status">This range has more than the calendar can show at once. Narrow it with the Day or Week view.</div> : null}

      {cal.data && !cal.isError ? (
        <div ref={gridRef} onKeyDown={onGridKey}>
          {mode === "month" ? (
            <>
              <section className="fb-tk-cal fb-tk-cal--grid" aria-label={`${title}, month`}>
                <div className="fb-tk-month__dows" aria-hidden="true">
                  {DOWS.map((d) => <div key={d}>{d}</div>)}
                </div>
                <div className="fb-tk-month__cells" role="group" aria-label={title}>
                  {Array.from({ length: 42 }, (_, i) => {
                    const d = addDays(gridStart, i);
                    const list = dayItems(d);
                    const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
                    const isToday = d === today;
                    return (
                      <div key={d} className="fb-tk-month__cell" data-out={!inMonth} data-day={d} aria-current={isToday ? "date" : undefined}>
                        <button
                          type="button"
                          data-cell
                          className="fb-tk-cellbtn"
                          tabIndex={d === anchor ? 0 : -1}
                          aria-label={`${dayLabel(d)}${isToday ? ", today" : ""}, ${list.length} ${list.length === 1 ? "item" : "items"}${can("tasks.create") ? ". Press Enter to add a task." : ""}`}
                          onClick={() => slot(d)}
                        />
                        <span className="fb-tk-daynum" data-today={isToday} aria-hidden="true">{dayNumber(d)}</span>
                        {list.slice(0, 3).map((it) => (
                          <Chip key={`${it.kind}-${it.id}`} item={it} zone={zone} onOpen={() => openItem(it)} />
                        ))}
                        {list.length > 3 ? (
                          <button type="button" className="fb-tk-more" onClick={() => { setAnchor(d); setMode("day"); }}>+{list.length - 3} more</button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
              <MobileAgenda items={items} zone={zone} today={today} onOpen={openItem} />
            </>
          ) : null}

          {mode === "week" ? (
            <>
              <section className="fb-tk-cal fb-tk-cal--grid" aria-label={title}>
                <div className="fb-tk-week" role="group" aria-label={title}>
                  {DOWS.map((dw, i) => {
                    const d = addDays(mondayOf(anchor), i);
                    const isToday = d === today;
                    const list = dayItems(d);
                    return (
                      <div key={d} className="fb-tk-week__col" data-day={d} aria-current={isToday ? "date" : undefined}>
                        <button
                          type="button"
                          data-cell
                          className="fb-tk-week__head"
                          data-today={isToday}
                          tabIndex={i === (weekdayOf(anchor) + 6) % 7 ? 0 : -1}
                          aria-label={`${dayLabel(d)}${isToday ? ", today" : ""}, ${list.length} ${list.length === 1 ? "item" : "items"}${can("tasks.create") ? ". Press Enter to add a task." : ""}`}
                          onClick={() => slot(d)}
                        >
                          <span className="fb-tk-week__dow">{dw}</span>
                          <span className="fb-tk-week__d">{dayNumber(d)}</span>
                        </button>
                        <div className="fb-tk-week__items">
                          {list.map((it) => (
                            <WeekItem key={`${it.kind}-${it.id}`} item={it} zone={zone} onOpen={() => openItem(it)} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
              <MobileAgenda items={items} zone={zone} today={today} onOpen={openItem} />
            </>
          ) : null}

          {mode === "day" ? (
            <section className="fb-tk-cal" aria-label={title}>
              {HOURS.map((h) => {
                const here = dayItems(anchor).filter((it) => {
                  const hr = Number(it.localTime.slice(0, 2));
                  return hr === h || (h === HOURS[0] && hr < h) || (h === HOURS[HOURS.length - 1] && hr > h);
                });
                const label = `${String(h).padStart(2, "0")}:00`;
                return (
                  <div key={h} className="fb-tk-hour" data-day={anchor}>
                    <button type="button" data-cell className="fb-tk-hour__add" aria-label={`${label}${can("tasks.create") ? ". Press Enter to add a task at this time." : ""}`} onClick={() => slot(anchor, h)} tabIndex={h === HOURS[0] ? 0 : -1} />
                    <div className="fb-tk-hour__label" aria-hidden="true">{label}</div>
                    <div className="fb-tk-hour__items">
                      {here.map((it) => (
                        <DayItem key={`${it.kind}-${it.id}`} item={it} zone={zone} onOpen={() => openItem(it)} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {dayItems(anchor).length === 0 ? <div className="fb-tk-none">Nothing on this day. Select a time to add a task.</div> : null}
            </section>
          ) : null}

          {mode === "list" ? <Agenda items={items.filter((i) => i.kind === "activity" || i.status === "PENDING" || i.status === "IN_PROGRESS")} zone={zone} today={today} onOpen={openItem} /> : null}
        </div>
      ) : null}

      <TaskDrawer
        open={drawer.open}
        taskId={drawer.taskId}
        initialDue={drawer.due}
        allowActivities={!drawer.taskId}
        onClose={() => setDrawer({ open: false })}
      />
    </div>
  );
}

/* Items --------------------------------------------------------------------------------------------------------------------------- */

function toneOf(item: CalItem): "red" | "orange" | "blue" | "green" {
  if (item.kind === "activity") return "blue";
  if (item.overdue) return "red";
  return item.priority === "HIGH" ? "orange" : "green";
}

const kindText = (item: CalItem) => (item.type === "MEETING" ? "Meeting" : item.type === "CALL" ? "Call" : "Task");

function Chip({ item, zone, onOpen }: { item: CalItem; zone: Zone; onOpen: () => void }) {
  const tone = toneOf(item);
  return (
    <button type="button" data-ev className="fb-tk-chip" data-tone={tone} onClick={onOpen} aria-label={`${kindText(item)}: ${item.title}, ${shortTime(new Date(item.start), zone)}${item.overdue ? ", overdue" : ""}`}>
      {item.overdue ? <span className="fb-tk-chip__dot" aria-hidden="true" /> : null}
      {item.kind === "activity" ? (item.type === "CALL" ? <Phone size={11} aria-hidden="true" /> : <Video size={11} aria-hidden="true" />) : null}
      <span className="fb-tk-chip__text">{shortTime(new Date(item.start), zone)} {item.title}</span>
    </button>
  );
}

function WeekItem({ item, zone, onOpen }: { item: CalItem; zone: Zone; onOpen: () => void }) {
  return (
    <button type="button" data-ev className="fb-tk-weekitem" data-tone={toneOf(item)} onClick={onOpen} aria-label={`${kindText(item)}: ${item.title}, ${shortTime(new Date(item.start), zone)}${item.overdue ? ", overdue" : ""}`}>
      <span className="fb-tk-weekitem__time">{item.overdue ? "● " : ""}{shortTime(new Date(item.start), zone)}</span>
      <span className="fb-tk-weekitem__title">{item.kind === "activity" ? `${kindText(item)} · ` : ""}{item.title}</span>
    </button>
  );
}

function DayItem({ item, zone, onOpen }: { item: CalItem; zone: Zone; onOpen: () => void }) {
  return (
    <button type="button" data-ev className="fb-tk-dayitem" data-tone={toneOf(item)} onClick={onOpen}>
      {timeText(new Date(item.start), zone)} · {item.title} <span className="fb-tk-dayitem__who">· {item.kind === "activity" ? `${kindText(item)}, ` : ""}{item.assigneeName ?? ""}{item.linkLabel ? ` · ${item.linkLabel}` : ""}</span>
    </button>
  );
}

/* Agenda: the list view, and the phone's version of month and week ---------------------------------------------------------------- */

function agendaGroups(items: CalItem[], today: string) {
  const days = new Map<string, CalItem[]>();
  for (const i of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    const list = days.get(i.localDate) ?? [];
    list.push(i);
    days.set(i.localDate, list);
  }
  return [...days.entries()].map(([day, list]) => ({
    day,
    label: `${day === today ? "Today · " : day < today ? "Overdue · " : ""}${dayLabel(day)}`,
    overdue: day < today,
    list,
  }));
}

function Agenda({ items, zone, today, onOpen }: { items: CalItem[]; zone: Zone; today: string; onOpen: (i: CalItem) => void }) {
  const groups = agendaGroups(items, today);
  if (groups.length === 0) {
    return (
      <section className="fb-tk-cal">
        <div className="fb-tk-none">Nothing scheduled in this range.</div>
      </section>
    );
  }
  return (
    <section className="fb-tk-cal fb-tk-agenda" aria-label="Agenda">
      {groups.map((g) => (
        <div key={g.day}>
          <h2 className="fb-tk-agenda__day" style={{ color: g.overdue ? "var(--red)" : undefined }}>{g.label}</h2>
          {g.list.map((it) => (
            <button key={`${it.kind}-${it.id}`} type="button" className="fb-tk-agenda__item" onClick={() => onOpen(it)}>
              <span className="fb-tk-agenda__time">{timeText(new Date(it.start), zone)}</span>
              <span className="fb-tk-agenda__title">{it.kind === "activity" ? `${kindText(it)} · ` : ""}{it.title}</span>
              <span className="fb-tk-agenda__who">{it.assigneeName ?? ""}</span>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

/** On a phone the month and week grids are too tight to use, so the same days are listed as an agenda. */
function MobileAgenda(props: { items: CalItem[]; zone: Zone; today: string; onOpen: (i: CalItem) => void }) {
  return (
    <div className="fb-tk-mobileagenda">
      <Agenda {...props} />
    </div>
  );
}
