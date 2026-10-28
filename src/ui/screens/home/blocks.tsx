"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MaskedValue } from "../../components/states";
import { useApi, useApiQuery, useUndoable } from "../../data/hooks";
import { useMember } from "../../data/member";
import { initialsOf } from "../../components/basics";
import { dueLabel, moneyShort } from "./format";
import { HIcon, Panel, stageStyle } from "./kit";
import { leadName, linkChipLabel, recordHref, type TaskItem } from "./dash";

/** Names for ids the dashboard answers with (stages, services, sources): one cached read, shared by every block. */
export function useReferenceData() {
  const { orgSlug } = useMember();
  return useApiQuery("getReferenceData", { params: { orgSlug } }, { staleTime: 5 * 60_000 });
}

/** The queries a task change makes stale, wherever it was made. */
const TASK_QUERIES = new Set(["getTasksGroupsByGroup", "getDashboard", "getMyWork", "getTasks"]);

export function useCompleteTask() {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const undoable = useUndoable();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => TASK_QUERIES.has(String(q.queryKey[0])) });
  return async (task: Pick<TaskItem, "id" | "title" | "status">) => {
    const previous = task.status === "COMPLETED" ? "PENDING" : (task.status as "PENDING" | "IN_PROGRESS" | "CANCELLED");
    await undoable({
      run: async () => {
        await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: task.id }, body: { status: "COMPLETED" } });
        await refresh();
      },
      undo: async () => {
        await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: task.id }, body: { status: previous } });
        await refresh();
      },
      message: `“${task.title}” marked done.`,
    });
  };
}

/** "Do these today": what is overdue, then what falls due today. Done is one tap and can be undone. */
export function TodoPanel({ title = "Do these today", showOwner, groups = ["OVERDUE", "TODAY"], emptyText, bare }: { title?: string; showOwner?: boolean; groups?: ("OVERDUE" | "TODAY" | "THIS_WEEK")[]; emptyText?: string; /** No "link chip" or owner, as on the Delivery list. */ bare?: boolean }) {
  const { orgSlug, timeZone, hour12 } = useMember();
  const over = useApiQuery("getTasksGroupsByGroup", { params: { orgSlug, group: "OVERDUE" }, query: { pageSize: "7" } }, { enabled: groups.includes("OVERDUE") });
  const today = useApiQuery("getTasksGroupsByGroup", { params: { orgSlug, group: "TODAY" }, query: { pageSize: "7" } }, { enabled: groups.includes("TODAY") });
  const week = useApiQuery("getTasksGroupsByGroup", { params: { orgSlug, group: "THIS_WEEK" }, query: { pageSize: "7" } }, { enabled: groups.includes("THIS_WEEK") });
  const complete = useCompleteTask();
  const items = [...((over.data?.items ?? []) as TaskItem[]), ...((today.data?.items ?? []) as TaskItem[]), ...((week.data?.items ?? []) as TaskItem[])].slice(0, 7);
  const loading = (groups.includes("OVERDUE") && over.isPending) || (groups.includes("TODAY") && today.isPending) || (groups.includes("THIS_WEEK") && week.isPending);

  return (
    <Panel title={title} action={{ label: "All tasks", href: `/o/${orgSlug}/tasks` }} className="fb-hp--todo">
      {loading ? (
        <div className="fb-hrow" aria-busy="true">
          <span className="fb-sr-only">Loading tasks</span>
          <div className="fb-hskel" style={{ height: 40, flex: 1 }} />
        </div>
      ) : null}
      {items.map((t) => {
        const due = dueLabel(t.dueAt, { timeZone, hour12 });
        return (
          <div className="fb-hrow" key={t.id}>
            <button
              type="button"
              className="fb-tick"
              aria-label={`Mark done: ${t.title}`}
              disabled={t.readOnly}
              title={t.readOnly ? "This task belongs to someone else, so only they can complete it." : undefined}
              onClick={() => void complete(t)}
            />
            <div className="fb-hrow__main">
              <div className="fb-hrow__title">{t.title}</div>
              <div className="fb-hrow__meta">
                <span className="fb-due" data-state={due.state}>
                  {due.state === "overdue" ? <HIcon name="alert" size={12} /> : null}
                  {due.text}
                </span>
                {showOwner && !bare && t.assigneeName ? <span className="fb-hrow__sub">{t.assigneeName}</span> : null}
                {t.link && !bare ? (
                  <Link href={recordHref(orgSlug, t.link.type, t.link.id)} className="fb-chiplink">
                    {linkChipLabel(t.link)} ↗
                  </Link>
                ) : null}
              </div>
            </div>
            {bare ? null : (
              <Link
                href={t.link ? `${recordHref(orgSlug, t.link.type, t.link.id)}?log=call` : `/o/${orgSlug}/tasks?new=call`}
                className="fb-logbtn"
                title="Log a call"
                aria-label={`Log a call: ${t.title}`}
              >
                <HIcon name="phone" size={14} />
                Log
              </Link>
            )}
          </div>
        );
      })}
      {!loading && items.length === 0 ? (
        <div className="fb-hrow fb-hrow--empty">
          <span className="fb-hrow__ok">
            <HIcon name="check-circle" size={18} />
          </span>
          {emptyText ?? "Nothing due today. Nice."}
        </div>
      ) : null}
    </Panel>
  );
}

/* "New since your last visit": the visit time is kept on this device, so it is a convenience and never a claim about the account. */

function visitKey(membershipId: string) {
  return `figbloom-home-lastvisit:${membershipId}`;
}

export function useLastVisit(membershipId: string): number | null {
  const [last, setLast] = useState<number | null>(null);
  const stamped = useRef(false);
  const read = useRef(false);
  useEffect(() => {
    // Read once: development's double mount must not see the time its own cleanup just stamped.
    if (!read.current) {
      read.current = true;
      try {
        const raw = window.localStorage.getItem(visitKey(membershipId));
        setLast(raw ? Number(raw) : null);
      } catch {
        setLast(null);
      }
    }
    const stamp = () => {
      try {
        window.localStorage.setItem(visitKey(membershipId), String(Date.now()));
      } catch {
        /* a private window: the panel simply shows the newest leads */
      }
    };
    stamped.current = true;
    window.addEventListener("pagehide", stamp);
    return () => {
      window.removeEventListener("pagehide", stamp);
      if (stamped.current) stamp();
    };
  }, [membershipId]);
  return last;
}

const TEMP: Record<string, { bg: string; fg: string; label: string }> = {
  HOT: { bg: "var(--red-soft)", fg: "var(--red)", label: "HOT" },
  WARM: { bg: "var(--orange-soft)", fg: "var(--orange-text)", label: "WARM" },
  COLD: { bg: "var(--blue-soft)", fg: "var(--blue)", label: "COLD" },
};

export type NewLeadRow = { id: string; name: string; meta: string; temperature: string; createdAt: string };

/** The newest leads, read once: the KPI and the panel both use this. */
export function useNewLeads() {
  const { orgSlug } = useMember();
  const ref = useReferenceData();
  const q = useApiQuery("listLeads", { params: { orgSlug }, query: { pageSize: 20, sort: "-createdAt", includeArchived: "false" } });
  const services = useMemo(() => new Map((ref.data?.services ?? []).map((s) => [s.id, s.name])), [ref.data]);
  const rows: NewLeadRow[] = (q.data?.items ?? []).map((l) => ({
    id: l.id,
    name: leadName(l as never),
    meta: [l.leadSource?.name, l.serviceInterestId ? services.get(l.serviceInterestId) : null, l.ownerMembershipId ? null : "unassigned"].filter(Boolean).join(" · "),
    temperature: l.temperature,
    createdAt: l.createdAt,
  }));
  return { rows, loading: q.isPending, error: q.error };
}

export function NewLeadsPanel({ rows, since }: { rows: NewLeadRow[]; since: number | null }) {
  const { orgSlug, timeZone, hour12 } = useMember();
  const fresh = since === null ? rows : rows.filter((r) => Date.parse(r.createdAt) > since);
  const shown = fresh.slice(0, 5);
  const sub = since
    ? `Since ${new Date(since).toLocaleString("en-GB", { weekday: "long", hour: "numeric", minute: "2-digit", hour12, timeZone: timeZone ?? undefined })}`
    : "Newest first";
  return (
    <Panel title="New since your last visit" sub={sub}>
      {shown.map((l) => {
        const t = TEMP[l.temperature] ?? TEMP.COLD!;
        return (
          <Link key={l.id} href={`/o/${orgSlug}/leads/${l.id}`} className="fb-hrow fb-hrow--link">
            <span className="fb-hav" aria-hidden="true">
              {initialsOf(l.name)}
            </span>
            <span className="fb-hrow__main">
              <span className="fb-hrow__title">{l.name}</span>
              <span className="fb-hrow__sub fb-block">{l.meta}</span>
            </span>
            <span className="fb-temp" style={{ background: t.bg, color: t.fg }}>
              {t.label}
            </span>
          </Link>
        );
      })}
      {shown.length === 0 ? <div className="fb-hrow fb-hrow--empty fb-hrow--quiet">No new leads since you were last here.</div> : null}
    </Panel>
  );
}

/* The pipeline cards ------------------------------------------------------------------------------------------------------------- */

function amountsText(values: { currency: string; amount: number }[]): string {
  if (values.length === 0) return "—";
  return values.map((v) => moneyShort(v.amount, v.currency)).join(" + ");
}

export function PipelineByStage() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getDealsBoard", { params: { orgSlug } });
  const open = (q.data?.columns ?? []).filter((c) => !c.stage.isWon && !c.stage.isLost);
  const totalCount = open.reduce((n, c) => n + c.count, 0);
  const anyHidden = open.some((c) => c.valuesHidden);
  const sums = open.map((c) => c.values.reduce((n, v) => n + v.amount, 0));
  const totalValue = sums.reduce((a, b) => a + b, 0);
  const share = (i: number) => {
    const base = anyHidden || totalValue === 0 ? (open[i]!.count / (totalCount || 1)) * 100 : (sums[i]! / totalValue) * 100;
    return Math.max(4, base);
  };
  const aria = open.map((c) => `${c.stage.name} ${c.count} deals${c.valuesHidden ? "" : `, ${amountsText(c.values)}`}`).join("; ");

  return (
    <Panel title="Pipeline by stage" aside={q.isPending ? "Loading" : `${totalCount} open`} padded className="fb-hp--pipe">
      <div className="fb-stackbar" role="img" aria-label={open.length ? aria : "No open deals"}>
        {open.map((c, i) => (
          <div key={c.stage.id} style={stageStyle(i, share(i))} />
        ))}
      </div>
      <div className="fb-stagegrid">
        {open.map((c, i) => (
          <Link key={c.stage.id} href={`/o/${orgSlug}/deals`} className="fb-stagegrid__cell">
            <div className="fb-stagegrid__name">
              <span className="fb-swatch" style={stageStyle(i)} aria-hidden="true" />
              {c.stage.name} · {c.count}
            </div>
            <div className="fb-stagegrid__val">{c.valuesHidden ? <MaskedValue reason="Deal values are shown only to roles that may see them." /> : amountsText(c.values)}</div>
          </Link>
        ))}
        {!q.isPending && open.length === 0 ? <span className="fb-hp__sub">No open deals yet.</span> : null}
      </div>
    </Panel>
  );
}

export function MovingAndStalled({ showOwner }: { showOwner?: boolean }) {
  const { orgSlug } = useMember();
  const ref = useReferenceData();
  const stalled = useApiQuery("getDeals", { params: { orgSlug }, query: { outcome: "OPEN", stalled: "true", pageSize: "5", sort: "lastActivityAt" } });
  const recent = useApiQuery("getDeals", { params: { orgSlug }, query: { outcome: "OPEN", pageSize: "5", sort: "-lastActivityAt" } });
  const owners = useMemo(() => new Map(((ref.data?.members ?? []) as { membershipId: string; name?: string; userName?: string }[]).map((m) => [m.membershipId, m.name ?? m.userName ?? ""])), [ref.data]);
  const seen = new Set<string>();
  const deals = [...(stalled.data?.items ?? []), ...(recent.data?.items ?? [])]
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .slice(0, 5);
  const loading = stalled.isPending || recent.isPending;
  return (
    <Panel title="Deals moving and stalled" sub="“Stalled” is a reminder. Stages only change when someone moves them.">
      {deals.map((d) => {
        const sig = (d as unknown as { signals?: { stalled: boolean; daysSinceActivity: number } }).signals;
        const isStalled = !!sig?.stalled;
        const days = sig?.daysSinceActivity ?? 0;
        const flag = isStalled ? `Stalled · ${days} days` : days <= 1 ? "Active today" : `Touched ${days} days ago`;
        const value = (d as unknown as { valueMasked?: boolean }).valueMasked ? null : d.value;
        return (
          <div className="fb-hrow" key={d.id}>
            <div className="fb-hrow__main">
              <Link href={`/o/${orgSlug}/deals/${d.id}`} className="fb-linkname">
                {d.company?.name ?? "Deal"}
              </Link>
              <div className="fb-hrow__sub">
                {(d as unknown as { pipelineStage?: { name: string } }).pipelineStage?.name ?? ""} ·{" "}
                {value === null ? <MaskedValue reason="Deal values are shown only to roles that may see them." /> : moneyShort(value as string, d.currency)}
                {showOwner && owners.get(d.ownerMembershipId) ? ` · ${owners.get(d.ownerMembershipId)}` : ""}
              </div>
            </div>
            <span className="fb-flag" data-stalled={isStalled ? "true" : undefined}>
              <HIcon name={isStalled ? "clock" : "trend"} size={12} />
              {flag}
            </span>
          </div>
        );
      })}
      {!loading && deals.length === 0 ? <div className="fb-hrow fb-hrow--empty fb-hrow--quiet">No open deals yet.</div> : null}
    </Panel>
  );
}
