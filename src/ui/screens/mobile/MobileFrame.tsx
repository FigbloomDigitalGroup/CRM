"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { connectivity, watchBrowserConnectivity } from "../../data/connectivity";
import { useMember } from "../../data/member";
import type { IdentityInfo } from "../../shell/TopBar";
import { useUnreadCount } from "../home/Notifications";
import { Icon } from "../leads/icons";
import type { LogTarget } from "../contacts/QuickLogPrompt";
import { useQueue } from "./data";
import { CaptureSheet, IdentitySheet, LogSheet, MoreSheet, QueueSheet, type LogMode } from "./Sheets";
import { mobileTabs, tabForPath, type MobileTabId } from "./tabs";

export type SheetState =
  | { kind: "capture" }
  | { kind: "log"; target: LogTarget | null; mode: LogMode }
  | { kind: "more" }
  | { kind: "identity" }
  | { kind: "queue" }
  | null;

interface MobileApi {
  openCapture: () => void;
  /** A call or WhatsApp was started from this record: the log sheet opens when the person comes back to the app. */
  reach: (target: LogTarget, channel: "CALL" | "WHATSAPP") => void;
  openNote: (target: LogTarget) => void;
  openQueue: () => void;
  closeSheet: () => void;
  orgSlug: string;
  base: string;
}

const Ctx = createContext<MobileApi | null>(null);
export function useMobile(): MobileApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMobile must be used inside <MobileFrame>.");
  return v;
}

const PENDING_KEY = "figbloom-m-pending-reach";
const PENDING_MAX_AGE_MS = 30 * 60_000;
const FALLBACK_MS = 2500;

interface PendingReach {
  target: LogTarget;
  channel: "CALL" | "WHATSAPP";
  at: number;
}

function readPending(): PendingReach | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingReach;
    return Date.now() - p.at < PENDING_MAX_AGE_MS ? p : null;
  } catch {
    return null;
  }
}
function writePending(p: PendingReach | null) {
  try {
    if (p) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* blocked storage: the prompt still works while the page stays open */
  }
}

const TITLES: Record<string, string> = { leads: "My leads", customers: "Customers", tasks: "Tasks", alerts: "Notifications", pipeline: "Pipeline", record: "" };

/**
 * The phone's frame (M1): a dark header with the organisation mark, notifications and your initial, the offline and sync banner, the page,
 * the bottom bar with the raised Capture action, and the sheets that slide up. Rendered by the app shell in place of the desktop chrome for
 * every route under `/o/{org}/m`.
 */
export function MobileFrame({ identity, children }: { identity: IdentityInfo; children: ReactNode }) {
  const m = useMember();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const base = `/o/${m.orgSlug}/m`;
  const tabs = useMemo(() => mobileTabs(m.permissionKeys), [m.permissionKeys]);
  const active = tabForPath(pathname, m.orgSlug);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [pending, setPending] = useState<PendingReach | null>(null);
  const unread = useUnreadCount();
  const conn = useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot, connectivity.getServerSnapshot);
  const { waiting, attention } = useQueue();

  const segment = pathname.slice(base.length).replace(/^\//, "").split("/")[0] ?? "";
  const isRoot = segment === "" || segment === "leads" || segment === "customers" || segment === "tasks";
  const title = segment === "" ? (m.can("mywork.view") ? "My work" : "Today") : (TITLES[segment] ?? "Figbloom CRM");
  const workOnly = m.can("mywork.view");

  const closeSheet = useCallback(() => setSheet(null), []);

  // The desktop shell wires the browser's online and offline events to the connectivity service; the phone frame replaces that shell, so it does too.
  useEffect(() => watchBrowserConnectivity(), []);

  // A call or WhatsApp chat was started: when the person is back in the app, ask how it went. A phone may unload this page while the call
  // app is in front, so the pending note also survives a reload.
  useEffect(() => {
    const stored = readPending();
    if (stored) {
      writePending(null);
      setSheet({ kind: "log", target: stored.target, mode: stored.channel });
    }
  }, []);
  useEffect(() => {
    if (!pending) return;
    let left = document.visibilityState === "hidden";
    const show = () => {
      writePending(null);
      setPending(null);
      setSheet({ kind: "log", target: pending.target, mode: pending.channel });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") left = true;
      else if (left) show();
    };
    const onBlur = () => {
      left = true;
    };
    const onFocus = () => {
      if (left) show();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    const timer = window.setTimeout(() => {
      if (!left) show();
    }, FALLBACK_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer);
    };
  }, [pending]);

  const api = useMemo<MobileApi>(
    () => ({
      orgSlug: m.orgSlug,
      base,
      openCapture: () => setSheet({ kind: "capture" }),
      openNote: (target) => setSheet({ kind: "log", target, mode: "NOTE" }),
      openQueue: () => setSheet({ kind: "queue" }),
      closeSheet,
      reach: (target, channel) => {
        const p = { target, channel, at: Date.now() };
        writePending(p);
        setPending(p);
      },
    }),
    [m.orgSlug, base, closeSheet],
  );

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo?.(0, 0);
  }, [pathname]);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(base);
  };

  const letter = (m.userName.replace(/^Dev\s+/, "")[0] ?? "?").toUpperCase();
  const offline = !conn.online;

  return (
    <Ctx.Provider value={api}>
      <div className="fb-m" data-screen-label="Mobile">
        <header className="fb-m-head">
          {isRoot ? (
            <button type="button" className="fb-m-iconbtn fb-m-iconbtn--square" aria-label="Organisation and session" onClick={() => setSheet({ kind: "identity" })}>
              <img className="fb-m-logo" src="/icons/icon-192.png" alt="" />
            </button>
          ) : (
            <button type="button" className="fb-m-iconbtn fb-m-iconbtn--back" aria-label="Back" onClick={goBack}>
              <Icon name="arrow-left" size={20} />
            </button>
          )}
          <h1 className="fb-m-head__title">{title}</h1>
          <Link href={`${base}/alerts`} className="fb-m-iconbtn" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
            <Icon name="bell" size={19} />
            {unread > 0 ? (
              <span className="fb-m-badge" aria-hidden="true">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
          <button type="button" className="fb-m-me" aria-label="Account and more" onClick={() => setSheet({ kind: "more" })}>
            {letter}
          </button>
        </header>

        {offline ? (
          <div className="fb-m-banner" role="status">
            <Icon name="alert" size={15} />
            <span className="fb-m-banner__text">
              Offline · {waiting} {waiting === 1 ? "change" : "changes"} waiting to sync
            </span>
            <button type="button" onClick={() => setSheet({ kind: "queue" })}>
              Details
            </button>
          </div>
        ) : attention > 0 ? (
          <div className="fb-m-banner fb-m-banner--bad" role="status">
            <Icon name="alert" size={15} />
            <span className="fb-m-banner__text">
              {attention} {attention === 1 ? "change needs" : "changes need"} your attention
            </span>
            <button type="button" onClick={() => setSheet({ kind: "queue" })}>
              Review
            </button>
          </div>
        ) : waiting > 0 ? (
          <div className="fb-m-banner" role="status">
            <Icon name="clock" size={15} />
            <span className="fb-m-banner__text">Sending {waiting} {waiting === 1 ? "change" : "changes"}…</span>
            <button type="button" onClick={() => setSheet({ kind: "queue" })}>
              Details
            </button>
          </div>
        ) : conn.slow ? (
          <div className="fb-m-banner" role="status">
            <Icon name="clock" size={15} />
            <span className="fb-m-banner__text">Slow connection. Your changes are saved on this phone first.</span>
          </div>
        ) : null}

        <main className="fb-m-main" id="main" ref={mainRef} tabIndex={-1}>
          {children}
        </main>

        <nav className="fb-m-nav" aria-label="Primary">
          {tabs.map((t) => {
            const on = active === t.id;
            const inner = (
              <>
                <span className="fb-m-nav__icon">
                  <Icon name={t.icon} size={t.center ? 24 : 21} stroke={2} />
                </span>
                {t.center ? null : t.label}
              </>
            );
            if (t.center) {
              return (
                <button
                  key={t.id}
                  type="button"
                  className="fb-m-nav__btn fb-m-nav__btn--center"
                  aria-label={t.id === "capture" ? "Quick capture" : "Add a note"}
                  onClick={() => {
                    if (t.id === "capture") api.openCapture();
                    else setSheet({ kind: "log", target: null, mode: "NOTE" });
                  }}
                >
                  {inner}
                </button>
              );
            }
            return (
              <Link key={t.id} href={`${base}${t.path}`} className="fb-m-nav__btn" aria-current={on ? "page" : undefined} aria-label={workOnly && t.id === "today" ? "My work" : t.label}>
                {inner}
              </Link>
            );
          })}
        </nav>

        {sheet?.kind === "capture" ? <CaptureSheet onClose={closeSheet} /> : null}
        {sheet?.kind === "log" ? <LogSheet target={sheet.target} mode={sheet.mode} onClose={closeSheet} /> : null}
        {sheet?.kind === "queue" ? <QueueSheet onClose={closeSheet} /> : null}
        {sheet?.kind === "identity" ? <IdentitySheet identity={identity} onClose={closeSheet} /> : null}
        {sheet?.kind === "more" ? <MoreSheet identity={identity} onClose={closeSheet} onQueue={() => setSheet({ kind: "queue" })} /> : null}
      </div>
    </Ctx.Provider>
  );
}

export type { MobileTabId };
