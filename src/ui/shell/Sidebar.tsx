"use client";

import {
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  Contact,
  LayoutDashboard,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Users,
  User,
  Wallet,
  ChartColumn,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";
import { cx } from "../internal";
import { filterNav, isActivePath, type NavIcon, type NavSection } from "./navModel";

const ICONS: Record<NavIcon, ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  leads: <Users size={18} />,
  deals: <Briefcase size={18} />,
  tasks: <CheckSquare size={18} />,
  calendar: <Calendar size={18} />,
  companies: <Building2 size={18} />,
  contacts: <Contact size={18} />,
  conversations: <MessageSquare size={18} />,
  handoffs: <Package size={18} />,
  renewals: <RefreshCw size={18} />,
  payments: <Wallet size={18} />,
  reports: <ChartColumn size={18} />,
  preferences: <User size={18} />,
  settings: <Settings size={18} />,
};

export const SIDEBAR_DEVICE_KEY = "figbloom-sidebar-collapsed";

/**
 * The role-aware sidebar (F1.03). The sections arrive already filtered by what the person's permissions allow; this component only draws
 * them, filters them by the box at the top, and remembers whether it is collapsed. Collapse is saved to the account (so it follows the person)
 * through `onCollapsedChange`, and mirrored on this device so it applies before the page has loaded anything (device and account agree
 * on a single device; on a second device the account value is the starting point).
 */
export function Sidebar({
  orgSlug,
  sections,
  initialCollapsed,
  onCollapsedChange,
  footer,
  mobileOpen,
  onMobileClose,
}: {
  orgSlug: string;
  sections: NavSection[];
  initialCollapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  footer?: ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const base = `/o/${orgSlug}`;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_DEVICE_KEY);
      if (stored === "1" || stored === "0") setCollapsed(stored === "1");
    } catch {
      // Storage blocked: the account value stands.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_DEVICE_KEY, next ? "1" : "0");
      } catch {
        // Best-effort.
      }
      onCollapsedChange?.(next);
      return next;
    });
  }, [onCollapsedChange]);

  const shown = filterNav(sections, query);
  const top = shown.filter((s) => !s.bottom);
  const bottom = shown.filter((s) => s.bottom);

  const renderSection = (s: NavSection) => (
    <div key={s.key} className="fb-sidebar__section">
      <div className="fb-sidebar__label">{s.label}</div>
      {s.items.map((item) => {
        const active = isActivePath(item, base, pathname);
        return (
          <a
            key={item.key}
            href={`${base}${item.path}`}
            className="fb-navlink"
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            onClick={onMobileClose}
          >
            <span aria-hidden="true" style={{ display: "flex" }}>{ICONS[item.icon]}</span>
            <span className="fb-sidebar__text">{item.label}</span>
            {item.badge ? (
              <span className="fb-navlink__badge fb-sidebar__text" aria-label={`${item.badge} need attention`}>
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </a>
        );
      })}
    </div>
  );

  return (
    <>
      {mobileOpen ? <div className="fb-overlay" style={{ zIndex: 45 }} onClick={onMobileClose} aria-hidden="true" /> : null}
      <aside className={cx("fb-sidebar")} data-collapsed={collapsed ? "true" : "false"} data-open={mobileOpen ? "true" : undefined} aria-label="Sidebar">
        <div className="fb-sidebar__brand">
          <BrandMark className="brand-mark" />
          <span className="fb-sidebar__brandtext">
            Figbloom<span className="fb-accent"> CRM</span>
          </span>
          <button type="button" className="fb-iconbtn fb-sidebar__toggle" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={toggle}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="fb-sidebar__filter">
          <input type="search" className="fb-input" placeholder="Filter pages" aria-label="Filter navigation" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <nav className="fb-sidebar__nav" aria-label="Main">
          {top.map(renderSection)}
          {query && shown.length === 0 ? <p className="fb-sidebar__text" style={{ padding: "8px 10px", opacity: 0.8 }}>No matching pages.</p> : null}
        </nav>
        {bottom.length > 0 ? <div style={{ padding: "0 8px 8px" }}>{bottom.map(renderSection)}</div> : null}
        {footer ? <div className="fb-sidebar__foot">{footer}</div> : null}
      </aside>
    </>
  );
}
