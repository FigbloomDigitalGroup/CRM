/**
 * DEMO DATA for the Sales access screen (UC-C4) and the Organisation structure tab (UC-C2). Neither the departments tables (UC-C1) nor the
 * sales participation keys (UC-C3) exist in the backend yet, so these two screens run on this file and save nothing. Search `roles/demo/` to find
 * what is left to wire (docs/ROLES_ACCESS_SCREENS.md).
 */

export interface Capability {
  n: number;
  label: string;
  help: string;
  /** The permission key the switch will map to (docs/UNIVERSAL_CRM_ARCHITECTURE.md 7.1). */
  key: string;
  /** True when the key is in the catalogue today; false when UC-C3 still has to add it (the switch then only drives the demo preview). */
  exists: boolean;
  /** Switch numbers that must be on for this one to work. */
  needs: number[];
}

export const CAPABILITIES: Capability[] = [
  { n: 1, label: "Lead capture", help: "Add new leads.", key: "leads.create", exists: true, needs: [] },
  { n: 2, label: "Lead sourcing", help: "Record where a lead came from.", key: "leads.source.set", exists: false, needs: [] },
  { n: 3, label: "Lead qualification", help: "Score and qualify leads.", key: "leads.qualify", exists: false, needs: [] },
  { n: 4, label: "Lead assignment", help: "Give a lead to a person.", key: "leads.assign", exists: true, needs: [] },
  { n: 5, label: "Lead transfer to Sales", help: "Hand a lead to the Sales pool without owning deals.", key: "leads.transfer", exists: false, needs: [] },
  { n: 6, label: "Deal creation", help: "Open a deal.", key: "deals.create", exists: true, needs: [] },
  { n: 7, label: "Deal ownership", help: "Own and work deals.", key: "deals.edit.own", exists: true, needs: [6] },
  { n: 8, label: "Deal assistance", help: "Help on someone else's deal.", key: "deals.assist", exists: false, needs: [] },
  { n: 9, label: "Technical scoping", help: "Add scoping notes and requirements on a deal they assist.", key: "deals.scope", exists: false, needs: [8] },
  { n: 10, label: "Quotation creation", help: "Build and send quotes.", key: "quotes.create", exists: true, needs: [7] },
  { n: 11, label: "Deal stage management", help: "Move a deal between stages.", key: "deals.stage.move", exists: false, needs: [7] },
  { n: 12, label: "Deal closure", help: "Move a deal into won or lost.", key: "deals.close", exists: false, needs: [11] },
  { n: 13, label: "Financial visibility", help: "See deal values. Never switched on by default.", key: "deals.view.value", exists: true, needs: [] },
];

export interface Scenario {
  id: string;
  account: string;
  label: string;
  on: number[];
}

export const SCENARIOS: Scenario[] = [
  { id: "marketing-off", account: "Marketing", label: "Marketing, sales off", on: [] },
  { id: "marketing-source", account: "Marketing", label: "Marketing sources, qualifies, transfers", on: [1, 2, 3, 5] },
  { id: "technical", account: "Technical", label: "Technical assists and scopes", on: [8, 9] },
  { id: "sales", account: "Sales", label: "Sales, unchanged", on: [1, 6, 7, 10] },
];

/** The keys every account in the demo has for its own work, whatever the sales switches say (docs 7.4: switching sales off never removes these). */
export const OWN_TOOLS = ["mywork.view", "tasks.view.own", "tasks.create", "contacts.view", "companies.view", "leads.view.all", "chat.view", "communications.view"];

export interface DemoDepartment {
  id: string;
  name: string;
  head: string | null;
  members: string[];
  archived: boolean;
}

export const PEOPLE = ["Amina Odhiambo", "Brian Kamau", "Cynthia Wanjiru", "Daniel Mutua", "Esther Achieng", "Farid Hassan", "Grace Njeri", "Hassan Ali"];

export const DEPARTMENTS: DemoDepartment[] = [
  { id: "d-sales", name: "Sales", head: "Amina Odhiambo", members: ["Amina Odhiambo", "Brian Kamau", "Cynthia Wanjiru"], archived: false },
  { id: "d-marketing", name: "Marketing", head: "Esther Achieng", members: ["Esther Achieng", "Grace Njeri"], archived: false },
  { id: "d-technical", name: "Technical", head: "Daniel Mutua", members: ["Daniel Mutua", "Farid Hassan", "Cynthia Wanjiru"], archived: false },
  { id: "d-finance", name: "Finance", head: "Hassan Ali", members: ["Hassan Ali"], archived: false },
];
