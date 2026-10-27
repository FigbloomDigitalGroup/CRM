"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { OfflineBanner } from "../components/states";
import { ToastProvider } from "../components/toast";
import { connectivity, watchBrowserConnectivity } from "../data/connectivity";
import { ApiProvider, useApi } from "../data/hooks";
import { copy } from "../copy";
import { SessionGuard, type SessionTimes } from "./SessionGuard";
import { Sidebar } from "./Sidebar";
import { IdentityBlock, QuickCreate, TopBar, type IdentityInfo } from "./TopBar";
import type { NavSection, QuickCreateItem } from "./navModel";

/** The offline banner and the slow-connection bar, driven by the connectivity service (shared with the offline queue, F4.12). */
export function ConnectionBanners() {
  const state = useSyncExternalStore(connectivity.subscribe, connectivity.getSnapshot, connectivity.getServerSnapshot);
  useEffect(() => watchBrowserConnectivity(), []);
  return (
    <>
      {!state.online ? (
        <div style={{ padding: "8px 20px 0" }}>
          <OfflineBanner queued={state.queued} />
        </div>
      ) : state.slow ? (
        <div className="fb-conn fb-conn--slow" role="status" aria-label={copy.offline.slow} />
      ) : null}
    </>
  );
}

export interface AppShellProps {
  orgSlug: string;
  sections: NavSection[];
  quickCreate: QuickCreateItem[];
  identity: IdentityInfo;
  dateLabel: string;
  initialSidebarCollapsed: boolean;
  session: SessionTimes | null;
  /** Server-rendered pieces the shell lays out: the global search box and the notification bell. */
  search: ReactNode;
  bell: ReactNode;
  /** The V1.1 organisation switcher. Left out in V1: the slot exists, nothing renders in it. */
  organisationSwitcher?: ReactNode;
  children: ReactNode;
}

function Shell({ orgSlug, sections, quickCreate, identity, dateLabel, initialSidebarCollapsed, session, search, bell, organisationSwitcher, children }: AppShellProps) {
  const api = useApi();
  const [navOpen, setNavOpen] = useState(false);

  const saveCollapsed = useCallback(
    (collapsed: boolean) => {
      // Saved to the account so it follows the person; failure is harmless (the device keeps its own copy).
      void api.call("updateMyPreferences", { params: { orgSlug }, body: { sidebar: { collapsed } } }).catch(() => undefined);
    },
    [api, orgSlug],
  );

  return (
    <div className="fb-shell">
      <Sidebar
        orgSlug={orgSlug}
        sections={sections}
        initialCollapsed={initialSidebarCollapsed}
        onCollapsedChange={saveCollapsed}
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
      />
      <div className="fb-main">
        <TopBar
          dateLabel={dateLabel}
          search={search}
          bell={bell}
          quickCreate={<QuickCreate orgSlug={orgSlug} items={quickCreate} />}
          identity={<IdentityBlock identity={identity} />}
          organisationSwitcher={organisationSwitcher}
          onOpenNav={() => setNavOpen(true)}
        />
        <ConnectionBanners />
        <main className="fb-content" id="main">
          {/* The older pages are built on `.page`; the new containers (fb-page-*) go inside it as screens are rebuilt. */}
          <div className="page">{children}</div>
        </main>
      </div>
      {session ? <SessionGuard initial={session} /> : null}
    </div>
  );
}

/** The authenticated app's frame: sidebar, top bar, banners, the page area, and the providers every screen relies on (data, toasts). */
export function AppShell(props: AppShellProps) {
  return (
    <ApiProvider>
      <ToastProvider>
        <Shell {...props} />
      </ToastProvider>
    </ApiProvider>
  );
}
