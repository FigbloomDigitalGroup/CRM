"use client";

import { Calendar as CalendarIcon, List, Plus } from "lucide-react";
import Link from "next/link";
import { useMember } from "@/ui";

/**
 * The header both views share (T1 and T2): the title, the scope pill with its one-line hint, the List and Calendar switch, and New task.
 * `tone` follows the design: the organisation colour when the person sees everyone's tasks, the orange "mine" colour for their own.
 */
export function TaskHeader({
  title,
  view,
  scopeLabel,
  hint,
  tone,
  onNewTask,
}: {
  title: string;
  view: "tasks" | "calendar";
  scopeLabel: string;
  hint: string;
  tone: "org" | "own";
  onNewTask: () => void;
}) {
  const { orgSlug, can } = useMember();
  const hasCalendar = can("tasks.view.own") || can("tasks.view.all");
  return (
    <div className="fb-tk-head">
      <div>
        <h1 className="fb-tk-title">{title}</h1>
        <div className="fb-tk-scoperow">
          <span className={`fb-tk-scope fb-tk-scope--${tone}`}>
            <span className="fb-tk-scope__dot" aria-hidden="true" />
            {scopeLabel}
          </span>
          <span className="fb-tk-hint">{hint}</span>
        </div>
      </div>
      <div className="fb-tk-actions">
        {hasCalendar ? (
          <div className="fb-tk-views" role="group" aria-label="View">
            <Link href={`/o/${orgSlug}/tasks`} className="fb-tk-views__opt" data-on={view === "tasks"} aria-current={view === "tasks" ? "page" : undefined}>
              <List size={15} aria-hidden="true" />
              List
            </Link>
            <Link href={`/o/${orgSlug}/calendar`} className="fb-tk-views__opt" data-on={view === "calendar"} aria-current={view === "calendar" ? "page" : undefined}>
              <CalendarIcon size={15} aria-hidden="true" />
              Calendar
            </Link>
          </div>
        ) : null}
        <button
          type="button"
          className="fb-tk-btn fb-tk-btn--primary fb-tk-btn--tall"
          aria-disabled={!can("tasks.create") || undefined}
          title={can("tasks.create") ? undefined : "Your role can't create tasks. Ask Management if you need to."}
          onClick={can("tasks.create") ? onNewTask : undefined}
        >
          <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          New task
        </button>
      </div>
    </div>
  );
}
