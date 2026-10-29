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
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessagesSquare,
  Phone,
  Video,
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
import { filterNav, isActivePath, sectionBadge, sectionHasActive, type NavIcon, type NavItem, type NavSection } from "./navModel";

const ICONS: Record<NavIcon, ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  leads: <Users size={18} />,
  deals: <Briefcase size={18} />,
  tasks: <CheckSquare size={18} />,
  calendar: <Calendar size={18} />,
  companies: <Building2 size={18} />,
  contacts: <Contact size={18} />,
  conversations: <MessageSquare size={18} />,
  communication: <Phone size={18} />,
  mail: <Mail size={18} />,
  chat: <MessagesSquare size={18} />,
  video: <Video size={18} />,
  handoffs: <Package size={18} />,
  renewals: <RefreshCw size={18} />,
  payments: <Wallet size={18} />,
  reports: <ChartColumn size={18} />,
  preferences: <User size={18} />,
  settings: <Settings size={18} />,
};

export const SIDEBAR_DEVICE_KEY = "figbloom-sidebar-collapsed";
/** Which dropdown groups the person opened or closed on this device (F6.20): `{ communication: false }`. A group with no choice follows the current page. */
export const SIDEBAR_GROUPS_KEY = "figbloom-sidebar-groups";

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
  extra,
  mobileOpen,
  onMobileClose,
}: {
  orgSlug: string;
  sections: NavSection[];
  initialCollapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  footer?: ReactNode;
  /** Groups drawn from the browser after the role's own sections, such as Saved views (X4). Hidden while the filter box is in use. */
  extra?: ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const base = `/o/${orgSlug}`;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [query, setQuery] = useState("");
  const [groupChoice, setGroupChoice] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_DEVICE_KEY);
      if (stored === "1" || stored === "0") setCollapsed(stored === "1");
      const groups = JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) ?? "{}") as unknown;
      if (groups && typeof groups === "object") setGroupChoice(groups as Record<string, boolean>);
    } catch {
      // Storage blocked or unreadable: the account value stands and groups follow the page.
    }
  }, []);

  const toggleGroup = useCallback((key: string, open: boolean) => {
    setGroupChoice((prev) => {
      const next = { ...prev, [key]: open };
      try {
        localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Best-effort.
      }
      return next;
    });
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

  const renderLink = (item: NavItem, nested = false) => {
    const active = isActivePath(item, base, pathname);
    return (
      <a
        key={item.key}
        href={`${base}${item.path}`}
        className="fb-navlink"
        data-tint={item.tint}
        data-nested={nested && !collapsed ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        onClick={onMobileClose}
      >
        <span aria-hidden="true" className="fb-navlink__icon">{ICONS[item.icon]}</span>
        <span className="fb-sidebar__text">{item.label}</span>
        {item.badge ? (
          <span className="fb-navlink__badge fb-sidebar__text" aria-label={`${item.badge} need attention`}>
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </a>
    );
  };

  const renderSection = (s: NavSection) => {
    if (s.collapsible) {
      // A dropdown group (F6.20). It is open on the page it holds, while the filter box is in use, and always when the sidebar is collapsed to
      // icons (there is no room for a header then, so the links stand on their own). Otherwise the person's own choice stands.
      const active = sectionHasActive(s, base, pathname);
      const open = Boolean(query) || collapsed || (groupChoice[s.key] ?? active);
      const badge = sectionBadge(s);
      const panelId = `fb-navgroup-${s.key}`;
      return (
        <div key={s.key} className="fb-sidebar__section" data-group={s.key}>
          {collapsed ? null : (
            <button
              type="button"
              className="fb-navgroup"
              data-active={active && !open ? "true" : undefined}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggleGroup(s.key, !open)}
            >
              <span aria-hidden="true" className="fb-navlink__icon">{s.icon ? ICONS[s.icon] : null}</span>
              <span className="fb-sidebar__text">{s.label}</span>
              {badge && !open ? (
                <span className="fb-navlink__badge fb-sidebar__text" aria-label={`${badge} need attention`}>
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
              <ChevronDown size={16} aria-hidden="true" className="fb-navgroup__chev" data-open={open ? "true" : undefined} />
            </button>
          )}
          <div id={panelId} className="fb-navgroup__panel" hidden={!open}>
            {s.items.map((item) => renderLink(item, true))}
          </div>
        </div>
      );
    }
    return (
      <div key={s.key} className="fb-sidebar__section">
        <div className="fb-sidebar__label">{s.label}</div>
        {s.items.map((item) => renderLink(item))}
      </div>
    );
  };

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
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>
        <div className="fb-sidebar__filter">
          <Search size={15} aria-hidden="true" className="fb-sidebar__filtericon" />
          <input type="search" className="fb-input" placeholder="Search..." aria-label="Filter navigation" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <nav className="fb-sidebar__nav" aria-label="Main">
          {top.map(renderSection)}
          {query ? null : extra}
          {query && shown.length === 0 ? <p className="fb-sidebar__text" style={{ padding: "8px 10px", opacity: 0.8 }}>No matching pages.</p> : null}
        </nav>
        {bottom.length > 0 ? <div className="fb-sidebar__bottom">{bottom.map(renderSection)}</div> : null}
        {footer ? <div className="fb-sidebar__foot">{footer}</div> : null}
      </aside>
    </>
  );
}
