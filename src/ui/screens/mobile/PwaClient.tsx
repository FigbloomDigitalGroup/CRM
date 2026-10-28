"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useSyncNow } from "./data";
import { installState, applyCacheVersion, registerServiceWorker } from "./pwa";
import { PHONE_MAX_WIDTH, PHONE_TWINS } from "./tabs";

export const DESKTOP_VIEW_KEY = "figbloom-desktop-view";

/**
 * Everything the installed app needs, mounted once by the organisation shell (never by the sign-in pages): registers the service worker,
 * keeps the install offer, compares the cache version, and sends the offline queue whenever the connection comes back.
 */
export function PwaClient() {
  const api = useApi();
  const { orgSlug } = useMember();
  const sync = useSyncNow();

  useEffect(() => installState.watch(), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reg = await registerServiceWorker();
      try {
        const v = await api.call("getPwaVersion", { params: { orgSlug } });
        if (!cancelled && typeof v.cacheVersion === "string") await applyCacheVersion(v.cacheVersion, reg);
      } catch {
        /* offline or signed out: the next load checks again */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, orgSlug]);

  useEffect(() => {
    const go = () => {
      if (navigator.onLine !== false) void sync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") go();
    };
    window.addEventListener("online", go);
    document.addEventListener("visibilitychange", onVisible);
    go();
    // A queue that could not be sent (a bad signal while "online") is retried on its own.
    const timer = window.setInterval(go, 30_000);
    return () => {
      window.removeEventListener("online", go);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [sync]);

  return <PhoneRouter orgSlug={orgSlug} />;
}

/**
 * On a phone the organisation's entry pages (home, leads, tasks, companies, contacts, notifications) open their phone versions. A person who
 * chose "Use the desktop view" in More keeps the desktop pages for the rest of the tab's life. Every other page is the responsive desktop
 * page (a drawer menu, tables that scroll inside themselves).
 */
export function PhoneRouter({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;
    const narrow = typeof window.matchMedia === "function" && window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;
    if (!narrow) return;
    try {
      if (window.sessionStorage.getItem(DESKTOP_VIEW_KEY) === "1") return;
    } catch {
      /* blocked storage: treat as "phone view" */
    }
    const base = `/o/${orgSlug}`;
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return;
    const rest = pathname.slice(base.length).replace(/\/$/, "");
    const twin = PHONE_TWINS[rest];
    if (twin !== undefined) router.replace(`${base}${twin}`);
  }, [pathname, orgSlug, router]);
  return null;
}
