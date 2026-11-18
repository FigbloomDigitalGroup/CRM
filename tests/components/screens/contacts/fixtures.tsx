import { apiError, renderScreen, stubClient } from "../deals/harness";
import type { Handler } from "../deals/harness";

export { apiError, renderScreen, stubClient };
export type { Handler };
export { violations } from "../deals/harness";

export const REFERENCE = {
  members: [
    { membershipId: "m-1", userName: "Dev Sales", userEmail: "s@x", roleKey: "SALES", roleName: "Sales", initials: "DS" },
    { membershipId: "m-mg", userName: "Dev Management", userEmail: "m@x", roleKey: "MANAGEMENT", roleName: "Management", initials: "DM" },
  ],
  leadStatuses: [],
  leadSources: [],
  services: [],
  lostReasons: [],
};

/** The keys a Sales member holds for contacts. */
export const SALES = ["contacts.view", "contacts.create", "contacts.edit", "contacts.archive", "contacts.merge", "communications.view", "communications.create", "activities.view", "activities.create", "tasks.view.own", "tasks.create", "companies.view", "companies.create"];
export const MANAGEMENT = [...SALES, "membership.manage", "contacts.import", "contacts.export", "tasks.view.all"];
/** Delivery and Finance may view contacts only. */
export const VIEWER = ["contacts.view", "companies.view"];

export function contact(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    organizationId: "o-1",
    companyId: "c1",
    firstName: "Chebet",
    lastName: "Kiprono",
    phone: "0712 345 605",
    email: "chebet@brookside.example",
    jobTitle: "Supply Chain Manager",
    department: "Operations",
    socialProfiles: null,
    notes: null,
    ownerMembershipId: "m-1",
    archivedAt: null,
    customFields: {},
    company: { id: "c1", name: "Brookside Dairy", industry: "Food and beverage", location: "Nairobi" },
    owner: { id: "m-1", user: { name: "Dev Sales" } },
    tags: [],
    ...over,
  };
}

export const COUNTS = { all: 3, standalone: 1, missingEmail: 1, missingPhone: 0, archived: 1 };

export function directory(items: unknown[], over: Record<string, unknown> = {}) {
  return { items, page: 1, pageSize: 25, total: items.length, pageCount: 1, nextCursor: null, counts: COUNTS, ...over };
}

export const ROWS = [
  contact(),
  contact({ id: "p2", firstName: "Amara", lastName: "Osei", companyId: null, company: null, email: "", phone: "+254 722 000 111", jobTitle: null }),
  contact({ id: "p3", firstName: "Wanjiru", lastName: "Kamau", phone: "", email: "w@x.example" }),
];
