import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_PERMISSIONS } from "../../../prisma/seedData";
import { mentionQuery, mentionsIn } from "../../../src/ui/screens/communication/api";
import { ChatWorkspace } from "../../../src/ui/screens/communication/ChatWorkspace";
import { MailWorkspace } from "../../../src/ui/screens/communication/MailWorkspace";
import { VideoConference } from "../../../src/ui/screens/communication/VideoConference";
import { apiError, renderScreen, stubClient, type Handler } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/chat", useRouter: () => ({ push: vi.fn() }) }));

const V11 = ["chat.view", "chat.post", "mail.use", "meetings.schedule"];
const keys = (role: keyof typeof ROLE_PERMISSIONS) => [...new Set([...ROLE_PERMISSIONS[role]!, ...(role === "FINANCE" ? ["chat.view", "chat.post"] : V11)])];
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const channel = (over: Record<string, unknown>) => ({ id: "ch-1", kind: "PUBLIC", name: "general", description: null, private: false, record: null, archived: false, memberCount: 4, joined: true, unread: 0, mentions: 0, lastSeq: 2, partner: null, ...over });
const message = (over: Record<string, unknown>) => ({ id: "ms-1", channelId: "ch-1", seq: 1, authorMembershipId: "m-2", authorName: "Amina Wekesa", body: "Morning team", deleted: false, erased: false, card: null, mentions: [], attachments: [], reactions: [], canDelete: false, createdAt: iso(1), ...over });
const people = { items: [{ membershipId: "m-1", name: "Dev Sales", roleName: "Sales", presence: "ONLINE", you: true }, { membershipId: "m-2", name: "Amina Wekesa", roleName: "Sales", presence: "ONLINE", you: false }] };

function chat(handlers: Record<string, Handler> = {}) {
  const stub = stubClient({
    getChatChannels: () => ({ items: [channel({}), channel({ id: "ch-2", name: "field-ops", unread: 2 }), channel({ id: "ch-3", kind: "RECORD", name: "Kisumu Greens website", private: true, record: { type: "DEAL", id: "d-1" } })], unreadTotal: 2, mentionTotal: 0 }),
    getChatPeople: () => people,
    getChatChannelsByChannelIdMessages: ({ params }) => ({ items: params?.channelId === "ch-3" ? [message({ id: "ms-9", channelId: "ch-3", card: { type: "DEAL", id: "d-1", noAccess: false, name: "Kisumu Greens website", stage: "Negotiation", value: 480000, paymentDue: null } })] : [message({})], hasMore: false, lastSeq: 2 }),
    postChatChannelsByChannelIdRead: () => ({ ok: true }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<ChatWorkspace />, stub.client, { permissionKeys: keys("SALES"), userName: "Dev Sales", membershipId: "m-1" }) };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("pure helpers", () => {
  it("finds the word being mentioned and the people named in full", () => {
    expect(mentionQuery("hi @Am")).toBe("Am");
    expect(mentionQuery("hi there")).toBeNull();
    expect(mentionsIn("hello @Amina Wekesa", people.items)).toEqual(["m-2"]);
  });
});

describe("Chat (F6.21) reads and writes the API", () => {
  it("lists channels and messages from the API, with unread counts", async () => {
    const { calls } = chat();
    expect(await screen.findByText("Morning team")).toBeInTheDocument();
    const side = screen.getByRole("complementary", { name: /Channels and direct messages/ });
    expect(within(side).getByRole("button", { name: /field-ops/ })).toBeInTheDocument();
    expect(within(side).getAllByLabelText("2 unread").length).toBeGreaterThan(0);
    expect(calls.some((c) => c.id === "getChatChannels")).toBe(true);
  });

  it("posts a message with the people it names as mentions", async () => {
    const user = userEvent.setup();
    const { calls } = chat({ postChatChannelsByChannelIdMessages: () => message({ id: "ms-2" }) });
    await screen.findByText("Morning team");
    await user.type(screen.getByRole("textbox", { name: "Message #general" }), "Hello @Amina Wekesa");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postChatChannelsByChannelIdMessages")?.args).toMatchObject({ params: { channelId: "ch-1" }, body: { body: "Hello @Amina Wekesa", mentions: ["m-2"] } }));
  });

  it("draws a record card as the API masked it: a hidden payment is never a number", async () => {
    const user = userEvent.setup();
    chat();
    await user.click(await screen.findByRole("button", { name: /Kisumu Greens website/ }));
    const log = screen.getByRole("log", { name: "Messages" });
    expect(await within(log).findByText("Payment due")).toBeInTheDocument();
    expect(within(log).getByText(/480,000/)).toBeInTheDocument();
    expect(within(log).queryByText(/120,000/)).not.toBeInTheDocument();
  });

  it("explains a record the viewer cannot open without naming it", async () => {
    const user = userEvent.setup();
    chat({ getChatChannelsByChannelIdMessages: () => ({ items: [message({ card: { type: "DEAL", id: "d-1", noAccess: true, name: null } })], hasMore: false, lastSeq: 1 }) });
    await user.click(await screen.findByRole("button", { name: /field-ops/ }));
    expect(await screen.findByText("Record not available")).toBeInTheDocument();
  });

  it("marks a channel read when it is opened", async () => {
    const user = userEvent.setup();
    const { calls } = chat();
    await user.click(await screen.findByRole("button", { name: /field-ops/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "postChatChannelsByChannelIdRead" && (c.args.params as { channelId: string }).channelId === "ch-2")).toBeTruthy());
  });

  it("creates a channel and shows the API's refusal of a name that exists", async () => {
    const user = userEvent.setup();
    chat({ postChatChannels: () => apiError(409, 'A channel called "general" already exists.') });
    await screen.findByText("Morning team");
    await user.click(screen.getByRole("button", { name: "New channel" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Channel name/), "general");
    await user.click(within(dialog).getByRole("button", { name: "Create channel" }));
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument();
  });

  it("shows the explained not-available state when the release gate is closed", async () => {
    chat({ getChatChannels: () => apiError(403, "Chat arrives with V1.1.", { code: "FEATURE_UNAVAILABLE", feature: { key: "communication.group", reason: "release", availableIn: "V1.1" } }) });
    expect(await screen.findByText("Chat is not available yet")).toBeInTheDocument();
  });

  it("explains no-access to a role without chat.view, and calls nothing", () => {
    const stub = stubClient({});
    renderScreen(<ChatWorkspace />, stub.client, { permissionKeys: [] });
    expect(screen.getByRole("region", { name: /Chat/ })).toBeInTheDocument();
    expect(stub.call).not.toHaveBeenCalled();
  });
});

const CONNECTED = { items: [{ id: "cn-1", kind: "EMAIL", provider: "GOOGLE", state: "CONNECTED", stateReason: "", accountEmail: "me@x.co" }, { id: "cn-2", kind: "CALENDAR", provider: "GOOGLE", state: "CONNECTED", stateReason: "", accountEmail: "me@x.co" }] };
const DISCONNECTED = { items: [{ id: null, kind: "EMAIL", provider: null, state: "DISCONNECTED", stateReason: "No mailbox is connected.", accountEmail: null }, { id: null, kind: "CALENDAR", provider: null, state: "DISCONNECTED", stateReason: "No calendar is connected.", accountEmail: null }] };
const conv = (over: Record<string, unknown>) => ({ id: "cm-1", kind: "COMMUNICATION", channel: "EMAIL", direction: "INBOUND", occurredAt: iso(2), subject: "Cold-room quote", summary: "Could you split the install in two phases?", counterparty: { name: "Esther Achieng", email: "esther@savanna.example", phone: null }, link: { dealId: "d-1", companyName: "Savanna Foods" }, needsLinking: false, ...over });
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 50, total: items.length, pageCount: 1, nextCursor: null, tab: "EMAIL", tabCounts: {}, access: {} });

function mail(handlers: Record<string, Handler> = {}, connected = true) {
  const stub = stubClient({
    getIntegrationsConnections: () => (connected ? CONNECTED : DISCONNECTED),
    listConversations: ({ query }) => (query?.direction === "OUTBOUND" ? page([conv({ id: "cm-2", direction: "OUTBOUND", subject: "Our quote" })]) : page([conv({})])),
    listNeedsLinking: () => page([conv({ id: "cm-3", subject: "Do you do POS for dairies?", link: {}, needsLinking: true })]),
    getCommunicationsMailDrafts: () => ({ items: [{ id: "dr-1", to: ["peter@lakeside.example"], subject: "Follow-up after the call", body: "Hi Peter,\n\nThank you.", status: "DRAFT", replyToCommunicationId: null, companyId: "c-1", contactId: null, leadId: null, dealId: null, updatedAt: iso(1), lastError: null }] }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<MailWorkspace />, stub.client, { permissionKeys: keys("MANAGEMENT"), userName: "Dev" }) };
}

describe("Mail (F6.22) reads and writes the API", () => {
  it("explains no-access to a role without mail.use, and calls nothing", () => {
    const stub = stubClient({});
    renderScreen(<MailWorkspace />, stub.client, { permissionKeys: keys("FINANCE") });
    expect(screen.queryByRole("button", { name: /Compose/ })).not.toBeInTheDocument();
    expect(stub.call).not.toHaveBeenCalled();
  });

  it("lists the inbox from the API and opens a message", async () => {
    const user = userEvent.setup();
    mail();
    await user.click(await screen.findByRole("button", { name: /Cold-room quote/ }));
    expect(within(screen.getByRole("region", { name: "Reading pane" })).getByText(/split the install/)).toBeInTheDocument();
    expect(screen.getByText(/Logged on/)).toBeInTheDocument();
  });

  it("cannot compose until the mailbox is connected, and says why", async () => {
    mail({}, false);
    expect(await screen.findByText(/Your mailbox is not connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Compose/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("sends through the API with the recipients, subject and record it was given", async () => {
    const user = userEvent.setup();
    const found = { query: "sav", tooShort: false, total: 1, hidden: { someResultsHidden: false }, groups: [{ type: "deals", items: [{ id: "d-1", label: "Savanna Foods cold-room", sublabel: null }], page: 1, pageSize: 8, total: 1, pageCount: 1, nextCursor: null }] };
    const { calls } = mail({ postCommunicationsMailSend: () => ({ communicationId: "cm-9" }), search: () => found });
    await screen.findByRole("button", { name: /Compose/ });
    await waitFor(() => expect(screen.getByRole("button", { name: /Compose/ })).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(screen.getByRole("button", { name: /Compose/ }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Send/ }));
    expect(within(dialog).getByText(/full email addresses/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^To/), "esther@savanna.example");
    await user.type(within(dialog).getByLabelText(/Subject/), "Quote follow-up");
    await user.type(within(dialog).getByLabelText(/Message/), "Thanks");
    await user.type(within(dialog).getByLabelText("Record"), "sav");
    await user.click(await within(dialog).findByRole("button", { name: /Savanna Foods cold-room/ }));
    await user.click(within(dialog).getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "postCommunicationsMailSend")?.args.body).toMatchObject({ to: ["esther@savanna.example"], subject: "Quote follow-up", body: "Thanks", dealId: "d-1" }));
  });

  it("an unlinked message waits in Needs linking, and Drafts come from the API", async () => {
    const user = userEvent.setup();
    mail();
    await user.click(await screen.findByRole("tab", { name: /Needs linking/ }));
    expect(await screen.findByRole("button", { name: /Do you do POS for dairies/ })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Drafts/ }));
    expect(await screen.findByRole("button", { name: /Follow-up after the call/ })).toBeInTheDocument();
  });

  it("sends a draft only when a person presses Send", async () => {
    const user = userEvent.setup();
    const { calls } = mail({ postCommunicationsMailDraftsByDraftIdSend: () => ({ ok: true }) });
    await user.click(await screen.findByRole("tab", { name: /Drafts/ }));
    await user.click(await screen.findByRole("button", { name: /Follow-up after the call/ }));
    expect(calls.some((c) => c.id === "postCommunicationsMailDraftsByDraftIdSend")).toBe(false);
    await user.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "postCommunicationsMailDraftsByDraftIdSend")?.args).toMatchObject({ params: { draftId: "dr-1" } }));
  });
});

function video(handlers: Record<string, Handler> = {}, connected = true) {
  const stub = stubClient({
    getIntegrationsConnections: () => (connected ? CONNECTED : DISCONNECTED),
    getCalendar: () => ({ from: "", to: "", timeZone: "UTC", view: null, truncated: false, items: [{ kind: "activity", type: "MEETING", id: "ac-1", title: "Booking system demo", start: new Date(Date.now() + 86_400_000).toISOString(), link: { type: "Company", id: "c-1" }, assigneeName: "Dev Sales" }, { kind: "activity", type: "MEETING", id: "ac-0", title: "Kickoff call", start: iso(72), link: null, assigneeName: "Dev Sales" }, { kind: "task", type: "TASK", id: "t-1", title: "A task", start: iso(1), link: null, assigneeName: null }] }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<VideoConference />, stub.client, { permissionKeys: keys("SALES") }) };
}

describe("Video Conference (F6.23) reads and writes the API", () => {
  it("explains no-access to a role with no meetings key, and calls nothing", () => {
    const stub = stubClient({});
    renderScreen(<VideoConference />, stub.client, { permissionKeys: keys("FINANCE") });
    expect(screen.queryByRole("button", { name: /Schedule/ })).not.toBeInTheDocument();
    expect(stub.call).not.toHaveBeenCalled();
  });

  it("lists upcoming and past meetings from the calendar feed, leaving tasks out", async () => {
    const user = userEvent.setup();
    video();
    expect(await screen.findByText("Booking system demo")).toBeInTheDocument();
    expect(screen.queryByText("A task")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Past and cancelled/ }));
    expect(await screen.findByText("Kickoff call")).toBeInTheDocument();
  });

  it("is blocked, with a reason, while the calendar is not connected", async () => {
    video({}, false);
    expect(await screen.findByText(/Your calendar is not connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("validates, then schedules through the API with a video link", async () => {
    const user = userEvent.setup();
    const found = { query: "kis", tooShort: false, total: 1, hidden: { someResultsHidden: false }, groups: [{ type: "companies", items: [{ id: "c-7", label: "Kisumu Greens", sublabel: null }], page: 1, pageSize: 8, total: 1, pageCount: 1, nextCursor: null }] };
    const { calls } = video({
      postCommunicationsMeetings: () => ({ activityId: "ac-9", title: "Kisumu review", start: new Date().toISOString(), attendees: ["lucy@x.co"], joinUrl: "https://meet.example/abc", status: "CONFIRMED" }),
      search: () => found,
    });
    await screen.findByRole("button", { name: /^Schedule$/ });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Schedule$/ })).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(screen.getByRole("button", { name: /^Schedule$/ }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Schedule and send invites/ }));
    expect(within(dialog).getByText("Give the meeting a title.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Choose the record/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Title/), "Kisumu review");
    await user.type(within(dialog).getByLabelText("Record"), "kis");
    await user.click(await within(dialog).findByRole("button", { name: /Kisumu Greens/ }));
    await user.click(within(dialog).getByRole("button", { name: /Schedule and send invites/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "postCommunicationsMeetings")?.args.body).toMatchObject({ title: "Kisumu review", withVideo: true, link: { type: "Company", id: "c-7" } }));
    expect(await screen.findByText(/Scheduled\. Invites were sent to 1 person/)).toBeInTheDocument();
  });

  it("cancels a meeting after a confirmation", async () => {
    const user = userEvent.setup();
    const { calls } = video({ deleteCommunicationsMeetingsByActivityId: () => ({ status: "CANCELLED" }) });
    const row = (await screen.findByText("Booking system demo")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel meeting" }));
    await waitFor(() => expect(calls.find((c) => c.id === "deleteCommunicationsMeetingsByActivityId")?.args).toMatchObject({ params: { activityId: "ac-1" } }));
    await user.click(screen.getByRole("tab", { name: /Past and cancelled/ }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });
});
