"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { MobileFrame } from "../screens/mobile/MobileFrame";
import { PwaClient } from "../screens/mobile/PwaClient";
import { ToolsOverlays, ToolsTriggers } from "../screens/assistant/ToolsHost";
import { SavedViewsNav } from "../screens/views/SavedViewsNav";
import { OfflineBanner } from "../components/states";
import { ToastProvider } from "../components/toast";
import { connectivity, watchBrowserConnectivity } from "../data/connectivity";
import { ApiProvider, useApi } from "../data/hooks";
import { copy } from "../copy";
import { SessionGuard, type SessionTimes } from "./SessionGuard";
import { Sidebar } from "./Sidebar";
import { SidebarUser } from "./SidebarUser";
import { OrgIdentity, QuickCreate, TopBar, UserMenu, type IdentityInfo } from "./TopBar";
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
  initialSidebarCollapsed: boolean;
  session: SessionTimes | null;
  /** Server-rendered pieces the shell lays out: the global search box and the notification bell. */
  search: ReactNode;
  bell: ReactNode;
  /** The V1.1 organisation switcher. Left out in V1: the slot exists, nothing renders in it. */
  organisationSwitcher?: ReactNode;
  /** Platform messages above the page (support banner, announcements, approval card; FIG-1192). Left out in V1. */
  banners?: ReactNode;
  children: ReactNode;
}

function Shell({ orgSlug, sections, quickCreate, identity, initialSidebarCollapsed, session, search, bell, organisationSwitcher, banners, children }: AppShellProps) {
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
        footer={<SidebarUser name={identity.name} roleName={identity.roleName} />}
        extra={<SavedViewsNav onNavigate={() => setNavOpen(false)} />}
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
      />
      <div className="fb-main">
        <TopBar
          orgIdentity={<OrgIdentity identity={identity} switcher={organisationSwitcher} />}
          search={search}
          bell={bell}
          quickCreate={<QuickCreate orgSlug={orgSlug} items={quickCreate} />}
          userMenu={<UserMenu identity={identity} />}
          tools={<ToolsTriggers />}
          onOpenNav={() => setNavOpen(true)}
        />
        <ConnectionBanners />
        {banners}
        <main className="fb-content" id="main">
          {/* The older pages are built on `.page`; the new containers (fb-page-*) go inside it as screens are rebuilt. */}
          <div className="page">{children}</div>
        </main>
      </div>
      <ToolsOverlays />
      {session ? <SessionGuard initial={session} /> : null}
    </div>
  );
}

/** The authenticated app's frame: sidebar, top bar, banners, the page area, and the providers every screen relies on (data, toasts). */
export function AppShell(props: AppShellProps) {
  return (
    <ApiProvider>
      <ToastProvider>
        <ShellOrPhone {...props} />
        {/* The service worker, install offer, offline queue sender and the phone redirect (F4.12, FIG-791): signed-in app only. */}
        <PwaClient />
      </ToastProvider>
    </ApiProvider>
  );
}

/** Every route under /o/{org}/m has its own phone frame (M9, F4.10): the desktop sidebar and top bar are not drawn there. */
function ShellOrPhone(props: AppShellProps) {
  const pathname = usePathname() ?? "";
  const phoneRoot = `/o/${props.orgSlug}/m`;
  if (pathname === phoneRoot || pathname.startsWith(`${phoneRoot}/`)) {
    return (
      <>
        <MobileFrame identity={props.identity}>{props.children}</MobileFrame>
        {props.session ? <SessionGuard initial={props.session} /> : null}
      </>
    );
  }
  return <Shell {...props} />;
}
