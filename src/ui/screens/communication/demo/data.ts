/**
 * Demo data for the Communication group: Chat (F6.21, FIG-1379), Mail (F6.22, FIG-1380) and Video Conference (F6.23, FIG-1381).
 * Pure data and pure helpers, no browser APIs, so the masking rule is unit-tested (tests/communicationDemo.test.ts). Wiring to the real API
 * is B6.24 to B6.27 (chat) and FIG-806, FIG-807, FIG-808 and FIG-1153 (mail and meetings) in M13: swap `store.ts` and keep the shapes.
 * No real customer data: every name, address and number below is invented.
 */

export type Presence = "online" | "away" | "offline";

export interface DemoPerson {
  id: string;
  name: string;
  title: string;
  city: string;
  presence: Presence;
  email: string;
}

export const ME = "me";

export const DEMO_PEOPLE: DemoPerson[] = [
  { id: "p-amina", name: "Amina Wekesa", title: "Sales lead", city: "Nairobi", presence: "online", email: "amina@demo.figbloom.test" },
  { id: "p-joseph", name: "Joseph Otieno", title: "Account executive", city: "Kisumu", presence: "online", email: "joseph@demo.figbloom.test" },
  { id: "p-wanjiru", name: "Wanjiru Kamau", title: "Delivery manager", city: "Nairobi", presence: "away", email: "wanjiru@demo.figbloom.test" },
  { id: "p-farid", name: "Farid Salim", title: "Finance officer", city: "Mombasa", presence: "offline", email: "farid@demo.figbloom.test" },
  { id: "p-grace", name: "Grace Njeri", title: "Support agent", city: "Nairobi", presence: "online", email: "grace@demo.figbloom.test" },
  { id: "p-kevin", name: "Kevin Mutua", title: "Field technician", city: "Nakuru", presence: "away", email: "kevin@demo.figbloom.test" },
];

/** What a record card in chat may show, by the permission keys of the person looking. Never by the poster's role (hard rule 7). */
export interface RecordCard {
  id: string;
  kind: "deal" | "company";
  name: string;
  stage?: string;
  valueKes?: number;
  marginPct?: number;
  paymentDueKes?: number;
}

export const DEMO_CARDS: RecordCard[] = [
  { id: "d-kisumu", kind: "deal", name: "Kisumu Greens website", stage: "Negotiation", valueKes: 480000, marginPct: 34, paymentDueKes: 120000 },
  { id: "d-lakeside", kind: "deal", name: "Lakeside Hotel booking system", stage: "Proposal sent", valueKes: 1250000, marginPct: 28 },
  { id: "c-savanna", kind: "company", name: "Savanna Foods Ltd" },
];

export interface CardView {
  id: string;
  kind: RecordCard["kind"];
  name: string;
  stage?: string;
  /** Each figure is a number only when the viewer may see it, `null` when it is masked, and absent when the card has none. */
  value?: number | null;
  margin?: number | null;
  paymentDue?: number | null;
}

/**
 * The card as this viewer sees it (hard rule 7). Deal values need `deals.view.value`, margins `deals.margin`, payments `finance.view.payments`
 * (Finance and Management only). A masked figure is `null`, never a stand-in number, so nothing can leak by formatting.
 */
export function viewCard(card: RecordCard, can: (key: string) => boolean): CardView {
  const out: CardView = { id: card.id, kind: card.kind, name: card.name, stage: card.stage };
  if (card.valueKes !== undefined) out.value = can("deals.view.value") ? card.valueKes : null;
  if (card.marginPct !== undefined) out.margin = can("deals.margin") ? card.marginPct : null;
  if (card.paymentDueKes !== undefined) out.paymentDue = can("finance.view.payments") ? card.paymentDueKes : null;
  return out;
}

/** Restricted Technical has no customer access, so it sees only the channels it was added to (the design's role limit). */
export function isLimitedMember(can: (key: string) => boolean): boolean {
  return !can("companies.view");
}

export interface DemoChannel {
  id: string;
  name: string;
  kind: "channel" | "record";
  private: boolean;
  description: string;
  members: number;
  /** The permission a person needs to see the channel at all; absent = every member. A record channel needs the right to open its record. */
  requires?: string;
  /** Shown to a limited member (Restricted Technical) because they were added to it. */
  addedLimited?: boolean;
  record?: { kind: "deal" | "company"; name: string };
}

export const DEMO_CHANNELS: DemoChannel[] = [
  { id: "general", name: "general", kind: "channel", private: false, description: "Company-wide announcements and chatter", members: 17, addedLimited: true },
  { id: "field-ops", name: "field-ops", kind: "channel", private: false, description: "Installs, site visits and equipment", members: 9, addedLimited: true },
  { id: "sales-team", name: "sales-team", kind: "channel", private: false, description: "Pipeline, wins and handovers", members: 8, requires: "companies.view" },
  { id: "deal-kisumu", name: "Kisumu Greens website", kind: "record", private: true, description: "Everything about this deal", members: 4, requires: "companies.view", record: { kind: "deal", name: "Kisumu Greens website" } },
  { id: "finance-desk", name: "finance-desk", kind: "channel", private: true, description: "Invoices, receipts and follow-ups", members: 3, requires: "finance.view.payments" },
  { id: "leadership", name: "leadership", kind: "channel", private: true, description: "Management only", members: 3, requires: "configuration.manage" },
];

export interface DemoMessage {
  id: string;
  channelId: string;
  authorId: string;
  text: string;
  day: string;
  time: string;
  attachments?: string[];
  card?: RecordCard;
  reactions: Record<string, string[]>;
}

const m = (id: string, channelId: string, authorId: string, day: string, time: string, text: string, extra: Partial<DemoMessage> = {}): DemoMessage => ({
  id,
  channelId,
  authorId,
  text,
  day,
  time,
  reactions: {},
  ...extra,
});

export const DEMO_MESSAGES: DemoMessage[] = [
  m("m1", "general", "p-amina", "Yesterday", "09:12", "Morning team. Quarter-end is Friday, please log your calls today."),
  m("m2", "general", "p-grace", "Yesterday", "09:40", "Done on my side. Two tickets closed overnight.", { reactions: { "👍": ["p-amina", "p-joseph"] } }),
  m("m3", "general", "p-kevin", "Today", "08:05", "Who is online? The Nakuru install needs a second pair of hands."),
  m("m4", "field-ops", "p-kevin", "Today", "08:20", "Router stock is low at the Nakuru store. Ordering six more."),
  m("m5", "field-ops", "p-wanjiru", "Today", "08:31", "Approved. Add the invoice to finance-desk when it arrives."),
  m("m6", "sales-team", "p-joseph", "Yesterday", "16:02", "Lakeside Hotel wants a revised proposal by Monday.", { card: DEMO_CARDS[1] }),
  m("m7", "sales-team", "p-amina", "Yesterday", "16:10", "I will review the numbers tonight. @Joseph Otieno send me the draft."),
  m("m8", "deal-kisumu", "p-joseph", "Today", "09:15", "Customer accepted the scope. Sharing the deal so everyone has the numbers.", { card: DEMO_CARDS[0] }),
  m("m9", "deal-kisumu", "p-wanjiru", "Today", "09:22", "Delivery can start the week of the 9th once the deposit lands."),
  m("m10", "finance-desk", "p-farid", "Today", "07:50", "Deposit for Kisumu Greens is expected today. I will confirm once it clears."),
  m("m11", "leadership", "p-amina", "Yesterday", "18:30", "Hiring plan for December is in the shared folder."),
];

/** Unread counts the demo starts with, per channel and per person (direct messages). */
export const DEMO_UNREAD: Record<string, number> = { general: 1, "field-ops": 2, "sales-team": 0, "deal-kisumu": 2, "finance-desk": 1, leadership: 0, "dm:p-amina": 1 };

export const DEMO_DMS: DemoMessage[] = [m("dm1", "dm:p-amina", "p-amina", "Today", "07:45", "Can you join the 11:00 call with Savanna Foods?")];

/** The people in a text's @mentions, by full name (a name typed in full after the at sign). */
export function mentionsIn(text: string, people: readonly { id: string; name: string }[]): string[] {
  return people.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);
}

/** The partial `@word` at the end of a draft, if any, so the composer can offer people to complete it. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([A-Za-z]*)$/.exec(draft);
  return match ? match[1]! : null;
}

export const EMOJI = ["👍", "🎉", "✅", "🙏", "😀", "👀"];

export function formatKes(n: number): string {
  return `KES ${n.toLocaleString("en-KE")}`;
}

/* Mail ------------------------------------------------------------------------------------------------------------------------------ */

export type MailFolder = "inbox" | "sent" | "draft";
export interface MailLink {
  kind: "lead" | "deal" | "company" | "contact";
  name: string;
}

export interface DemoMail {
  id: string;
  folder: MailFolder;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  day: string;
  time: string;
  unread: boolean;
  link: MailLink | null;
  /** A message linked to a colleague's lead is hidden from a person without the organisation-wide lead permission (same rule as Conversations). */
  colleagueLead?: boolean;
  /** Created by an automation: a draft only, never sent without a person (hard rule 9). */
  byAutomation?: boolean;
}

export const DEMO_MAIL: DemoMail[] = [
  { id: "ml1", folder: "inbox", from: "Esther Achieng", fromEmail: "esther@savannafoods.example", to: "you", subject: "Re: Cold-room monitoring quote", body: "Hello,\n\nThank you for the quote. Could you split the installation into two phases? We would like to start with the Nairobi depot.\n\nRegards,\nEsther", day: "Today", time: "09:41", unread: true, link: { kind: "deal", name: "Savanna Foods cold-room monitoring" } },
  { id: "ml2", folder: "inbox", from: "Peter Ouma", fromEmail: "peter@lakesidehotel.example", to: "you", subject: "Booking system demo on Thursday?", body: "Hi,\n\nCan we have the demo on Thursday at 14:00? Our manager will join.\n\nPeter", day: "Today", time: "08:12", unread: true, link: { kind: "company", name: "Lakeside Hotel" } },
  { id: "ml3", folder: "inbox", from: "Unknown sender", fromEmail: "info@nakurufreshmilk.example", to: "you", subject: "Do you do POS for dairies?", body: "Good morning,\n\nWe run three milk collection points and need a point-of-sale system. Do you cover this?\n\nNakuru Fresh Milk", day: "Yesterday", time: "17:30", unread: true, link: null },
  { id: "ml4", folder: "inbox", from: "Dennis Rotich", fromEmail: "dennis@kericho.example", to: "you", subject: "Warehouse tracker pricing", body: "Please send pricing for the warehouse tracker. We are comparing three suppliers.\n\nDennis", day: "Yesterday", time: "11:05", unread: false, link: { kind: "lead", name: "Kericho Tea Packers" }, colleagueLead: true },
  { id: "ml5", folder: "sent", from: "you", fromEmail: "you@demo.figbloom.test", to: "esther@savannafoods.example", subject: "Cold-room monitoring quote", body: "Hello Esther,\n\nPlease find our quote attached. I am happy to walk you through it.\n\nBest regards", day: "Yesterday", time: "15:20", unread: false, link: { kind: "deal", name: "Savanna Foods cold-room monitoring" } },
  { id: "ml6", folder: "draft", from: "you", fromEmail: "you@demo.figbloom.test", to: "peter@lakesidehotel.example", subject: "Follow-up after the call", body: "Hi Peter,\n\nThank you for your time yesterday. As discussed, here is a summary of what we agreed.\n\nBest regards", day: "Today", time: "07:30", unread: false, link: { kind: "company", name: "Lakeside Hotel" }, byAutomation: true },
];

export const MAIL_TEMPLATES = [
  { id: "t-followup", label: "Follow-up after a call", subject: "Following up on our call", body: "Hello,\n\nThank you for your time today. Here is a short summary of what we agreed and the next steps.\n\nBest regards" },
  { id: "t-proposal", label: "Proposal cover note", subject: "Your proposal from Figbloom", body: "Hello,\n\nPlease find your proposal attached. I am glad to walk you through it whenever suits you.\n\nBest regards" },
  { id: "t-reminder", label: "Payment reminder (gentle)", subject: "A gentle reminder about your invoice", body: "Hello,\n\nThis is a friendly reminder that your invoice is due. Please let us know if anything is unclear.\n\nBest regards" },
];

export const MAIL_RECORDS: { value: string; label: string; link: MailLink }[] = [
  { value: "deal:savanna", label: "Deal: Savanna Foods cold-room monitoring", link: { kind: "deal", name: "Savanna Foods cold-room monitoring" } },
  { value: "deal:kisumu", label: "Deal: Kisumu Greens website", link: { kind: "deal", name: "Kisumu Greens website" } },
  { value: "company:lakeside", label: "Company: Lakeside Hotel", link: { kind: "company", name: "Lakeside Hotel" } },
  { value: "lead:nakuru", label: "Lead: Nakuru Fresh Milk", link: { kind: "lead", name: "Nakuru Fresh Milk" } },
];

/* Video Conference ----------------------------------------------------------------------------------------------------------------- */

export type MeetingProvider = "Google Meet" | "Microsoft Teams";
export interface DemoAttendee {
  id: string;
  name: string;
  email: string | null;
  external: boolean;
}

export const DEMO_ATTENDEES: DemoAttendee[] = [
  { id: "a-esther", name: "Esther Achieng (Savanna Foods)", email: "esther@savannafoods.example", external: true },
  { id: "a-peter", name: "Peter Ouma (Lakeside Hotel)", email: "peter@lakesidehotel.example", external: true },
  { id: "a-lucy", name: "Lucy Chebet (Kisumu Greens)", email: null, external: true },
  { id: "p-amina", name: "Amina Wekesa", email: "amina@demo.figbloom.test", external: false },
  { id: "p-joseph", name: "Joseph Otieno", email: "joseph@demo.figbloom.test", external: false },
];

export interface DemoMeeting {
  id: string;
  title: string;
  record: string;
  provider: MeetingProvider;
  day: string;
  time: string;
  minutes: number;
  attendees: string[];
  status: "upcoming" | "past" | "cancelled";
  joinCode: string;
}

export const DEMO_MEETINGS: DemoMeeting[] = [
  { id: "v1", title: "Cold-room monitoring: phase plan", record: "Deal: Savanna Foods cold-room monitoring", provider: "Google Meet", day: "Today", time: "11:00", minutes: 30, attendees: ["a-esther", "p-amina"], status: "upcoming", joinCode: "fbl-demo-savanna" },
  { id: "v2", title: "Booking system demo", record: "Company: Lakeside Hotel", provider: "Microsoft Teams", day: "Thursday", time: "14:00", minutes: 45, attendees: ["a-peter", "p-joseph"], status: "upcoming", joinCode: "fbl-demo-lakeside" },
  { id: "v3", title: "Kickoff call", record: "Deal: Kisumu Greens website", provider: "Google Meet", day: "Last Monday", time: "10:00", minutes: 30, attendees: ["a-lucy", "p-amina"], status: "past", joinCode: "fbl-demo-kisumu" },
];

/** Attendees who cannot be invited because the contact has no email on file; flagged before the invite is sent. */
export function attendeesWithoutEmail(ids: readonly string[]): DemoAttendee[] {
  return DEMO_ATTENDEES.filter((a) => ids.includes(a.id) && !a.email);
}
