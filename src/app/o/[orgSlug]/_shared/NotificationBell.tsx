"use client";

import { useEffect, useState } from "react";
import { IconBell } from "./icons";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const res = await fetch(`/api/orgs/${orgSlug}/notifications`);
    if (!res.ok) return;
    const body = await res.json();
    setNotifications(body.notifications ?? []);
    setUnreadCount(body.unreadCount ?? 0);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [orgSlug]);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) await load();
  }

  async function handleClickNotification(n: NotificationItem) {
    if (!n.readAt) {
      await fetch(`/api/orgs/${orgSlug}/notifications/${n.id}/read`, { method: "POST" });
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((p) => (p.id === n.id ? { ...p, readAt: new Date().toISOString() } : p)),
      );
    }
    if (n.link) window.location.href = n.link;
  }

  async function handleMarkAllRead() {
    await fetch(`/api/orgs/${orgSlug}/notifications/mark-all-read`, { method: "POST" });
    setUnreadCount(0);
    setNotifications((prev) => prev.map((p) => ({ ...p, readAt: p.readAt ?? new Date().toISOString() })));
  }

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="icon-button"
        title="Notifications"
        aria-label="Notifications"
        onClick={handleOpen}
      >
        <IconBell />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" className="link-button" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="who">No notifications yet.</p>
          ) : (
            <ul className="notification-list">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={n.readAt ? "notification-item" : "notification-item notification-unread"}
                >
                  <button type="button" onClick={() => handleClickNotification(n)}>
                    <div className="notification-title">{n.title}</div>
                    <div className="notification-time">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
