"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconChevronsLeft,
  IconCompanies,
  IconContacts,
  IconDashboard,
  IconDeals,
  IconLeads,
  IconReports,
  IconSettings,
  IconTasks,
} from "./icons";

const COLLAPSE_STORAGE_KEY = "figbloom-sidebar-collapsed";

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
  visible: boolean;
  /** Exact match only (the dashboard root would otherwise match every page). */
  exact?: boolean;
}

export function Sidebar({
  orgSlug,
  userName,
  roleName,
  canViewLeads,
  canViewDeals,
  canViewTasks,
  canViewReports,
  canViewCompanies,
  canViewContacts,
  canManageSettings,
  logoutButton,
}: {
  orgSlug: string;
  userName: string;
  roleName: string;
  canViewLeads: boolean;
  canViewDeals: boolean;
  canViewTasks: boolean;
  canViewReports: boolean;
  canViewCompanies: boolean;
  canViewContacts: boolean;
  canManageSettings: boolean;
  logoutButton: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/o/${orgSlug}`;

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // localStorage unavailable (private browsing, etc.) -- default to expanded.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Best-effort persistence only.
      }
      return next;
    });
  }

  const workspace: NavLink[] = [
    { href: base, label: "Dashboard", icon: <IconDashboard />, visible: true, exact: true },
    { href: `${base}/leads`, label: "Leads", icon: <IconLeads />, visible: canViewLeads },
    { href: `${base}/deals`, label: "Deals", icon: <IconDeals />, visible: canViewDeals },
    { href: `${base}/tasks`, label: "Tasks", icon: <IconTasks />, visible: canViewTasks },
    { href: `${base}/reports`, label: "Reports", icon: <IconReports />, visible: canViewReports },
  ];

  const manage: NavLink[] = [
    { href: `${base}/companies`, label: "Companies", icon: <IconCompanies />, visible: canViewCompanies },
    { href: `${base}/contacts`, label: "Contacts", icon: <IconContacts />, visible: canViewContacts },
    { href: `${base}/settings`, label: "Settings", icon: <IconSettings />, visible: canManageSettings },
  ];

  function isActive(link: NavLink) {
    if (link.exact) return pathname === link.href;
    return pathname === link.href || pathname?.startsWith(`${link.href}/`);
  }

  function renderLinks(links: NavLink[]) {
    return links
      .filter((l) => l.visible)
      .map((l) => (
        <a
          key={l.href}
          href={l.href}
          title={l.label}
          className={`sidebar-link${isActive(l) ? " active" : ""}`}
        >
          {l.icon}
          <span className="sidebar-link-label">{l.label}</span>
        </a>
      ));
  }

  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-brand">
        <Image src="/figbloom-logo.jpg" alt="" width={32} height={32} priority />
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
          <div className="sidebar-brand-sub">Digital Group</div>
        </div>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IconChevronsLeft />
        </button>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section sidebar-section-workspace">
          <div className="sidebar-section-label">Workspace</div>
          {renderLinks(workspace)}
        </div>
        {(canViewCompanies || canViewContacts || canManageSettings) && (
          <div className="sidebar-section sidebar-section-manage">
            <div className="sidebar-section-label">Manage</div>
            {renderLinks(manage)}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-avatar">{initial}</div>
        <div className="sidebar-footer-info">
          <div className="sidebar-footer-name">{userName}</div>
          <div className="sidebar-footer-role">{roleName}</div>
        </div>
        {logoutButton}
      </div>
    </aside>
  );
}
