"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  IconCompanies,
  IconContacts,
  IconDashboard,
  IconDeals,
  IconLeads,
  IconReports,
  IconTasks,
} from "./icons";

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
  logoutButton: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/o/${orgSlug}`;

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
          className={`sidebar-link${isActive(l) ? " active" : ""}`}
        >
          {l.icon}
          {l.label}
        </a>
      ));
  }

  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Image src="/figbloom-logo.jpg" alt="" width={32} height={32} priority />
        <div>
          <div className="sidebar-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
          <div className="sidebar-brand-sub">Digital Group</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <div className="sidebar-section-label">Workspace</div>
          {renderLinks(workspace)}
        </div>
        {(canViewCompanies || canViewContacts) && (
          <div className="sidebar-section">
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
