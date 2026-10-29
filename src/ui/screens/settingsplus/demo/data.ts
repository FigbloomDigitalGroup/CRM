import type { Access, ApprovalRule, FieldRow, FormField, RoleKey, StageRule } from "../model";

/**
 * Demo data for the commercial and developer settings (FIG-1174, FIG-1194, M10): sample rows from the approved design's prototype store.
 * Nothing here is a real setting. Wiring to the real API (B6.10, B6.13, B6.15, B6.18, B6.19, B7.06) replaces this folder.
 */

export const pipelines = [
  { name: "Digital services", isDefault: true, services: "Web, branding, social, HR, inventory, property management", stages: [["Lead in", "10%"], ["Solution Presented", "25%"], ["Proposal Sent", "50%"], ["Negotiation", "75%"], ["Closed Won", "100%"], ["Closed Lost", "0%"]] as [string, string][] },
  { name: "Installations", isDefault: false, services: "CCTV, Starlink / Internet, Fleet / GPS", stages: [["Site survey", "15%"], ["Solution Presented", "25%"], ["Proposal Sent", "50%"], ["Negotiation", "75%"], ["Closed Won", "100%"], ["Closed Lost", "0%"]] as [string, string][] },
];

export const stageRules: StageRule[] = [
  { key: "proposal", label: "Proposal Sent needs a quote or proposal", detail: "Stops the move until one is attached.", on: true },
  { key: "won", label: "Closed Won needs a signed quote (V2)", detail: "Only when e-signature is in use.", on: false },
  { key: "lostReason", label: "Closed Lost needs a reason", detail: "Always on. Keeps the lost-reasons report honest.", on: true, locked: true },
];

/** Open deals each rule would newly apply to, for the impact message. */
export const dealsPastRule = { proposal: 2, won: 3, lostReason: 0 } as const;

export interface DemoSequence {
  id: string;
  name: string;
  active: number;
  on: boolean;
  steps: string[];
}
export const sequences: DemoSequence[] = [
  { id: "cd1", name: "Website lead", active: 4, on: true, steps: ["Day 0 · WhatsApp intro (prepared for you)", "Day 2 · Call task", "Day 5 · Email: services overview", "Day 10 · Check-in task"] },
  { id: "cd2", name: "Referral", active: 1, on: true, steps: ["Day 0 · Call task", "Day 1 · Email: thank you and deck", "Day 7 · Meeting task"] },
];

export const formFields: FormField[] = [
  { key: "name", label: "Full name", note: "Always on", locked: true, on: true },
  { key: "email", label: "Email", note: "Always on", locked: true, on: true },
  { key: "phone", label: "Phone", note: "", on: true },
  { key: "company", label: "Company", note: "", on: true },
  { key: "service", label: "Service interest", note: "Routes to the right owner", on: true },
  { key: "budget", label: "Budget range", note: "", on: false },
  { key: "message", label: "Message", note: "", on: true },
];

export const approvalRules: ApprovalRule[] = [
  { key: "discount", label: "Discount on a quote above", unit: "%", on: true, threshold: 5 },
  { key: "export", label: "CSV export larger than", unit: "rows", on: true, threshold: 500 },
  { key: "deal", label: "Marking won a deal worth more than", unit: "KES", on: true, threshold: 1_000_000 },
  { key: "deletion", label: "Permanent deletion of a contact (data-protection request)", unit: "any", on: true, threshold: 0 },
];

const r = (management: Access, sales: Access, delivery: Access, finance: Access, technical: Access, support: Access): Record<RoleKey, Access> => ({ management, sales, delivery, finance, technical, support });

export const fieldRows: FieldRow[] = [
  { key: "deals.values", label: "Deal value", access: r("Edit", "Own", "Hidden", "View", "Hidden", "Hidden") },
  { key: "deals.margin", label: "Cost and margin", access: r("View", "Hidden", "Hidden", "Hidden", "Hidden", "Hidden") },
  { key: "contact.phone", label: "Contact phone and WhatsApp", access: r("Edit", "Edit", "View", "View", "Hidden", "View") },
  { key: "payments.status", label: "Invoice and payment status", access: r("View", "Hidden", "Hidden", "Edit", "Hidden", "Hidden") },
  { key: "leads.export", label: "Export leads", access: r("Edit", "Hidden", "Hidden", "Hidden", "Hidden", "Hidden") },
  { key: "attachments.contract", label: "Signed contracts", access: r("Edit", "Own", "View", "View", "Hidden", "Hidden") },
  { key: "tickets.manage", label: "Support tickets", access: r("Edit", "Hidden", "View", "Hidden", "Hidden", "Edit") },
];

/** Members per role, for "this affects N people". */
export const membersPerRole: Record<RoleKey, number> = { management: 2, sales: 4, delivery: 3, finance: 1, technical: 2, support: 0 };

/** What the effect preview shows for each field (the sample record a person would open). */
export const sampleValues: Record<string, string> = {
  "deals.values": "KES 540,000",
  "deals.margin": "42%",
  "contact.phone": "+254 722 000 111",
  "payments.status": "Deposit paid · balance due 30 Nov",
  "leads.export": "Export CSV",
  "attachments.contract": "Signed contract.pdf",
  "tickets.manage": "Ticket #214 · camera offline",
};

export interface DemoToken {
  id: string;
  name: string;
  scopes: string[];
  used: string;
  mask: string;
}
export const tokens: DemoToken[] = [
  { id: "tk1", name: "Website (figbloom.co.ke)", scopes: ["leads:create"], used: "today 09:40", mask: "fbk_live_••••Zc6" },
  { id: "tk2", name: "Accounting sync", scopes: ["deals:read", "payments:write"], used: "2 days ago", mask: "fbk_live_••••p1Q" },
];

export interface DemoWebhook {
  id: string;
  url: string;
  events: string[];
  ok: boolean;
  last: string;
}
export const webhooks: DemoWebhook[] = [
  { id: "wh1", url: "https://figbloom.co.ke/hooks/crm", events: ["deal.won", "lead.created"], ok: true, last: "200 OK · 3 min ago" },
  { id: "wh2", url: "https://hooks.slack.com/…/sales", events: ["deal.won"], ok: true, last: "200 OK · yesterday" },
  { id: "wh3", url: "https://pms.example.co.ke/in", events: ["company.lifecycle_changed"], ok: false, last: "503 · retrying (3 of 5)" },
];

export interface DemoDelivery {
  id: string;
  hookId: string;
  event: string;
  status: string;
  attempts: number;
  next: string;
  at: string;
}
export const deliveries: DemoDelivery[] = [
  { id: "dl3", hookId: "wh3", event: "company.lifecycle_changed", status: "503 Service Unavailable", attempts: 3, next: "in 20 min", at: "today 08:12" },
  { id: "dl2", hookId: "wh1", event: "deal.won", status: "200 OK", attempts: 1, next: "—", at: "today 09:37" },
  { id: "dl1", hookId: "wh3", event: "company.lifecycle_changed", status: "503 Service Unavailable", attempts: 5, next: "gave up", at: "yesterday 17:02" },
];

export const EVENTS = ["lead.created", "lead.assigned", "lead.converted", "deal.stage_changed", "deal.won", "deal.lost", "company.lifecycle_changed", "payment.recorded"] as const;
