"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ErrorState, NoAccess } from "../../components/states";
import { describeError } from "../../errors";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { ago } from "./format";
import { HIcon, Seg } from "./kit";

/** How often the count and the open list ask again. B2.11 chose polling over a pushed stream: simple, and a minute of delay costs nothing here. */
const POLL_MS = 30_000;

interface Notice {
  id: string;
  type: string;
  title: string;
  body: string;
  deepLink: string | null;
  read: boolean;
  createdAt: string;
}

const TYPES: Record<string, { label: string; icon: string; tone: "orange" | "red" | "blue" | "green" | "purple"; group: string }> = {
  LEAD_ASSIGNED: { label: "Lead assigned", icon: "user-plus", tone: "orange", group: "assigned" },
  TASK_DUE: { label: "Task due", icon: "calendar", tone: "green", group: "tasks" },
  TASK_OVERDUE: { label: "Task overdue", icon: "alert", tone: "red", group: "tasks" },
  DEAL_WON_HANDOFF: { label: "Handoff", icon: "package", tone: "blue", group: "handoff" },
  MENTION: { label: "Mention", icon: "bell", tone: "purple", group: "mentions" },
  RENEWAL_DUE: { label: "Renewal", icon: "refresh", tone: "green", group: "other" },
  PROPOSAL_UNANSWERED: { label: "Proposal", icon: "file", tone: "orange", group: "other" },
  STALLED_DEAL: { label: "Stalled deal", icon: "clock", tone: "orange", group: "other" },
  SUPPORT_ACCESS_REQUEST: { label: "Support access", icon: "lock", tone: "purple", group: "other" },
  LEAD_POOL: { label: "Shared lead pool", icon: "globe", tone: "orange", group: "web" },
  PAYMENT_OVERDUE: { label: "Payment overdue", icon: "wallet", tone: "red", group: "pay" },
  DORMANT_CUSTOMER: { label: "Quiet customer", icon: "clock", tone: "orange", group: "other" },
};
const FALLBACK = { label: "Notification", icon: "bell", tone: "green" as const, group: "other" };
const info = (type: string) => TYPES[type] ?? FALLBACK;

/**
 * Where a notification opens. The API gives an absolute link (built from the app's base address); only the path inside this organisation is
 * followed, so a link can never take someone out of the app or into another organisation.
 */
export function pathFromLink(link: string | null, orgSlug: string): string | null {
  if (!link) return null;
  try {
    const u = new URL(link, "http://local.invalid");
    const p = `${u.pathname}${u.search}${u.hash}`;
    return p.startsWith(`/o/${orgSlug}/`) || p === `/o/${orgSlug}` ? p : null;
  } catch {
    return null;
  }
}

export function useUnreadCount() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getUnreadNotificationCount", { params: { orgSlug } }, { refetchInterval: POLL_MS, staleTime: 10_000 });
  return q.data?.unreadCount ?? 0;
}

/** Marking read: one notice or all. The count and both lists refresh afterwards. */
function useReadActions() {
  const { orgSlug } = useMember();
  const one = useApiMutation("postNotificationsByNotificationIdRead", { invalidate: [["getUnreadNotificationCount"], ["listNotifications"]] });
  const all = useApiMutation("postNotificationsMarkAllRead", { invalidate: [["getUnreadNotificationCount"], ["listNotifications"]] });
  return {
    markRead: (id: string) => one.mutateAsync({ params: { orgSlug, notificationId: id } }),
    markAll: () => all.mutateAsync({ params: { orgSlug } }),
  };
}

/** The bell (G3): the unread count on the icon, and a panel with the latest notices. */
export function NotificationBell() {
  const { orgSlug } = useMember();
  const router = useRouter();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const list = useApiQuery("listNotifications", { params: { orgSlug }, query: { pageSize: "8" } }, { enabled: open, refetchInterval: open ? POLL_MS : false });
  const { markRead, markAll } = useReadActions();
  const items = (list.data?.items ?? []) as unknown as Notice[];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openNotice(n: Notice) {
    const to = pathFromLink(n.deepLink, orgSlug);
    setOpen(false);
    if (!n.read) void markRead(n.id).catch(() => undefined);
    if (to) router.push(to);
  }

  return (
    <span className="fb-bellwrap" ref={wrap}>
      <button
        type="button"
        className="fb-bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={17} aria-hidden="true" />
        {unread > 0 ? (
          <span className="fb-bell__badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={panelId} role="dialog" aria-label="Notifications" className="fb-notifpanel">
          <div className="fb-notifpanel__head">
            <strong>Notifications</strong>
            <button type="button" className="fb-notifpanel__link" disabled={unread === 0} onClick={() => void markAll()}>
              Mark all read
            </button>
          </div>
          <div className="fb-notifpanel__list">
            {list.isPending ? (
              <div className="fb-notifpanel__empty" role="status">
                Loading…
              </div>
            ) : list.isError ? (
              <div className="fb-notifpanel__empty" role="alert">
                Notifications did not load. <button type="button" className="fb-notifpanel__link" onClick={() => void list.refetch()}>Try again</button>
              </div>
            ) : items.length === 0 ? (
              <div className="fb-notifpanel__empty">You’re all caught up.</div>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id} className={`notification-item ${n.read ? "" : "notification-unread"}`} data-unread={n.read ? undefined : "true"}>
                    <button type="button" className="fb-notifpanel__item" onClick={() => void openNotice(n)}>
                      <span className="fb-notifpanel__dot" data-unread={n.read ? undefined : "true"} aria-hidden="true" />
                      <span className="fb-notifpanel__text">
                        <span className="fb-notifpanel__kind">
                          {info(n.type).label} · {ago(n.createdAt)}
                          {n.read ? "" : " · unread"}
                        </span>
                        <span className="fb-notifpanel__msg">{n.title}</span>
                        {n.body ? <span className="fb-notifpanel__body">{n.body}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="fb-notifpanel__foot">
            <Link href={`/o/${orgSlug}/notifications`} className="fb-notifpanel__link" onClick={() => setOpen(false)}>
              Open notification centre
            </Link>
            <Link href={`/o/${orgSlug}/settings`} className="fb-notifpanel__link fb-notifpanel__link--muted" onClick={() => setOpen(false)}>
              Preferences
            </Link>
          </div>
        </div>
      ) : null}
    </span>
  );
}

/* The centre ----------------------------------------------------------------------------------------------------------------------- */

const TABS: { id: string; label: string; match: (n: Notice) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "unread", label: "Unread", match: (n) => !n.read },
  { id: "assigned", label: "Assignments", match: (n) => info(n.type).group === "assigned" },
  { id: "mentions", label: "Mentions", match: (n) => info(n.type).group === "mentions" },
  { id: "tasks", label: "Tasks", match: (n) => info(n.type).group === "tasks" },
  { id: "handoff", label: "Handoffs", match: (n) => info(n.type).group === "handoff" },
  { id: "web", label: "Website leads", match: (n) => info(n.type).group === "web" },
  { id: "pay", label: "Payments", match: (n) => info(n.type).group === "pay" },
  { id: "other", label: "Other", match: (n) => info(n.type).group === "other" },
];

export function NotificationCentre() {
  const { orgSlug } = useMember();
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const q = useApiQuery("listNotifications", { params: { orgSlug }, query: { pageSize: "100" } }, { refetchInterval: POLL_MS });
  const { markRead, markAll } = useReadActions();
  const all = useMemo(() => (q.data?.items ?? []) as unknown as Notice[], [q.data]);
  const unread = q.data?.unreadCount ?? 0;
  // Like the design, a tab appears only when the person has something of that kind.
  const tabs = TABS.filter((t) => t.id === "all" || t.id === "unread" || all.some(t.match)).map((t) => ({ id: t.id, label: t.label, count: all.filter(t.match).length }));
  const shown = all.filter((TABS.find((t) => t.id === tab) ?? TABS[0]!).match);
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("all");
  }, [tabs, tab]);

  if (q.isError) {
    const e = describeError(q.error);
    return e.kind === "noAccess" ? <NoAccess area="Notifications" denial={e.denial} /> : <ErrorState error={q.error} area="Notifications" onRetry={() => void q.refetch()} />;
  }

  async function open(n: Notice) {
    const to = pathFromLink(n.deepLink, orgSlug);
    if (!n.read) await markRead(n.id).catch(() => undefined);
    if (to) router.push(to);
  }

  return (
    <div className="fb-notifs" data-screen-label="Notification centre">
      <div className="fb-notifs__head">
        <div>
          <h1 className="fb-homehead__title">Notifications</h1>
          <div className="fb-homehead__sub" style={{ marginTop: 4 }} aria-live="polite">
            {unread} unread · reminders, assignments and handoffs that involve you
          </div>
        </div>
        <div className="fb-homehead__actions">
          <button type="button" className="fb-qbtn fb-qbtn--lg" style={{ fontWeight: 600 }} disabled={unread === 0} onClick={() => void markAll()}>
            Mark all read
          </button>
          <Link href={`/o/${orgSlug}/settings`} className="fb-qbtn fb-qbtn--lg" style={{ fontWeight: 600 }}>
            <HIcon name="sliders" size={15} />
            Preferences
          </Link>
        </div>
      </div>
      <Seg label="Kinds of notification" value={tab} onChange={setTab} options={tabs} />
      <section className="fb-notifs__list" aria-label="Notification list">
        {q.isPending ? (
          <div className="fb-notifs__empty" role="status" aria-busy="true">
            Loading…
          </div>
        ) : shown.length === 0 ? (
          <div className="fb-notifs__empty">You’re all caught up.</div>
        ) : (
          <ul>
            {shown.map((n) => {
              const t = info(n.type);
              return (
                <li key={n.id} className="fb-notifs__row" data-unread={n.read ? undefined : "true"}>
                  <span className={`fb-tile fb-tone--${t.tone}`} style={{ width: 36, height: 36, borderRadius: 11 }} aria-hidden="true">
                    <HIcon name={t.icon} size={17} />
                  </span>
                  <div className="fb-notifs__main">
                    <div className="fb-notifs__kind">
                      {t.label} · {ago(n.createdAt)}
                      {n.read ? "" : " · unread"}
                    </div>
                    <div className="fb-notifs__msg" style={{ fontWeight: n.read ? 400 : 600 }}>
                      {n.title}
                    </div>
                    {n.body ? <div className="fb-notifs__body">{n.body}</div> : null}
                  </div>
                  <div className="fb-notifs__actions">
                    <button type="button" className="fb-qbtn" style={{ height: 32, padding: "0 12px", borderRadius: 8, fontSize: 12.5 }} onClick={() => void open(n)}>
                      Open
                    </button>
                    {!n.read ? (
                      <button type="button" className="fb-iconbtn" aria-label="Mark read" title="Mark read" onClick={() => void markRead(n.id)}>
                        <HIcon name="check" size={15} />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {q.data && q.data.total > all.length ? <div className="fb-hp__sub">Showing the latest {all.length} of {q.data.total}.</div> : null}
    </div>
  );
}
