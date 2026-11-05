/**
 * Help centre copy (X3, FIG-1172): tips by page, what's new and the keyboard shortcuts, from the design's help panel. Static text, not demo data.
 * Wording lives here so it can be translated with the rest of the copy.
 */

export const TIPS: Record<string, { title: string; tips: string[] }> = {
  home: { title: "Home", tips: ["Use the search bar to find any record you can access.", "Press ? for keyboard shortcuts."] },
  leads: { title: "Leads", tips: ["Only the name is required. Qualify later.", "Duplicates warn you, they never block saving.", "Use Saved views to keep your favourite filters one click away."] },
  deals: { title: "Deals", tips: ["Drag cards between stages, or use Move to… on touch screens.", "Deal values show only to roles that may see them. Hidden values are marked, not blank."] },
  tasks: { title: "Tasks", tips: ["Every task links to a lead, deal, company or contact.", "Overdue tasks appear first on your home page."] },
  companies: { title: "Companies", tips: ["Open a company for its full history: contacts, deals, services and payments you may see."] },
  contacts: { title: "Contacts", tips: ["Tap Call or WhatsApp on a contact, then say how it went when you come back. The note is saved on their history."] },
  handoffs: { title: "Handoffs", tips: ["When a deal is won, the handoff passes the customer to Delivery. Delivery sees what to deliver, never the price or margin."] },
  renewals: { title: "Renewals", tips: ["Renewals lists customers who are due soon or have lapsed. Reminders create tasks. They never change a customer for you."] },
  payments: { title: "Payments", tips: ["Payments is for Finance and Management only. Nothing is processed here: it records invoices and money received.", "A payment you reverse stays on the record, struck through, with the reason."] },
  preferences: { title: "Preferences", tips: ["Your look, notifications and sign-in history are yours. If your organisation locks the look, the control says why."] },
  reports: { title: "Reports", tips: ["Reports follow your role. Without organisation reports you see My metrics."] },
  settings: { title: "Settings", tips: ["Changes are recorded in the audit log.", "Each editor says what a change affects before you save."] },
};

export function tipsFor(pathname: string, orgSlug: string): { title: string; tips: string[] } {
  const rest = pathname.replace(`/o/${orgSlug}`, "").split("/").filter(Boolean)[0] ?? "";
  const key = rest === "" ? "home" : rest === "calendar" ? "tasks" : rest;
  return TIPS[key] ?? TIPS.home!;
}

export interface NewsItem {
  tag: "V1" | "V1.1" | "V2";
  title: string;
  detail: string;
}

export const NEWS: NewsItem[] = [
  { tag: "V1.1", title: "Ask Figbloom and Ctrl/Cmd+K", detail: "Find anything and draft follow-ups. You confirm every action." },
  { tag: "V1.1", title: "Saved views in the sidebar", detail: "Keep a filter one click away, for yourself or shared with the team." },
  { tag: "V1.1", title: "Your own colours", detail: "Pick your own sidebar, accent and highlight. We check every colour is readable." },
  { tag: "V1.1", title: "Photos and business cards from your phone", detail: "Attach photos on site and scan a card into a new contact. Check the fields before saving." },
  { tag: "V1", title: "Attachments, tags and custom fields", detail: "On every lead, deal, company and contact." },
];

export const SHORTCUTS: { label: string; keys: string }[] = [
  { label: "Command palette", keys: "Ctrl/Cmd K" },
  { label: "New lead", keys: "N" },
  { label: "Go to leads, deals, tasks", keys: "G L · G D · G T" },
  { label: "Go to companies, reports", keys: "G C · G R" },
  { label: "Go home", keys: "G H" },
  { label: "Help", keys: "?" },
  { label: "Close any panel", keys: "Esc" },
];
