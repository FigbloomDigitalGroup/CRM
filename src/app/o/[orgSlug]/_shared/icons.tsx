/**
 * Small inline icon set for the sidebar -- kept as plain SVGs rather than
 * pulling in an icon library dependency for ~8 glyphs. All 18x18,
 * stroke-based, inherit color from their parent so the active/hover
 * states in globals.css apply without extra props.
 */
const base = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconDashboard() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconLeads() {
  return (
    <svg {...base}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16 8.5c1.4 0 2.5 1.2 2.5 2.7 0 1-.5 1.9-1.3 2.4" />
      <path d="M15.5 14.3c2.2.4 3.8 2.1 3.8 4.5" />
    </svg>
  );
}

export function IconDeals() {
  return (
    <svg {...base}>
      <path d="M3 12l4-6h10l4 6" />
      <path d="M3 12v6a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18v-6" />
      <path d="M9.5 12a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

export function IconTasks() {
  return (
    <svg {...base}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 12.2l2.3 2.3L16.3 8.5" />
    </svg>
  );
}

export function IconReports() {
  return (
    <svg {...base}>
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function IconCompanies() {
  return (
    <svg {...base}>
      <rect x="4" y="3" width="10" height="18" rx="1" />
      <path d="M14 8h6v13" />
      <path d="M7.5 7h.01M10.5 7h.01M7.5 10.5h.01M10.5 10.5h.01M7.5 14h.01M10.5 14h.01" />
      <path d="M17 12h.01M17 16h.01" />
    </svg>
  );
}

export function IconContacts() {
  return (
    <svg {...base}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="9" cy="10.5" r="2.2" />
      <path d="M5.5 17c.5-2 1.8-3 3.5-3s3 1 3.5 3" />
      <path d="M15.5 9h3.5M15.5 12.5h3.5" />
    </svg>
  );
}

export function IconLogout() {
  return (
    <svg {...base} width={15} height={15}>
      <path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
