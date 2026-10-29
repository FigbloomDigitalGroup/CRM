/**
 * Demo data for the Customer Support workspace (FIG-1178): sample tickets, satisfaction answers and the two customers they come from, taken from
 * the design's store (design-spec/crm-store.js). Read through `store.ts` only. The customer records carry no deal values, costs or payments on
 * purpose: Customer Support never sees them (hard rule 7), so the demo does not even hold them.
 */

export type TicketStatus = "Open" | "Waiting on client" | "Resolved";

export interface DemoTicket {
  id: string;
  companyId: string;
  title: string;
  status: TicketStatus;
  owner: string;
  opened: string;
  priority: "High" | "Medium" | "Low";
  thread: { from: string; at: string; text: string; internal?: boolean }[];
}

export interface DemoCustomer {
  id: string;
  name: string;
  industry: string;
  lifecycle: string;
  location: string;
  phone: string;
  email: string;
  contacts: { name: string; title: string; email: string }[];
  services: { label: string; status: string; since: string }[];
  knownIssues: string[];
}

export interface DemoSurvey {
  id: string;
  companyId: string;
  score: number;
  at: string;
  comment: string;
}

export const DEMO_TICKETS: DemoTicket[] = [
  {
    id: "tk1",
    companyId: "c1",
    title: "Payroll export misses the overtime column",
    status: "Open",
    owner: "Dev Delivery",
    opened: "Today, 09:12",
    priority: "High",
    thread: [
      { from: "Mutiso Kyalo (customer)", at: "Today, 09:12", text: "The monthly payroll export no longer has the overtime column since the last update. Our finance team needs it by Friday." },
      { from: "Dev Customer Support", at: "Today, 09:40", text: "Checking the export template with Delivery.", internal: true },
    ],
  },
  {
    id: "tk2",
    companyId: "c9",
    title: "Parent portal reset emails arrive late",
    status: "Waiting on client",
    owner: "Dev Technical",
    opened: "Yesterday, 15:30",
    priority: "Medium",
    thread: [
      { from: "Grace Achieng (customer)", at: "Yesterday, 15:30", text: "Parents say the password reset email takes about an hour to arrive." },
      { from: "Dev Customer Support", at: "Yesterday, 16:05", text: "Could you send one example with the time it was requested? We will trace it." },
    ],
  },
  {
    id: "tk3",
    companyId: "c9",
    title: "Add a second bursar login",
    status: "Resolved",
    owner: "Dev Customer Support",
    opened: "12 Oct",
    priority: "Low",
    thread: [
      { from: "Grace Achieng (customer)", at: "12 Oct, 10:02", text: "Please add our deputy bursar to the parent portal admin." },
      { from: "Dev Customer Support", at: "12 Oct, 11:20", text: "Done. A sign-in link was sent to the deputy bursar." },
    ],
  },
];

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    id: "c1",
    name: "Davis & Shirtliff",
    industry: "Engineering",
    lifecycle: "Onboarding",
    location: "Industrial Area, Nairobi",
    phone: "+254 20 696 8000",
    email: "info@davisandshirtliff.com",
    contacts: [{ name: "Mutiso Kyalo", title: "Engineering Lead", email: "mutiso.kyalo@davisshirtliff.co.ke" }],
    services: [{ label: "HR automation (leave, payroll export, self-service)", status: "Onboarding", since: "Oct 2026" }],
    knownIssues: ["Payroll export format still to be confirmed by their finance team"],
  },
  {
    id: "c9",
    name: "Hillcrest Preparatory School",
    industry: "Education",
    lifecycle: "Active Customer",
    location: "Lang’ata, Nairobi",
    phone: "+254 722 203 000",
    email: "bursar@hillcrest.ac.ke",
    contacts: [{ name: "Grace Achieng", title: "Bursar", email: "grace.achieng@hillcrest.ac.ke" }],
    services: [
      { label: "School website and parent portal", status: "Live", since: "Aug 2026" },
      { label: "Campus Starlink kit (hosting renewal due)", status: "Renewal due 15 Nov", since: "Jun 2026" },
    ],
    knownIssues: [],
  },
];

export const DEMO_SURVEYS: DemoSurvey[] = [
  { id: "sv1", companyId: "c9", score: 9, at: "20 Oct 2026", comment: "Smooth launch and quick support." },
  { id: "sv2", companyId: "c1", score: 6, at: "14 Oct 2026", comment: "Onboarding is slower than we hoped; the team is friendly." },
];
