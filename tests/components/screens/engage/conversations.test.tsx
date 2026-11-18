import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationsScreen } from "../../../../src/ui/screens/engage/ConversationsScreen";
import { REFERENCE, apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";
import { ACCESS_ACT, ACCESS_READ, convo, convoPage, iso, waiting } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/conversations",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const SALES = ["communications.view", "communications.create", "leads.create", "leads.view.own", "companies.view", "contacts.view", "activities.view", "activities.create", "tasks.create"];
const DELIVERY = ["communications.view", "deals.view.won"];

const FEED = [
  convo({ id: "cv-1", occurredAt: iso(0, 1) }),
  convo({ id: "cv-2", channel: "EMAIL", direction: "OUTBOUND", subject: "Re: invoice", summary: "Sent the invoice", counterparty: { name: "Chebet Kiprono", email: "c@b.co", phone: null }, occurredAt: iso(1) }),
];
const WAITING = [waiting({ id: "w-1" })];

function setup(handlers: Record<string, Handler> = {}, keys = SALES, access = ACCESS_ACT) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    listConversations: ({ query }) => (query?.pageSize === "1" ? convoPage([], access, { total: query.direction ? 3 : query.tab === "WHATSAPP" ? 2 : 5 }) : convoPage(FEED, access)),
    listNeedsLinking: () => ({ ...convoPage(WAITING, access), tab: undefined }),
    getCompanies: () => ({ items: [{ id: "c-1", name: "Brookside Dairy" }], page: 1, pageSize: 8, total: 1, pageCount: 1 }),
    getContacts: () => ({ items: [], page: 1, pageSize: 8, total: 0, pageCount: 1 }),
    listLeads: () => ({ items: [], page: 1, pageSize: 8, total: 0, pageCount: 1 }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<ConversationsScreen />, stub.client, { permissionKeys: keys, userName: "Dev Sales", membershipId: "m-1" }) };
}

beforeEach(() => window.localStorage.clear());

describe("Conversations hub (F3.04, E1)", () => {
  it("shows the header, stats, channel tabs with counts, the queue and the feed grouped by day", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Conversations", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("My customers’ conversations")).toBeInTheDocument();
    expect(await screen.findByText("Needs linking · 1")).toBeInTheDocument();
    expect(screen.getByText("Wanjiru Kamau")).toBeInTheDocument();
    expect(screen.getByText("Quote for CCTV at our depot")).toBeInTheDocument();
    expect(await screen.findByText("TODAY")).toBeInTheDocument();
    expect(screen.getByText("YESTERDAY")).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Channels" });
    expect(within(tabs).getByRole("tab", { name: /WhatsApp\s*2/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /Needs linking\s*1/ })).toBeInTheDocument();
    // Stats come from the API's totals for the last week.
    await waitFor(() => expect(screen.getByText("This week").nextElementSibling).toHaveTextContent("5"));
    expect(screen.getByText("Inbound").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("WhatsApp share").nextElementSibling).toHaveTextContent("40%");
    expect((await screen.findAllByRole("link", { name: "Brookside Dairy" }))[0]).toHaveAttribute("href", "/o/figbloom/contacts/p-1"); // the most specific linked record
  });

  it("links an unlinked message in two steps: choose a record, then confirm", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ linkConversation: () => ({ item: waiting({ id: "w-1", needsLinking: false }), alreadyLinked: false }) });
    await user.click(await screen.findByRole("button", { name: /Link Wanjiru Kamau to a record/ }));
    const dialog = await screen.findByRole("dialog", { name: "Link to an existing record" });
    await user.click(await within(dialog).findByRole("option", { name: /Brookside Dairy/ }));
    const confirm = await screen.findByRole("dialog", { name: "Link this message?" });
    expect(calls.some((c) => c.id === "linkConversation")).toBe(false); // nothing is saved by the first step
    await user.click(within(confirm).getByRole("button", { name: "Link" }));
    await waitFor(() => expect(calls.find((c) => c.id === "linkConversation")?.args).toMatchObject({ params: { conversationId: "w-1" }, body: { companyId: "c-1" } }));
  });

  it("creates a lead in two steps, asking again when the sender looks like an existing contact", async () => {
    const user = userEvent.setup();
    let n = 0;
    const { calls } = setup({
      createLeadFromConversation: () => (++n === 1 ? { created: false, duplicateWarning: true, duplicates: [{ id: "p-9", label: "Wanjiru Kamau (Depot Ltd)", matchedOn: ["email"] }] } : { created: true, leadId: "l-1" }),
    });
    await user.click(await screen.findByRole("button", { name: "Create lead" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a lead from this message" });
    expect(within(dialog).getByLabelText("First name")).toHaveValue("Wanjiru");
    await user.click(within(dialog).getByRole("button", { name: "Create lead" }));
    const warn = await screen.findByRole("dialog", { name: "This looks like someone you already know" });
    expect(within(warn).getByText(/Wanjiru Kamau \(Depot Ltd\)/)).toBeInTheDocument();
    await user.click(within(warn).getByRole("button", { name: "Create anyway" }));
    await waitFor(() => expect(calls.filter((c) => c.id === "createLeadFromConversation")).toHaveLength(2));
    expect(calls.filter((c) => c.id === "createLeadFromConversation")[1]!.args.body).toMatchObject({ confirmDuplicate: true, firstName: "Wanjiru" });
  });

  it("dismisses a message only with a reason", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ dismissConversation: () => ({ item: waiting({ id: "w-1", needsLinking: false }), alreadyDismissed: false }) });
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    const dialog = await screen.findByRole("dialog", { name: "Dismiss this message?" });
    expect(within(dialog).getByRole("button", { name: "Dismiss" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Spam" }));
    await user.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(calls.find((c) => c.id === "dismissConversation")?.args.body).toEqual({ reason: "Spam" }));
  });

  it("remembers the channel filter on this device", async () => {
    const user = userEvent.setup();
    const first = setup();
    await user.click(await screen.findByRole("tab", { name: /WhatsApp/ }));
    await waitFor(() => expect(first.calls.some((c) => c.id === "listConversations" && c.args.query?.tab === "WHATSAPP")).toBe(true));
    expect(window.localStorage.getItem("figbloom-conversations-tab:figbloom")).toBe('"WHATSAPP"');
    first.unmount();
    setup();
    expect(await screen.findByRole("tab", { name: /WhatsApp/ })).toHaveAttribute("aria-selected", "true");
  });

  it("logs a call from the feed in two taps (outcome, save) against the linked record", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ quickLog: () => ({ activityId: "a", communicationId: "c", taskId: null }) });
    await user.click((await screen.findAllByRole("link", { name: /Call Brookside Dairy/ }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: /How did the call with Chebet go/ });
    await user.click(within(dialog).getByRole("radio", { name: "No answer" }));
    await user.click(within(dialog).getByRole("button", { name: "Save log" }));
    await waitFor(() => expect(calls.find((c) => c.id === "quickLog")?.args.body).toMatchObject({ channel: "CALL", outcome: "NO_ANSWER", contactId: "p-1" }));
  });

  it("logs a conversation that has no record yet", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ logUnlinkedConversation: () => waiting({ id: "w-2" }) });
    await user.click(await screen.findByRole("button", { name: "Log a conversation" }));
    const dialog = await screen.findByRole("dialog", { name: "Log a conversation" });
    expect(within(dialog).getByRole("button", { name: "Save conversation" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("What was said"), "Asked for a CCTV quote");
    await user.click(within(dialog).getByRole("button", { name: "Save conversation" }));
    await waitFor(() => expect(calls.find((c) => c.id === "logUnlinkedConversation")?.args.body).toMatchObject({ channel: "WHATSAPP", direction: "INBOUND", summary: "Asked for a CCTV quote" }));
  });

  it("is read-only for a role that may read but not act, with the API's explanation", async () => {
    setup({}, DELIVERY, ACCESS_READ);
    expect(await screen.findByText("Needs linking · 1")).toBeInTheDocument();
    expect(screen.getByText(/Linking one to a record, or turning it into a lead, is for Sales and Management/)).toBeInTheDocument();
    expect(screen.getByText("Won customers")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log a conversation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create lead" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Call / })).toBeNull();
  });

  it("explains a refusal instead of an empty page", async () => {
    setup({ listConversations: () => apiError(403, "Nope") }, []);
    expect(await screen.findByRole("region", { name: /Conversations/ })).toBeInTheDocument();
  });

  it("says so when there is nothing yet, when nothing matches a search, and when everything is linked", async () => {
    const user = userEvent.setup();
    setup({ listConversations: () => convoPage([]), listNeedsLinking: () => ({ ...convoPage([]), tab: undefined }) });
    expect(await screen.findByText(/No conversations here yet/)).toBeInTheDocument();
    expect(screen.getByText("Everything is linked.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search conversations" }), "zebra");
    expect(await screen.findByText(/No conversations match “zebra”/)).toBeInTheDocument();
  });

  it("passes an accessibility check", async () => {
    const { container } = setup();
    await screen.findByText("TODAY");
    expect(await violations(container)).toEqual([]);
  });
});
