import type { CatalogueItem, QuoteDoc } from "../quoteMath";

/**
 * Demo data for the commercial screens (FIG-1168 to FIG-1170, M10). Sample records from the approved design's prototype store
 * (design-spec/crm-store.js); nothing here is a real record. Wiring to the real API (M13/M14) replaces this folder.
 */

export const DEMO_NOW = "2026-10-29T09:00:00+03:00";

export const catalogue: CatalogueItem[] = [
  { id: "cat1", name: "CCTV camera (4MP dome), installed", unit: "camera", price: 18500, cost: 11000 },
  { id: "cat2", name: "NVR 16-channel recorder", unit: "unit", price: 65000, cost: 42000 },
  { id: "cat3", name: "Starlink kit and installation", unit: "site", price: 95000, cost: 72000 },
  { id: "cat4", name: "Website design and build", unit: "project", price: 180000, cost: 90000 },
  { id: "cat5", name: "Social media management", unit: "month", price: 45000, cost: 22000 },
  { id: "cat6", name: "Support retainer", unit: "month", price: 25000, cost: 9000 },
];

export interface DemoDeal {
  id: string;
  company: string;
  title: string;
  contact: string;
  stage: "Solution Presented" | "Proposal Sent" | "Negotiation" | "Closed Won";
  owner: string;
  close: string;
  value: number;
  /** An override of the stage probability, shown as such. */
  prob?: number;
  wonAt?: string;
}

export const deals: DemoDeal[] = [
  { id: "d1", company: "Kijani Foods Ltd", title: "Cold-room monitoring and CCTV", contact: "Amara Osei, Operations Manager", stage: "Proposal Sent", owner: "Dev Sales", close: "2026-10-31", value: 420000 },
  { id: "d2", company: "Savannah Logistics", title: "Fleet tracking, 24 vehicles", contact: "Peter Ochieng, Director", stage: "Negotiation", owner: "Dev Sales Two", close: "2026-11-12", value: 760000, prob: 0.6 },
  { id: "d3", company: "Mwangaza Schools", title: "Campus CCTV and Starlink", contact: "Grace Wanjiru, Bursar", stage: "Solution Presented", owner: "Dev Sales", close: "2026-11-20", value: 540000 },
  { id: "d4", company: "Pwani Hotels", title: "Website rebuild and social media", contact: "Hassan Ali, Marketing Lead", stage: "Proposal Sent", owner: "Dev Sales Two", close: "2026-10-22", value: 360000 },
  { id: "d5", company: "Nyota Pharmacy", title: "Support retainer, 12 months", contact: "Lucy Kamau, Owner", stage: "Negotiation", owner: "Dev Management", close: "2026-12-05", value: 300000 },
  { id: "d6", company: "Baraka Printers", title: "Starlink for two sites", contact: "Joseph Mutua, Manager", stage: "Solution Presented", owner: "Dev Sales", close: "2027-01-14", value: 190000 },
  { id: "d7", company: "Ukweli Media", title: "Social media management", contact: "Zawadi Njeri, Editor", stage: "Closed Won", owner: "Dev Sales", close: "2026-10-09", value: 540000, wonAt: "2026-10-09" },
  { id: "d8", company: "Safari Tents Co", title: "Website design and build", contact: "Brian Kiptoo, Owner", stage: "Closed Won", owner: "Dev Sales Two", close: "2026-10-16", value: 420000, wonAt: "2026-10-16" },
  { id: "d9", company: "Hazina SACCO", title: "CCTV, 8 branches", contact: "Esther Wafula, CEO", stage: "Closed Won", owner: "Dev Management", close: "2026-10-03", value: 280000, wonAt: "2026-10-03" },
];

export const STAGE_PROBABILITY: Record<string, number> = { "Solution Presented": 0.25, "Proposal Sent": 0.5, Negotiation: 0.75 };

export const targets: Record<string, number> = { "Dev Sales": 1_500_000, "Dev Sales Two": 1_200_000, "Dev Management": 500_000 };

export const seedQuotes: QuoteDoc[] = [
  {
    id: "q1",
    dealId: "d3",
    no: "Q-2026-032",
    version: 2,
    status: "Pending approval",
    lines: [
      { cat: "cat1", qty: 12 },
      { cat: "cat2", qty: 1 },
      { cat: "cat3", qty: 1 },
    ],
    discount: 8,
    validUntil: "2026-11-28",
    terms: "50% deposit, balance on delivery. Prices include 16% VAT.",
    history: [
      { v: 1, by: "Dev Sales", at: "2026-10-22T10:10:00+03:00", note: "Draft created for Campus CCTV and Starlink" },
      { v: 1, by: "Dev Sales", at: "2026-10-23T15:02:00+03:00", note: "Sent to Grace Wanjiru by email" },
      { v: 2, by: "Dev Sales", at: "2026-10-27T11:30:00+03:00", note: "New version from v1" },
      { v: 2, by: "Dev Sales", at: "2026-10-28T08:45:00+03:00", note: "8% discount · sent for approval" },
    ],
  },
  {
    id: "q2",
    dealId: "d1",
    no: "Q-2026-030",
    version: 1,
    status: "Sent",
    lines: [
      { cat: "cat1", qty: 8 },
      { cat: "cat2", qty: 1 },
    ],
    discount: 0,
    validUntil: "2026-11-15",
    terms: "50% deposit, balance on delivery. Prices include 16% VAT.",
    history: [
      { v: 1, by: "Dev Sales", at: "2026-10-24T09:00:00+03:00", note: "Draft created for Cold-room monitoring and CCTV" },
      { v: 1, by: "Dev Sales", at: "2026-10-25T14:20:00+03:00", note: "Sent to Amara Osei with a signing link" },
    ],
  },
];

export type ApprovalKind = "Discount" | "Export" | "Deletion" | "Large deal";
export interface DemoApproval {
  id: string;
  kind: ApprovalKind;
  target: string;
  detail: string;
  by: string;
  at: string;
  status: "Pending" | "Approved" | "Declined";
  reason?: string;
  /** Deal id when the request belongs to a quote. */
  quoteDealId?: string;
}

export const seedApprovals: DemoApproval[] = [
  { id: "ap1", kind: "Discount", target: "Mwangaza Schools · Q-2026-032 v2", detail: "8% discount. Rule: above 5% needs Management.", by: "Dev Sales", at: "2026-10-28T08:45:00+03:00", status: "Pending", quoteDealId: "d3" },
  { id: "ap2", kind: "Export", target: "Leads export · 1,240 rows", detail: "CSV export larger than 500 rows. Rule: needs Management.", by: "Dev Sales Two", at: "2026-10-29T07:15:00+03:00", status: "Pending" },
  { id: "ap3", kind: "Large deal", target: "Nyota Pharmacy · mark won", detail: "Deal worth KES 1,200,000 with the bundled retainer is above the KES 1,000,000 rule.", by: "Dev Management", at: "2026-10-27T16:40:00+03:00", status: "Pending" },
  { id: "ap4", kind: "Deletion", target: "Contact · Peter Ochieng", detail: "Data-protection request: permanent deletion.", by: "Dev Management", at: "2026-10-20T10:00:00+03:00", status: "Approved", reason: "Identity checked by phone." },
  { id: "ap5", kind: "Discount", target: "Pwani Hotels · Q-2026-027 v1", detail: "12% discount. Rule: above 5% needs Management.", by: "Dev Sales Two", at: "2026-10-18T13:10:00+03:00", status: "Declined", reason: "Too deep for a first order. Try 7%." },
];
