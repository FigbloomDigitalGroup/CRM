import type { Page } from "@playwright/test";
import { ORG_SLUG } from "../helpers";

/**
 * Q1.01 to Q1.03: the screens and roles the QA suites walk. One list, so the journeys, the accessibility sweep and the visual baselines all
 * cover the same V1 screens. `ids` are the design's Screen Checklist IDs (design-spec/TRACEABILITY.md); `e2e/qa/trace.ts` maps every V1 ID to the
 * spec that exercises it, and `tests/e2eTraceability.test.ts` fails when an ID has no passing journey file.
 */

export const ROLES = [
  { key: "management", label: "Management", email: "dev.management@figbloom.local" },
  { key: "sales", label: "Sales", email: "dev.sales@figbloom.local" },
  { key: "delivery", label: "Delivery", email: "dev.delivery@figbloom.local" },
  { key: "finance", label: "Finance", email: "dev.finance@figbloom.local" },
  { key: "technical", label: "Restricted Technical", email: "dev.tech@figbloom.local" },
  { key: "support", label: "Customer Support", email: "dev.support@figbloom.local" },
] as const;
export type RoleKey = (typeof ROLES)[number]["key"];

export interface Screen {
  /** Short name used in test titles and snapshot file names. */
  name: string;
  /** Path under `/o/{org}`; an empty string is the dashboard. */
  path: string;
  /** Checklist IDs this screen is. */
  ids: string[];
}

/** Every V1 desktop screen that has a route of its own (detail screens are added at run time from the first record in the list). */
export const DESKTOP_SCREENS: Screen[] = [
  { name: "home", path: "", ids: ["D1", "D2", "D3", "G1", "TB1"] },
  { name: "leads", path: "/leads", ids: ["L1"] },
  { name: "deals", path: "/deals", ids: ["P1"] },
  { name: "handoffs", path: "/handoffs", ids: ["P4"] },
  { name: "tasks", path: "/tasks", ids: ["T1"] },
  { name: "calendar", path: "/calendar", ids: ["T2"] },
  { name: "companies", path: "/companies", ids: ["C1"] },
  { name: "contacts", path: "/contacts", ids: ["C3"] },
  { name: "merge", path: "/merge", ids: ["C4"] },
  { name: "conversations", path: "/conversations", ids: ["E1"] },
  { name: "renewals", path: "/renewals", ids: ["E2"] },
  { name: "payments", path: "/payments", ids: ["F1"] },
  { name: "reports", path: "/reports", ids: ["R1", "R2"] },
  { name: "notifications", path: "/notifications", ids: ["G3"] },
  { name: "search", path: "/search?q=a", ids: ["G2"] },
  { name: "preferences", path: "/preferences", ids: ["AP1", "AP2", "AP6", "S3"] },
  { name: "settings", path: "/settings", ids: ["S1"] },
];

export const MOBILE_SCREENS: Screen[] = [
  { name: "m-today", path: "/m", ids: ["M1"] },
  { name: "m-leads", path: "/m/leads", ids: ["M1"] },
  { name: "m-customers", path: "/m/customers", ids: ["M2"] },
  { name: "m-tasks", path: "/m/tasks", ids: ["M3"] },
  { name: "m-alerts", path: "/m/alerts", ids: ["M3"] },
  { name: "m-pipeline", path: "/m/pipeline", ids: ["M3"] },
  { name: "m-sync", path: "/m/sync", ids: ["M4"] },
];

export const orgPath = (path: string) => `/o/${ORG_SLUG}${path}`;

/** First record id of a list API, or null when the list is empty or the role cannot read it. */
export async function firstId(page: Page, api: string): Promise<string | null> {
  const res = await page.request.get(`/api/orgs/${ORG_SLUG}/${api}?limit=1`);
  if (!res.ok()) return null;
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.items ?? body.data ?? body.results ?? []);
  return rows[0]?.id ?? null;
}

/** Detail screens, found through the API as the signed-in role. */
export async function detailScreens(page: Page): Promise<Screen[]> {
  const out: Screen[] = [];
  const lead = await firstId(page, "leads");
  if (lead) out.push({ name: "lead-detail", path: `/leads/${lead}`, ids: ["L2", "L3"] });
  const deal = await firstId(page, "deals");
  if (deal) out.push({ name: "deal-detail", path: `/deals/${deal}`, ids: ["P2", "P3"] });
  const company = await firstId(page, "companies");
  if (company) out.push({ name: "company-detail", path: `/companies/${company}`, ids: ["C2", "X1"] });
  const contact = await firstId(page, "contacts");
  if (contact) out.push({ name: "contact-detail", path: `/contacts/${contact}`, ids: ["C3"] });
  return out;
}

/** What a screen shows when the role may not use it: the explained no-access (S4) in the design's words. */
export const NO_ACCESS = /isn.t part of your workspace|aren.t available for your role|can.t see|not available|don.t have access|no access/i;
