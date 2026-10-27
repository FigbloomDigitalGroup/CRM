/**
 * Shared pieces of the tasks and calendar screens (F2.07, F2.08): the shapes the API answers with, the group keys, and date writing in the
 * person's own time zone (the same zone the API uses to decide what is "today" and "overdue", so the screen and the server never disagree).
 */

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type GroupKey = "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | "NO_DATE" | "DONE";
export type LinkType = "Lead" | "Deal" | "Company" | "Contact";

export const STATUS_LABEL: Record<TaskStatus, string> = { PENDING: "Pending", IN_PROGRESS: "In progress", COMPLETED: "Completed", CANCELLED: "Cancelled" };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

/** One task as the grouped list returns it (`GET /tasks/groups`): the record plus the assignee's name, the resolved link and whether it is read-only. */
export interface TaskItem {
  id: string;
  title: string;
  description?: string | null;
  requirements?: string | null;
  assigneeMembershipId: string;
  createdByMembershipId: string;
  assigneeName: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completedAt?: string | null;
  link: { type: LinkType; id: string; label: string | null } | null;
  readOnly: boolean;
}

export interface TaskGroup {
  key: GroupKey;
  label: string;
  count: number;
  collapsed: boolean;
  items: TaskItem[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface TaskGroups {
  timeZone: string;
  counts: Record<GroupKey, number>;
  groups: TaskGroup[];
}

export const isOpen = (status: string) => status === "PENDING" || status === "IN_PROGRESS";

export const LINK_PATH: Record<LinkType, string> = { Lead: "leads", Deal: "deals", Company: "companies", Contact: "contacts" };
export const linkHref = (orgSlug: string, link: { type: LinkType; id: string }) => `/o/${orgSlug}/${LINK_PATH[link.type]}/${link.id}`;

/* Dates ------------------------------------------------------------------------------------------------------------------------- */

export interface Zone {
  timeZone: string | undefined;
  hour12: boolean;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number) => MONTHS[m]!;

interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 Sunday .. 6 Saturday
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let f = partsCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" });
    partsCache.set(key, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts of an instant in a zone. */
export function partsOf(date: Date, timeZone: string | undefined): Parts {
  const out: Partial<Parts> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type === "year") out.year = Number(p.value);
    else if (p.type === "month") out.month = Number(p.value);
    else if (p.type === "day") out.day = Number(p.value);
    else if (p.type === "hour") out.hour = Number(p.value) % 24;
    else if (p.type === "minute") out.minute = Number(p.value);
    else if (p.type === "weekday") out.weekday = WEEKDAYS[p.value] ?? 0;
  }
  return out as Parts;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of an instant in a zone. */
export function dayKey(date: Date, timeZone: string | undefined): string {
  const p = partsOf(date, timeZone);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** The instant for a wall-clock date and time in a zone (handles the offset, including a change of offset on that day). */
export function zonedToInstant(day: string, time: string, timeZone: string | undefined): Date {
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let result = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = partsOf(new Date(result), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    result += guess - shown;
  }
  return new Date(result);
}

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, independent of any zone). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}

export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(Math.min(d, last))}`;
}

/** 0 Sunday .. 6 Saturday for a `YYYY-MM-DD`. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday on or before a day. */
export function mondayOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

export function dayNumber(day: string): number {
  return Number(day.slice(8, 10));
}

export function timeText(date: Date, zone: Zone): string {
  const p = partsOf(date, zone.timeZone);
  if (!zone.hour12) return `${two(p.hour)}:${two(p.minute)}`;
  const h = p.hour % 12 || 12;
  return `${h}:${two(p.minute)} ${p.hour >= 12 ? "PM" : "AM"}`;
}

/** "19 Oct". */
export function shortDate(date: Date, zone: Zone): string {
  const p = partsOf(date, zone.timeZone);
  return `${p.day} ${MONTHS[p.month - 1]!.slice(0, 3)}`;
}

/** "Mon, 19 Oct" from a day key. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOf(day)]}, ${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
}

export type DueState = "overdue" | "today" | "upcoming" | "none" | "done";

export function dueStateOf(dueAt: string | null, closed: boolean, now: Date, zone: Zone): DueState {
  if (closed) return "done";
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  return dayKey(due, zone.timeZone) === dayKey(now, zone.timeZone) ? "today" : "upcoming";
}

/** The design's wording: "Overdue · 17 Oct, 9:00 AM", "Today · 3:00 PM", "Tomorrow, 10:00 AM", "21 Oct, 10:00 AM". */
export function dueLabel(dueAt: string | null, closed: boolean, now: Date, zone: Zone): string {
  const state = dueStateOf(dueAt, closed, now, zone);
  if (state === "none") return "No date";
  const due = new Date(dueAt!);
  const time = timeText(due, zone);
  if (state === "overdue") return `Overdue · ${shortDate(due, zone)}, ${time}`;
  if (state === "today") return `Today · ${time}`;
  const today = dayKey(now, zone.timeZone);
  if (dayKey(due, zone.timeZone) === addDays(today, 1)) return `Tomorrow, ${time}`;
  return `${shortDate(due, zone)}, ${time}`;
}

/** The value a `datetime-local` input wants, for an instant, in the person's zone. */
export function toDateTimeLocal(date: Date, timeZone: string | undefined): string {
  const p = partsOf(date, timeZone);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** The instant a `datetime-local` value means in the person's zone. */
export function fromDateTimeLocal(value: string, timeZone: string | undefined): Date {
  const [day, time] = value.split("T") as [string, string];
  return zonedToInstant(day, time, timeZone);
}

/** The snooze choices, as instants in the person's zone: tomorrow 9:00, in three days 9:00, next Monday 9:00. */
export function snoozeOptions(now: Date, timeZone: string | undefined): { key: string; label: string; at: Date }[] {
  const today = dayKey(now, timeZone);
  const mondayNext = addDays(mondayOf(today), 7);
  return [
    { key: "tomorrow", label: "Tomorrow, 9:00", at: zonedToInstant(addDays(today, 1), "09:00", timeZone) },
    { key: "three", label: "In 3 days, 9:00", at: zonedToInstant(addDays(today, 3), "09:00", timeZone) },
    { key: "monday", label: "Next Monday, 9:00", at: zonedToInstant(mondayNext, "09:00", timeZone) },
  ];
}

export function readOnlyReason(task: { assigneeName: string | null }): string {
  const who = task.assigneeName ? `${task.assigneeName}'s` : "someone else's";
  return `This is ${who} task. You can read it; only they, whoever created it, or Management can change it.`;
}

export const initials = (name: string) => {
  const words = name.replace(/^Dev /, "").trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]![0] ?? "") : (words[0]?.[1] ?? ""))).toUpperCase();
};
