"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState, MaskedValue } from "../../components/states";
import { useToast } from "../../components/toast";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { useRefData } from "../deals/data";
import { dealTitle, isMasked, kes, dealValue, type DealItem } from "../deals/model";
import { dialLinks, type ContactRow, contactName } from "../contacts/data";
import { Icon } from "../leads/icons";
import { leadName, useReference } from "../leads/data";
import { isOpen, type TaskGroups, type TaskItem } from "../tasks/model";
import { ago, dueLabel, initialsOf, useFieldWrite } from "./data";
import { useMobile } from "./MobileFrame";
import { InstallCard } from "./Sheets";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const LINK_TYPE: Record<string, string> = { Lead: "lead", Deal: "deal", Company: "company", Contact: "contact" };

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="fb-m-search">
      <Icon name="search" size={17} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} enterKeyHint="search" />
    </label>
  );
}

/** The state of a list read: loading, the explained error with Retry, or nothing (the caller draws the rows). */
function ReadState({ q, area }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; area: string }) {
  if (q.isPending) return <LoadingState label={`Loading ${area}`} lines={3} />;
  if (q.isError) return <ErrorState error={q.error} area={area} onRetry={() => void q.refetch()} />;
  return null;
}

/* Tasks ------------------------------------------------------------------------------------------------------------------------- */

/** Completing works offline (queued, sent once); reopening needs the server, and says so. */
function useTaskToggle() {
  const write = useFieldWrite();
  const api = useApi();
  const { orgSlug } = useMember();
  const toast = useToast();
  const qc = useQueryClient();
  const [done, setDone] = useState<Set<string>>(new Set());
  return {
    done,
    async toggle(t: TaskItem) {
      if (isOpen(t.status)) {
        setDone((s) => new Set(s).add(t.id));
        const out = await write("TASK_COMPLETE", { taskId: t.id }, `Done: ${t.title}`);
        if (out.status === "attention") {
          setDone((s) => {
            const n = new Set(s);
            n.delete(t.id);
            return n;
          });
          toast.show({ message: out.item.message ?? "That could not be saved.", tone: "danger" });
        } else if (out.status === "queued") toast.show({ message: "Saved on this phone. It sends when you are back online." });
      } else {
        try {
          await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: t.id }, body: { status: "PENDING" } });
          await qc.invalidateQueries();
        } catch (err) {
          const d = describeError(err);
          toast.show({ message: d.kind === "offline" ? "Reopening a task needs a connection." : d.body, tone: "danger" });
        }
      }
    },
  };
}

function TaskRow({ t, toggle, checked, base }: { t: TaskItem; toggle: (t: TaskItem) => void; checked: boolean; base: string }) {
  const finished = checked || !isOpen(t.status);
  const due = dueLabel(t.dueAt);
  const href = t.link ? `${base}/record/${LINK_TYPE[t.link.type] ?? "lead"}/${t.link.id}` : null;
  const body = (
    <>
      <span className={`fb-m-card__title${finished ? " fb-m-strike" : ""}`}>{t.title}</span>
      <span className={`fb-m-due fb-m-due--${finished ? "later" : due.tone}`}>{finished ? "Done" : due.text}{t.link?.label ? ` · ${t.link.label}` : ""}</span>
    </>
  );
  return (
    <li className="fb-m-card" style={{ listStyle: "none" }}>
      <button type="button" className="fb-m-check" aria-pressed={finished} aria-label={finished ? `Reopen: ${t.title}` : `Mark done: ${t.title}`} onClick={() => toggle(t)} disabled={t.readOnly} aria-disabled={t.readOnly || undefined}>
        <span className="fb-m-check__box">{finished ? <Icon name="check" size={16} stroke={3} /> : null}</span>
      </button>
      {href ? (
        <Link href={href} className="fb-m-card__body" style={{ color: "inherit" }}>
          {body}
        </Link>
      ) : (
        <div className="fb-m-card__body">{body}</div>
      )}
    </li>
  );
}

const GROUP_STYLE: Record<string, { label: string; color: string }> = {
  OVERDUE: { label: "Overdue", color: "var(--red)" },
  TODAY: { label: "Today", color: "var(--orange-text)" },
  UPCOMING: { label: "Upcoming", color: "var(--text-3)" },
  DONE: { label: "Done", color: "var(--primary-text)" },
};

function useTaskGroups(groups: string, pageSize: string) {
  const { orgSlug, can } = useMember();
  const work = can("mywork.view");
  const tasks = useApiQuery("getTasksGroups", { params: { orgSlug }, query: { pageSize, groups } as never }, { enabled: !work, refetchInterval: 60_000 });
  const mine = useApiQuery("getMyWork", { params: { orgSlug }, query: { groups: groups.replace(",NO_DATE", "").replace(",DONE", ""), pageSize } as never }, { enabled: work, refetchInterval: 60_000 });
  const q = work ? mine : tasks;
  const data = q.data as unknown as Partial<TaskGroups> | undefined;
  const byKey = new Map((data?.groups ?? []).map((g) => [g.key as string, g.items as TaskItem[]] as const));
  return { q, byKey, counts: (data?.counts ?? {}) as Record<string, number>, groups: data?.groups ?? [] };
}

export function TasksScreen() {
  const { base } = useMobile();
  const { q, byKey } = useTaskGroups("OVERDUE,TODAY,THIS_WEEK,LATER,NO_DATE,DONE", "8");
  const t = useTaskToggle();
  const sections = [
    { key: "OVERDUE", items: byKey.get("OVERDUE") ?? [] },
    { key: "TODAY", items: byKey.get("TODAY") ?? [] },
    { key: "UPCOMING", items: [...(byKey.get("THIS_WEEK") ?? []), ...(byKey.get("LATER") ?? []), ...(byKey.get("NO_DATE") ?? [])] },
    { key: "DONE", items: byKey.get("DONE") ?? [] },
  ];
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="fb-m-page" data-screen-label="Mobile · Tasks">
      <ReadState q={q} area="Tasks" />
      {q.isSuccess && total === 0 ? <div className="fb-m-empty">Nothing due. Enjoy the quiet.</div> : null}
      {q.isSuccess
        ? sections
            .filter((s) => s.items.length > 0)
            .map((s) => (
              <section key={s.key} aria-label={GROUP_STYLE[s.key]!.label}>
                <h2 className="fb-m-groupl" style={{ color: GROUP_STYLE[s.key]!.color }}>
                  {GROUP_STYLE[s.key]!.label} · {s.items.length}
                </h2>
                <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
                  {s.items.map((i) => (
                    <TaskRow key={i.id} t={i} toggle={t.toggle} checked={t.done.has(i.id)} base={base} />
                  ))}
                </ul>
              </section>
            ))
        : null}
    </div>
  );
}

/* Today ------------------------------------------------------------------------------------------------------------------------- */

const LAST_VISIT = (org: string) => `figbloom-m-last-visit:${org}`;

export function TodayScreen() {
  const m = useMember();
  const { base } = useMobile();
  const router = useRouter();
  const work = m.can("mywork.view");
  const canLeads = m.canAny("leads.view.own", "leads.view.all", "leads.view.shared");
  const canPay = m.can("finance.view.payments") && !m.canAny("tasks.view.own", "tasks.view.all");
  const { q, byKey, groups } = useTaskGroups(work ? "OVERDUE,TODAY,THIS_WEEK,LATER" : "OVERDUE,TODAY", "6");
  const t = useTaskToggle();
  const lastVisit = useRef<number>(Date.now() - 864e5);
  useEffect(() => {
    try {
      const held = window.localStorage.getItem(LAST_VISIT(m.orgSlug));
      if (held) lastVisit.current = Number(held);
      window.localStorage.setItem(LAST_VISIT(m.orgSlug), String(Date.now()));
    } catch {
      /* blocked storage: the last day is used */
    }
  }, [m.orgSlug]);

  const leads = useApiQuery("listLeads", { params: { orgSlug: m.orgSlug }, query: { pageSize: 20, sort: "-createdAt", includeArchived: "false" } as never }, { enabled: canLeads, staleTime: 30_000 });
  const ref = useReference();
  const payments = useApiQuery("listWonDealPayments", { params: { orgSlug: m.orgSlug }, query: { page: "1", pageSize: "50" } as never }, { enabled: canPay });

  const hour = new Date().getHours();
  const first = m.userName.replace(/^Dev\s+/, "").split(" ")[0];
  const greet = work ? "Your assigned work" : `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${first}`;
  const dateText = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: m.timeZone ?? undefined });

  const overdue = (byKey.get("OVERDUE") ?? []).filter((i) => !t.done.has(i.id));
  const today = (byKey.get("TODAY") ?? []).filter((i) => !t.done.has(i.id));
  const rest = work ? [...(byKey.get("THIS_WEEK") ?? []), ...(byKey.get("LATER") ?? [])] : [];
  const todo = [...overdue, ...today, ...rest].slice(0, 8);
  const overdueCount = groups.find((g) => g.key === "OVERDUE")?.total ?? overdue.length;
  const todayCount = groups.find((g) => g.key === "TODAY")?.total ?? today.length;

  const newLeads = ((leads.data?.items ?? []) as unknown as { id: string; createdAt: string; company?: { name: string } | null; contact?: unknown; leadSource?: { name: string } | null; serviceInterestId: string | null }[]).filter((l) => new Date(l.createdAt).getTime() > lastVisit.current);

  const payRows = (payments.data?.items ?? []) as unknown as { dealId: string; state: string; companyId: string; companyName: string; nextNote: { note: string } | null }[];
  const counts = canPay
    ? [
        { n: payRows.filter((r) => r.state === "OVERDUE").length, l: "Overdue payments", tone: "red", go: `${base}/customers` },
        { n: payRows.filter((r) => r.state === "AWAITING_PAYMENT").length, l: "Awaiting payment", tone: "", go: `${base}/customers` },
        { n: payRows.filter((r) => r.state === "NOT_INVOICED").length, l: "To invoice", tone: "", go: `${base}/customers` },
      ]
    : [
        { n: overdueCount, l: "Overdue", tone: overdueCount ? "red" : "", go: `${base}/tasks` },
        { n: todayCount, l: "Due today", tone: "", go: `${base}/tasks` },
        canLeads ? { n: newLeads.length, l: "New leads", tone: "", go: `${base}/leads` } : { n: overdueCount + todayCount + rest.length, l: "Open tasks", tone: "", go: `${base}/tasks` },
      ];

  return (
    <div className="fb-m-page" data-screen-label="Mobile · Today">
      <InstallCard />
      <div>
        <div className="fb-m-date">{dateText}</div>
        <h2 className="fb-m-h1">{greet}</h2>
      </div>
      <div className="fb-m-counts">
        {counts.map((c) => (
          <button key={c.l} type="button" className="fb-m-count" onClick={() => router.push(c.go)}>
            <div className="fb-m-count__n" style={{ color: c.tone === "red" ? "var(--red)" : undefined }}>
              {c.n}
            </div>
            <div className="fb-m-count__l">{c.l}</div>
          </button>
        ))}
      </div>
      {canPay ? (
        <section>
          <h2 className="fb-m-h2">Payment follow-ups</h2>
          <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
            {payRows
              .filter((r) => r.state === "OVERDUE" || r.nextNote)
              .slice(0, 8)
              .map((r) => (
                <li key={r.dealId} style={{ listStyle: "none" }}>
                  <Link href={`${base}/record/company/${r.companyId}`} className="fb-m-card" style={{ color: "inherit" }}>
                    <span className="fb-m-card__body">
                      <span className="fb-m-card__title">{r.nextNote?.note ?? "Payment overdue"}</span>
                      <span className="fb-m-card__meta">{r.companyName}</span>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </Link>
                </li>
              ))}
          </ul>
          {payments.isSuccess && payRows.filter((r) => r.state === "OVERDUE" || r.nextNote).length === 0 ? <div className="fb-m-empty">No payment follow-ups. Enjoy the quiet.</div> : null}
        </section>
      ) : (
        <section>
          <h2 className="fb-m-h2">{work ? "Assigned to me" : "Do these today"}</h2>
          <ReadState q={q} area="Today" />
          {q.isSuccess ? (
            todo.length === 0 ? (
              <div className="fb-m-empty">Nothing due. Enjoy the quiet.</div>
            ) : (
              <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
                {todo.map((i) => (
                  <TaskRow key={i.id} t={i} toggle={t.toggle} checked={t.done.has(i.id)} base={base} />
                ))}
              </ul>
            )
          ) : null}
        </section>
      )}
      {canLeads && newLeads.length > 0 ? (
        <section>
          <h2 className="fb-m-h2">New since your last visit</h2>
          <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
            {newLeads.slice(0, 5).map((l) => {
              const name = leadName(l);
              return (
                <li key={l.id} style={{ listStyle: "none" }}>
                  <Link href={`${base}/record/lead/${l.id}`} className="fb-m-card" style={{ color: "inherit" }}>
                    <span className="fb-m-avatar fb-m-avatar--orange" aria-hidden="true">
                      {initialsOf(name)}
                    </span>
                    <span className="fb-m-card__body">
                      <span className="fb-m-card__title">{name}</span>
                      <span className="fb-m-card__meta">{[l.leadSource?.name, ref.service(l.serviceInterestId)?.name].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* Leads ------------------------------------------------------------------------------------------------------------------------- */

interface LeadListItem {
  id: string;
  temperature: "HOT" | "WARM" | "COLD";
  serviceInterestId: string | null;
  nextFollowUpAt: string | null;
  leadStatus: { name: string };
  company?: { name: string } | null;
  contact?: unknown;
}

export function LeadsScreen() {
  const { orgSlug } = useMember();
  const { base } = useMobile();
  const ref = useReference();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const list = useApiQuery("listLeads", { params: { orgSlug }, query: { q: q || undefined, pageSize: 30, includeArchived: "false" } as never }, { placeholderData: (prev) => prev });
  const items = ((list.data?.items ?? []) as unknown as LeadListItem[]).filter((l) => !(l as { convertedAt?: string | null }).convertedAt);
  return (
    <div className="fb-m-page" data-screen-label="Mobile · Leads">
      <SearchBox value={text} onChange={setText} placeholder="Search my leads" label="Search leads" />
      <ReadState q={list} area="Leads" />
      {list.isSuccess && items.length === 0 ? <div className="fb-m-empty">{q ? `No lead matches “${q}”.` : "No leads yet. Tap the orange button to capture one."}</div> : null}
      <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
        {items.map((l) => {
          const due = dueLabel(l.nextFollowUpAt);
          return (
            <li key={l.id} style={{ listStyle: "none" }}>
              <Link href={`${base}/record/lead/${l.id}`} className="fb-m-card" style={{ color: "inherit" }}>
                <span className="fb-m-card__body">
                  <span className="fb-m-card__title">{leadName(l)}</span>
                  <span className="fb-m-card__meta">{[l.leadStatus.name, ref.service(l.serviceInterestId)?.name].filter(Boolean).join(" · ")}</span>
                  <span className={`fb-m-due fb-m-due--${l.nextFollowUpAt ? due.tone : "later"}`}>{l.nextFollowUpAt ? due.text : "No follow-up set"}</span>
                </span>
                <span className={`fb-m-temp fb-m-temp--${l.temperature}`}>{l.temperature}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Customers --------------------------------------------------------------------------------------------------------------------- */

export function CustomersScreen() {
  const m = useMember();
  const { base, reach } = useMobile();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const people = m.can("contacts.view");
  const contacts = useApiQuery("listContactDirectory", { params: { orgSlug: m.orgSlug }, query: { q: q || undefined, page: "1", pageSize: "25" } as never }, { enabled: people, placeholderData: (prev) => prev });
  const companies = useApiQuery("getCompanies", { params: { orgSlug: m.orgSlug }, query: { q: q || undefined, page: "1", pageSize: "25" } as never }, { enabled: !people && m.can("companies.view"), placeholderData: (prev) => prev });
  const rows = people
    ? ((contacts.data?.items ?? []) as unknown as ContactRow[]).map((c) => ({
        key: c.id,
        href: `${base}/record/contact/${c.id}`,
        name: contactName(c),
        sub: [c.company?.name, c.jobTitle].filter(Boolean).join(" · ") || c.phone || "",
        phone: c.phone ?? null,
        target: { contactId: c.id, name: c.firstName },
      }))
    : ((companies.data?.items ?? []) as unknown as { id: string; name: string; industry?: string | null; location?: string | null; phone?: string | null }[]).map((c) => ({
        key: c.id,
        href: `${base}/record/company/${c.id}`,
        name: c.name,
        sub: [c.industry, c.location].filter(Boolean).join(" · "),
        phone: c.phone ?? null,
        target: { companyId: c.id, name: c.name },
      }));
  const read = people ? contacts : companies;
  const mayCall = m.can("activities.create");
  return (
    <div className="fb-m-page" data-screen-label="Mobile · Customer lookup">
      <SearchBox value={text} onChange={setText} placeholder="Name, company or phone" label="Search customers" />
      <ReadState q={read} area="Customers" />
      {read.isSuccess && rows.length === 0 ? <div className="fb-m-empty">No one matches “{q}”.</div> : null}
      <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
        {rows.map((r) => {
          const links = mayCall ? dialLinks(r.phone) : null;
          return (
            <li key={r.key} className="fb-m-card" style={{ listStyle: "none" }}>
              <Link href={r.href} className="fb-m-card__body" style={{ color: "inherit", display: "flex", gap: 12, alignItems: "center" }}>
                <span className="fb-m-avatar" aria-hidden="true">
                  {initialsOf(r.name)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="fb-m-card__title">{r.name}</span>
                  <span className="fb-m-card__meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.sub}
                  </span>
                </span>
              </Link>
              {links ? (
                <a href={links.tel} className="fb-m-callbtn" aria-label={`Call ${r.name}`} onClick={() => reach(r.target, "CALL")}>
                  <Icon name="phone" size={18} />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Notifications ----------------------------------------------------------------------------------------------------------------- */

interface Notice {
  id: string;
  type: string;
  title: string;
  body: string;
  deepLink: string | null;
  read: boolean;
  createdAt: string;
}

/** Where a notification opens on the phone: a record opens its phone record, tasks open the task list, anything else opens its desktop page. */
export function phoneTarget(link: string | null, orgSlug: string): string | null {
  if (!link) return null;
  try {
    const u = new URL(link, "http://local.invalid");
    const p = u.pathname;
    const root = `/o/${orgSlug}`;
    if (p !== root && !p.startsWith(`${root}/`)) return null;
    const rest = p.slice(root.length).split("/").filter(Boolean);
    const kind = { leads: "lead", contacts: "contact", companies: "company", deals: "deal" }[rest[0] ?? ""];
    if (kind && rest[1]) return `${root}/m/record/${kind}/${rest[1]}`;
    if (rest[0] === "tasks") return `${root}/m/tasks`;
    return `${p}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

export function AlertsScreen() {
  const { orgSlug } = useMember();
  const router = useRouter();
  const q = useApiQuery("listNotifications", { params: { orgSlug }, query: { pageSize: "30" } as never }, { refetchInterval: 30_000 });
  const one = useApiMutation("postNotificationsByNotificationIdRead", { invalidate: [["getUnreadNotificationCount"], ["listNotifications"]] });
  const all = useApiMutation("postNotificationsMarkAllRead", { invalidate: [["getUnreadNotificationCount"], ["listNotifications"]] });
  const items = (q.data?.items ?? []) as unknown as Notice[];
  const unread = items.filter((n) => !n.read).length;
  const label = useMemo(() => (type: string) => type.replace(/_/g, " ").toLowerCase(), []);
  return (
    <div className="fb-m-page" data-screen-label="Mobile · Notifications">
      <div className="fb-m-row">
        <h2 className="fb-m-h1" style={{ fontSize: 22 }}>
          Notifications
        </h2>
        <button type="button" className="fb-m-linkbtn" disabled={unread === 0} aria-disabled={unread === 0} onClick={() => void all.mutateAsync({ params: { orgSlug } })}>
          Mark all read
        </button>
      </div>
      <ReadState q={q} area="Notifications" />
      {q.isSuccess && items.length === 0 ? <div className="fb-m-empty">You are all caught up.</div> : null}
      <div className="fb-m-list" aria-live="polite">
        {items.map((n) => (
          <button
            key={n.id}
            type="button"
            className="fb-m-notif"
            data-unread={n.read ? undefined : "true"}
            onClick={async () => {
              if (!n.read) await one.mutateAsync({ params: { orgSlug, notificationId: n.id } }).catch(() => undefined);
              const to = phoneTarget(n.deepLink, orgSlug);
              if (to) router.push(to);
            }}
          >
            <span className="fb-m-notif__dot" aria-hidden="true" />
            <span>
              <span className="fb-m-notif__type">
                {label(n.type)} · {ago(n.createdAt)}
                {n.read ? "" : " · unread"}
              </span>
              <span className="fb-m-notif__text">{n.title}</span>
              {n.body ? <span className="fb-m-card__meta">{n.body}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* Pipeline (read-only) ---------------------------------------------------------------------------------------------------------- */

export function PipelineScreen() {
  const m = useMember();
  const { base } = useMobile();
  const wonOnly = !m.canAny("deals.view.all", "deals.view.own") && m.can("deals.view.won");
  const refData = useRefData();
  const stageName = new Map((refData.data?.stages ?? []).map((s) => [s.id, s.name] as const));
  const q = useApiQuery("getDeals", { params: { orgSlug: m.orgSlug }, query: { ...(wonOnly ? {} : { outcome: "OPEN" }), pageSize: "30", sort: "-lastActivityAt" } as never });
  const deals = (q.data?.items ?? []) as unknown as DealItem[];
  return (
    <div className="fb-m-page" data-screen-label="Mobile · Pipeline">
      <div className="fb-m-note" role="note">
        <Icon name="monitor" size={16} />
        <span>
          {wonOnly ? "Won deals are shown for reading." : "The pipeline is read-only on your phone."} Moving a deal to another stage is done on a laptop, so nothing is overwritten while you are offline.
        </span>
      </div>
      <ReadState q={q} area="Pipeline" />
      {q.isSuccess && deals.length === 0 ? <EmptyState title="No deals to show" body="Deals you can see will appear here." /> : null}
      <ul className="fb-m-list" style={{ padding: 0, margin: 0 }}>
        {deals.map((d) => {
          const value = dealValue(d);
          return (
            <li key={d.id} style={{ listStyle: "none" }}>
              <Link href={`${base}/record/deal/${d.id}`} className="fb-m-card" style={{ color: "inherit", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <span className="fb-m-row">
                  <strong>{d.company.name}</strong>
                  <span className="fb-m-muted" style={{ fontSize: 12, fontWeight: 600 }}>
                    {stageName.get(d.pipelineStageId) ?? ""}
                  </span>
                </span>
                <span className="fb-m-muted" style={{ fontSize: 13 }}>
                  {dealTitle(d as never)} · {isMasked(d) ? <MaskedValue /> : value === null ? "No value yet" : kes(value, d.currency)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
