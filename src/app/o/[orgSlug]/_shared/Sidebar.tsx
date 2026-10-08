"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";
import {
  IconChevronsLeft,
  IconCompanies,
  IconContacts,
  IconDashboard,
  IconDeals,
  IconLeads,
  IconReports,
  IconSearch,
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
  const [query, setQuery] = useState("");

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

  const overview: NavLink[] = [
    { href: base, label: "Dashboard", icon: <IconDashboard />, visible: true, exact: true },
    { href: `${base}/reports`, label: "Reports", icon: <IconReports />, visible: canViewReports },
  ];

  const salesWorkspace: NavLink[] = [
    { href: `${base}/leads`, label: "Leads", icon: <IconLeads />, visible: canViewLeads },
    { href: `${base}/deals`, label: "Deals", icon: <IconDeals />, visible: canViewDeals },
    { href: `${base}/tasks`, label: "Tasks", icon: <IconTasks />, visible: canViewTasks },
  ];

  const customers: NavLink[] = [
    { href: `${base}/companies`, label: "Companies", icon: <IconCompanies />, visible: canViewCompanies },
    { href: `${base}/contacts`, label: "Contacts", icon: <IconContacts />, visible: canViewContacts },
  ];

  const administration: NavLink[] = [
    { href: `${base}/settings`, label: "Settings", icon: <IconSettings />, visible: canManageSettings },
  ];

  function isActive(link: NavLink) {
    if (link.exact) return pathname === link.href;
    return pathname === link.href || pathname?.startsWith(`${link.href}/`);
  }

  const normalizedQuery = query.trim().toLowerCase();
  function matchesSearch(link: NavLink) {
    return link.visible && (normalizedQuery === "" || link.label.toLowerCase().includes(normalizedQuery));
  }

  const visibleOverview = overview.filter(matchesSearch);
  const visibleSalesWorkspace = salesWorkspace.filter(matchesSearch);
  const visibleCustomers = customers.filter(matchesSearch);
  const visibleAdministration = administration.filter(matchesSearch);

  function renderLinks(links: NavLink[]) {
    return links.map((l) => (
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
        <BrandMark className="brand-mark" />
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
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

      <div className="sidebar-search">
        <IconSearch />
        <input
          type="search"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search navigation"
        />
      </div>

      <nav className="sidebar-nav">
        {visibleOverview.length > 0 && (
          <div className="sidebar-section sidebar-section-overview">
            <div className="sidebar-section-label">Overview</div>
            {renderLinks(visibleOverview)}
          </div>
        )}
        {visibleSalesWorkspace.length > 0 && (
          <div className="sidebar-section sidebar-section-workspace">
            <div className="sidebar-section-label">Sales Workspace</div>
            {renderLinks(visibleSalesWorkspace)}
          </div>
        )}
        {visibleCustomers.length > 0 && (
          <div className="sidebar-section sidebar-section-customers">
            <div className="sidebar-section-label">Customers</div>
            {renderLinks(visibleCustomers)}
          </div>
        )}
        {normalizedQuery !== "" &&
          visibleOverview.length === 0 &&
          visibleSalesWorkspace.length === 0 &&
          visibleCustomers.length === 0 &&
          visibleAdministration.length === 0 && (
            <p className="sidebar-search-empty">No matching pages.</p>
          )}
      </nav>

      {visibleAdministration.length > 0 && (
        <div className="sidebar-bottom">
          <div className="sidebar-section sidebar-section-administration">
            <div className="sidebar-section-label">Administration</div>
            {renderLinks(visibleAdministration)}
          </div>
        </div>
      )}

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
