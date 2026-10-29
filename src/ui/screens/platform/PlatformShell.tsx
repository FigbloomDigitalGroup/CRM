"use client";

import { AlertTriangle, Bell, Building2, ChevronDown, Eye, FileText, History, Home, Layers, Moon, Search, Shield, SlidersHorizontal, Sun, Users, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";
import { DemoBadge } from "@/ui/demo/DemoBadge";
import { cx } from "./kit";
import { isPending, searchOrgs } from "./logic";
import { usePlatformTheme } from "./PlatformRoot";
import { usePlatform } from "./store";

export interface PlatformIdentityView {
  name: string;
  email: string;
}

interface NavDef {
  path: string;
  label: string;
  icon: LucideIcon;
  v2?: boolean;
  badge?: "requests";
}

const NAV: NavDef[] = [
  { path: "/platform", label: "Home", icon: Home },
  { path: "/platform/organisations", label: "Organisations", icon: Building2 },
  { path: "/platform/data-requests", label: "Data requests", icon: FileText, badge: "requests" },
  { path: "/platform/support-access", label: "Support access", icon: Eye },
  { path: "/platform/health", label: "Health", icon: Zap },
  { path: "/platform/audit", label: "Audit log", icon: History },
  { path: "/platform/admins", label: "Platform admins", icon: Users },
  { path: "/platform/security", label: "Security", icon: Shield },
  { path: "/platform/flags", label: "Flags and limits", icon: SlidersHorizontal, v2: true },
  { path: "/platform/announcements", label: "Announcements", icon: Bell, v2: true },
];

/** Pages a phone shows as the platform mobile app (PLM) instead of the desktop console. */
const MOBILE_OF: Record<string, string> = { "/platform": "/platform/m", "/platform/health": "/platform/m/health", "/platform/data-requests": "/platform/m/approvals" };

function isCurrent(pathname: string, path: string) {
  return path === "/platform" ? pathname === "/platform" : pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The Platform console frame (PL1, TB6): separate from the tenant app on purpose. A purple bar says "Platform console" and the environment, the
 * navigation has no tenant links, and the account menu says the admin holds no organisation role. Search finds organisation names only.
 */
export function PlatformShell({ identity, signOut, children }: { identity: PlatformIdentityView; signOut: ReactNode; children: ReactNode }) {
  const pathname = usePathname() ?? "/platform";
  const router = useRouter();
  const { state, dispatch } = usePlatform();
  const { theme, toggle } = usePlatformTheme();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A phone gets the platform mobile screens (PLM) for the three pages they cover.
  useEffect(() => {
    const target = MOBILE_OF[pathname];
    if (target && typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches) router.replace(target);
  }, [pathname, router]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const pendingRequests = state.requests.filter(isPending).length;
  const hits = searchOrgs(state.orgs, q);
  const initial = identity.name.replace("Dev ", "").slice(0, 1).toUpperCase();

  return (
    <div className="fb-pl-body" data-fb-shell="platform">
      <aside className="fb-pl-side" aria-label="Platform navigation">
        <div className="fb-pl-brand">
          <BrandMark className="fb-pl-brand-mark" />
          <div>
            <div className="fb-pl-brand-name">
              Figbloom <span>CRM</span>
            </div>
            <div className="fb-pl-brand-sub">PLATFORM</div>
          </div>
        </div>
        <nav className="fb-pl-nav">
          {NAV.filter((n) => !n.v2 || state.release === "v2").map((n) => {
            const Icon = n.icon;
            const count = n.badge === "requests" ? pendingRequests : 0;
            return (
              <Link key={n.path} href={n.path} className="fb-pl-nav-link" aria-current={isCurrent(pathname, n.path) ? "page" : undefined}>
                <span className="fb-pl-nav-ic">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className="fb-pl-nav-label">{n.label}</span>
                {count ? <span className="fb-pl-nav-badge" aria-label={`${count} waiting`}>{count}</span> : null}
                {n.v2 ? <span className="fb-pl-nav-v2">V2</span> : null}
              </Link>
            );
          })}
        </nav>
        <label className="fb-pl-demo-release">
          <DemoBadge>Demo</DemoBadge>
          <span className="fb-pl-sr">Release shown</span>
          <select aria-label="Release shown in the console" value={state.release} onChange={(e) => dispatch({ type: "release", value: e.target.value === "v2" ? "v2" : "v11" })}>
            <option value="v11">V1.1</option>
            <option value="v2">V2</option>
          </select>
        </label>
        <div className="fb-pl-side-note">
          <Shield size={13} aria-hidden="true" /> Platform admins hold no organisation role and see no customer records by default.
        </div>
      </aside>

      <div className="fb-pl-col">
        <header className="fb-pl-top" data-screen-label="TB6 Platform top bar">
          <span className="fb-pl-top-badge">
            <Layers size={14} aria-hidden="true" />
            Platform console
          </span>
          <span className="fb-pl-top-env">PRODUCTION · v1.1.3</span>
          <div className="fb-pl-search">
            <span className="fb-pl-search-ic">
              <Search size={16} aria-hidden="true" />
            </span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an organisation" aria-label="Search organisations" />
            {q ? (
              <div className="fb-pl-search-pop">
                {hits.map((o) => (
                  <Link key={o.id} href={`/platform/organisations/${o.id}`} className="fb-pl-search-hit" onClick={() => setQ("")}>
                    <Building2 size={15} aria-hidden="true" />
                    <span style={{ flex: 1, fontWeight: 600 }}>{o.name}</span>
                    <span className="fb-pl-muted fb-pl-small">{o.status}</span>
                  </Link>
                ))}
                {!hits.length ? <div className="fb-pl-muted" style={{ padding: 10, fontSize: 13 }}>No organisation matches. Search covers organisation names only.</div> : null}
              </div>
            ) : null}
          </div>
          <span className="fb-pl-spacer" />
          <button type="button" className="fb-pl-round" aria-label="Toggle dark mode" onClick={toggle}>
            {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
          </button>
          <div ref={menuRef} style={{ position: "static" }}>
            <button type="button" className="fb-pl-ident" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span className="fb-pl-ident-av" aria-hidden="true">{initial}</span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{identity.name}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {menu ? (
              <div className="fb-pl-menu" role="menu">
                <div className="fb-pl-menu-head">
                  <div style={{ fontWeight: 700 }}>{identity.name}</div>
                  <div className="fb-pl-muted fb-pl-small">{identity.email}</div>
                  <div className="fb-pl-pill fb-pl-pill--soft" style={{ marginTop: 6, background: "var(--pl-purple-soft)", color: "var(--pl-purple)", fontSize: 11.5 }}>
                    Platform · no organisation role
                  </div>
                </div>
                <Link href="/platform/preferences" role="menuitem" className="fb-pl-menu-item" onClick={() => setMenu(false)}>
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  Preferences
                </Link>
                {signOut}
              </div>
            ) : null}
          </div>
        </header>
        <div className="fb-pl-devstrip" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          Dev only: verification skipped. Real platform sign-in always asks for a code.
        </div>
        <main className={cx("fb-pl-main")}>
          <div className="fb-pl-page">{children}</div>
        </main>
      </div>
    </div>
  );
}
