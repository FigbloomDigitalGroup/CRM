/**
 * Demo data for the assistant (docs/RESTRUCTURE_LOG.md). Sample records only; when the assistant is wired to the real API (B6.20, M13) this
 * folder and the "Demo data" badge go, and `respond` calls the API, which applies the same role rules on the server.
 */

export interface DemoLead {
  id: string;
  name: string;
  status: string;
  temp: "Hot" | "Warm" | "Cold";
  service: string;
  hasOpenTask: boolean;
}

export interface DemoDeal {
  id: string;
  company: string;
  title: string;
  stage: string;
  value: number;
  owner: string;
  /** Days since the last reply was logged. */
  silentDays: number;
}

export interface DemoTask {
  id: string;
  title: string;
  about: string;
  overdueDays: number;
}

export const DEMO_LEADS: DemoLead[] = [
  { id: "demo-l1", name: "Two Rivers Mall", status: "Qualified", temp: "Hot", service: "Website redesign", hasOpenTask: false },
  { id: "demo-l2", name: "Karen Blixen Cottages", status: "New", temp: "Hot", service: "Social media", hasOpenTask: false },
  { id: "demo-l3", name: "Sarova Hotels", status: "Contacted", temp: "Warm", service: "Branding", hasOpenTask: true },
  { id: "demo-l4", name: "Naivas Kileleshwa", status: "New", temp: "Cold", service: "Photography", hasOpenTask: false },
];

export const DEMO_DEALS: DemoDeal[] = [
  { id: "demo-d1", company: "Sarova Hotels", title: "Brand refresh", stage: "Proposal Sent", value: 1850000, owner: "Wanjiru", silentDays: 9 },
  { id: "demo-d2", company: "Java House", title: "Menu photography", stage: "Proposal Sent", value: 420000, owner: "Wanjiru", silentDays: 8 },
  { id: "demo-d3", company: "Safaricom Foundation", title: "Annual report design", stage: "Negotiation", value: 3200000, owner: "Brian", silentDays: 2 },
  { id: "demo-d4", company: "Naivas", title: "Campaign video", stage: "Closed Won", value: 2400000, owner: "Brian", silentDays: 0 },
];

export const DEMO_TASKS: DemoTask[] = [
  { id: "demo-t1", title: "Call back about the quote", about: "Two Rivers Mall", overdueDays: 3 },
  { id: "demo-t2", title: "Send the signed contract", about: "Java House", overdueDays: 1 },
];

/** Records the command palette can find in the demo. */
export const DEMO_RECORDS: { kind: "lead" | "deal" | "company"; id: string; name: string; sub: string }[] = [
  ...DEMO_LEADS.map((l) => ({ kind: "lead" as const, id: l.id, name: l.name, sub: `Lead · ${l.status}` })),
  ...DEMO_DEALS.map((d) => ({ kind: "deal" as const, id: d.id, name: `${d.company} · ${d.title}`, sub: `Deal · ${d.stage}` })),
  { kind: "company", id: "demo-c1", name: "Sarova Hotels", sub: "Company · Customer" },
  { kind: "company", id: "demo-c2", name: "Java House", sub: "Company · Customer" },
];

/** The demo's own switch for "Ask Figbloom" in this organisation (Settings, AI assistant). Device-local until the organisation setting exists. */
export const AI_SETTINGS_KEY = "figbloom-demo-ai-settings";

export interface AiSettings {
  assist: boolean;
  summaries: boolean;
  drafts: boolean;
  scoring: boolean;
  retention: boolean;
}
export const DEFAULT_AI_SETTINGS: AiSettings = { assist: true, summaries: true, drafts: true, scoring: true, retention: false };

export function readAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    return raw ? { ...DEFAULT_AI_SETTINGS, ...(JSON.parse(raw) as Partial<AiSettings>) } : DEFAULT_AI_SETTINGS;
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}
export function writeAiSettings(next: AiSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("figbloom-ai-settings"));
  } catch {
    /* blocked storage: the choice lasts until the page closes */
  }
}
