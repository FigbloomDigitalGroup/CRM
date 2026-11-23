import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteList } from "../../../src/ui/screens/commercial/QuoteList";
import { REFERENCE, STAGES, apiError, deal, page, renderScreen, stubClient } from "../screens/deals/harness";
import type { Handler } from "../screens/deals/harness";

/**
 * The Quotes page (UC-R3, FIG-1784; UC-R4, FIG-1777): filters and chips against the list API's additive query parameters, saved views, the empty,
 * no-match and masked states, a read-only role, the New quote picker and the share panel (email, copy link, WhatsApp).
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/quotes",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const SALES = ["quotes.create", "quotes.view", "quotes.send", "deals.view.own", "deals.view.value", "deals.create"];
const MANAGER = ["quotes.create", "quotes.view", "quotes.approve", "deals.view.all", "deals.view.value", "deals.create"];
const FINANCE_NO_VALUE = ["quotes.view", "deals.view.all"];

const summary = (over: Record<string, unknown> = {}) => ({
  version: 1, status: "SENT", locked: true, expired: false, discountPercent: 0, validUntil: "2026-12-30", currency: "KES",
  subtotal: 37000, discountAmount: 0, total: 37000, marginPct: null, amountMasked: false, marginMasked: true,
  submittedAt: null, approvedAt: null, decisionReason: null, sentAt: "2026-11-02T08:00:00Z", respondedAt: null, createdAt: "2026-11-01T08:00:00Z", ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: "q1", number: "Q-2026-0001", dealId: "d1", companyName: "Kijani Foods", currency: "KES", latest: summary(), updatedAt: "2026-11-03T00:00:00Z", ownerMembershipId: "m-mg", ...over,
});
const COUNTS = { ALL: 5, DRAFT: 1, PENDING_APPROVAL: 0, APPROVED: 1, REJECTED: 0, SENT: 2, ACCEPTED: 1, DECLINED: 0, EXPIRED: 0 };
const withCounts = (items: unknown[], counts = COUNTS) => ({ ...page(items), statusCounts: counts });
const ref = () => ({ ...REFERENCE });

/** The list the screen asks for in the "All quotes" view: it carries `counts=true`, unlike the open-deals view's lookup (which has `dealId`). */
const listCalls = (calls: { id: string; args: { query?: Record<string, unknown> } }[]) => calls.filter((c) => c.id === "getQuotes" && !c.args.query?.dealId);

function view(handlers: Record<string, Handler> = {}, keys = MANAGER) {
  const stub = stubClient({
    getDeals: () => page([deal({ id: "d1", company: "Kijani Foods", stage: STAGES[1]! })]),
    getReferenceData: () => ref(),
    getViews: () => ({ items: [] }),
    getQuotes: (args) => (args.query?.dealId ? page([]) : withCounts([row()])),
    getQuotesByQuoteIdVersionsByVersionActivity: () => ({ shares: [], events: [] }),
    ...handlers,
  });
  const user = userEvent.setup();
  renderScreen(<QuoteList />, stub.client, { permissionKeys: keys });
  return { ...stub, user };
}

async function openAllQuotes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "All quotes" }));
}

afterEach(() => push.mockClear());

describe("Quotes page filters and status chips", () => {
  it("asks for the chip counts and each row's activity, shows a chip for each status and its count", async () => {
    const { user, calls } = view();
    await openAllQuotes(user);
    await screen.findByText("Q-2026-0001 · v1");
    expect(listCalls(calls).at(-1)!.args.query).toMatchObject({ counts: "true", activity: "true", page: "1", pageSize: "20" });
    const chips = within(screen.getByRole("group", { name: "Status" }));
    for (const name of ["All", "Draft", "Awaiting approval", "Approved", "Sent", "Accepted", "Declined", "Expired"]) expect(chips.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: /^Sent/ })).toHaveTextContent("2");
  });

  it("a chip filters on the server: Sent excludes the derived Expired ones, Expired is its own filter", async () => {
    const { user, calls } = view();
    await openAllQuotes(user);
    await screen.findByText("Q-2026-0001 · v1");
    await user.click(screen.getByRole("button", { name: /^Sent/ }));
    await waitFor(() => expect(listCalls(calls).at(-1)!.args.query).toMatchObject({ status: "SENT", expired: "exclude", page: "1" }));
    await user.click(screen.getByRole("button", { name: /^Expired/ }));
    await waitFor(() => expect(listCalls(calls).at(-1)!.args.query).toMatchObject({ expired: "only" }));
    expect(listCalls(calls).at(-1)!.args.query).not.toHaveProperty("status");
    await user.click(screen.getByRole("button", { name: /^Declined/ }));
    await waitFor(() => expect(listCalls(calls).at(-1)!.args.query).toMatchObject({ status: "DECLINED" }));
    expect(listCalls(calls).at(-1)!.args.query).not.toHaveProperty("expired");
  });

  it("search, owner and the validity range are sent as the additive parameters, and Clear filters resets them", async () => {
    const { user, calls } = view();
    await openAllQuotes(user);
    await screen.findByText("Q-2026-0001 · v1");
    await user.type(screen.getByRole("searchbox", { name: "Search quotes" }), "Kij");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Owner" }), "m-mg");
    await user.type(screen.getByLabelText("Valid from"), "2026-12-01");
    await user.type(screen.getByLabelText("Valid to"), "2026-12-31");
    await waitFor(() => expect(listCalls(calls).at(-1)!.args.query).toMatchObject({ q: "Kij", owner: "m-mg", validFrom: "2026-12-01", validTo: "2026-12-31" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    // The empty filter set is the first request again (answered from the cache), so the proof is the controls, not a new call.
    expect(screen.getByRole("searchbox", { name: "Search quotes" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("");
    expect(screen.getByLabelText("Valid from")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("a salesperson (own quotes only) has no owner filter", async () => {
    const { user } = view({}, SALES);
    await openAllQuotes(user);
    await screen.findByText("Q-2026-0001 · v1");
    expect(screen.queryByRole("combobox", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("shows the sent, viewed and expired events the API recorded on the row", async () => {
    const { user } = view({
      getQuotes: (args) =>
        args.query?.dealId
          ? page([])
          : withCounts([row({ activity: { links: 2, activeLinks: 0, revokedLinks: 0, expiredLinks: 2, views: 3, lastViewedAt: "2026-11-05T09:00:00Z" } })]),
    });
    await openAllQuotes(user);
    expect(await screen.findByText(/Sent 2 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Viewed 3 times, last 5 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText("Link expired")).toBeInTheDocument();
  });

  it("an expired quote shows the Expired pill and its date in red, not its stored status", async () => {
    const { user } = view({ getQuotes: (args) => (args.query?.dealId ? page([]) : withCounts([row({ latest: summary({ expired: true, validUntil: "2026-10-01" }) })])) });
    await openAllQuotes(user);
    const table = within(await screen.findByRole("table", { name: "Quotes" }));
    expect(table.getByText("Expired")).toBeInTheDocument();
    expect(table.queryByText("Sent")).not.toBeInTheDocument();
  });
});

describe("Quotes page states", () => {
  it("no quotes at all: the explained empty state, with New quote for a role that may create", async () => {
    const { user } = view({ getQuotes: (args) => (args.query?.dealId ? page([]) : withCounts([], { ...COUNTS, ALL: 0 })) });
    await openAllQuotes(user);
    expect(await screen.findByText("No quotes yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New quote" }).length).toBe(2);
  });

  it("filters that match nothing say so and offer Clear filters (not the empty state)", async () => {
    const { user } = view({ getQuotes: (args) => (args.query?.dealId ? page([]) : withCounts([])) });
    await openAllQuotes(user);
    await user.type(screen.getByRole("searchbox", { name: "Search quotes" }), "zzz");
    expect(await screen.findByText("No quote matches these filters")).toBeInTheDocument();
    expect(screen.queryByText("No quotes yet")).not.toBeInTheDocument();
  });

  it("a failed list shows the retryable failure, not an empty table", async () => {
    const { user } = view({ getQuotes: (args) => (args.query?.dealId ? page([]) : apiError(500, "boom")) });
    await openAllQuotes(user);
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("masked totals: only Hidden is shown, with a note; no amount, anywhere on the page", async () => {
    const { user } = view(
      { getQuotes: (args) => (args.query?.dealId ? page([]) : withCounts([row({ latest: summary({ amountMasked: true, total: null, subtotal: null }) })])) },
      FINANCE_NO_VALUE,
    );
    await openAllQuotes(user);
    expect(await screen.findByText("Hidden")).toBeInTheDocument();
    expect(screen.getByText(/Totals are hidden for your role/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/KES\s?\d/);
    // Chips carry counts of quotes, never money.
    expect(screen.getByRole("group", { name: "Status" })).not.toHaveTextContent(/KES/);
  });

  it("Finance (quotes.view, no create) can read the list but gets no New quote and no share", async () => {
    const { user, calls } = view({}, FINANCE_NO_VALUE);
    await openAllQuotes(user);
    await screen.findByText("Q-2026-0001 · v1");
    expect(screen.queryByRole("button", { name: "New quote" })).not.toBeInTheDocument();
    expect(screen.getByText("Quotes are created by Sales and Management")).toBeInTheDocument();
    expect(listCalls(calls).length).toBeGreaterThan(0);
  });

  it("a role with none of the quote permissions gets the explained no-access and asks for nothing", async () => {
    const { calls } = view({}, ["reporting.view.own"]);
    expect(await screen.findByRole("region", { name: /Quotes/ })).toBeInTheDocument();
    expect(calls.filter((c) => c.id === "getQuotes" || c.id === "getDeals")).toHaveLength(0);
  });
});

describe("Quotes page saved views", () => {
  const SAVED = { id: "v1", entity: "quotes", name: "Sent this month", scope: "PERSONAL", filters: { tab: "SENT", q: "Kij", owner: "" }, mine: true, ownerName: "Test Member", canEdit: true, pinned: false, pinPosition: null };

  it("lists the views of the quotes list and applies one: the chip and the filters come back", async () => {
    const { user, calls } = view({ getViews: () => ({ items: [SAVED] }) });
    await openAllQuotes(user);
    await user.click(await screen.findByRole("button", { name: /Sent this month/ }));
    await waitFor(() => expect(listCalls(calls).at(-1)!.args.query).toMatchObject({ status: "SENT", expired: "exclude", q: "Kij" }));
    expect(calls.find((c) => c.id === "getViews")!.args.query).toMatchObject({ entity: "quotes" });
  });

  it("Save as view stores the chip as the tab and only the filters that are set", async () => {
    const { user, calls } = view({ postViews: () => ({ ...SAVED, id: "v2", name: "Mine" }) });
    await openAllQuotes(user);
    await user.click(await screen.findByRole("button", { name: /^Draft/ }));
    await user.click(await screen.findByRole("button", { name: "Save as view" }));
    await user.type(screen.getByLabelText("Name for this view"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postViews")?.args.body).toEqual({ entity: "quotes", name: "Mine", filters: { tab: "DRAFT" } }));
  });
});

describe("New quote (UC-R4)", () => {
  const COMPANY = { id: "c1", name: "Kijani Foods" };
  const picker = (handlers: Record<string, Handler> = {}, keys = SALES) =>
    view(
      {
        getCompanies: () => page([COMPANY, { id: "c2", name: "Savannah" }]),
        getDeals: (args) => (args.query?.companyId ? page([deal({ id: "d1", company: "Kijani Foods", stage: STAGES[1]! })]) : page([])),
        ...handlers,
      },
      keys,
    );

  it("customer, then deal, then the existing builder on that deal", async () => {
    const { user, calls } = picker();
    await user.click(await screen.findByRole("button", { name: "New quote" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search customers" }), "Kij");
    await waitFor(() => expect(calls.some((c) => c.id === "getCompanies" && c.args.query?.q === "Kij")).toBe(true));
    await user.click(await screen.findByRole("button", { name: /Kijani Foods/ }));
    expect(await screen.findByRole("heading", { name: "Which deal is it for?" })).toBeInTheDocument();
    expect(calls.filter((c) => c.id === "getDeals").at(-1)!.args.query).toMatchObject({ companyId: "c1", outcome: "OPEN" });
    expect(screen.getByRole("button", { name: "Continue to the quote builder" })).toHaveAttribute("aria-disabled", "true");
    await user.click(await screen.findByRole("radio", { name: /Inventory system/ }));
    expect(screen.getByRole("radio", { name: /Inventory system/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Continue to the quote builder" }));
    expect(push).toHaveBeenCalledWith("/o/figbloom/quotes/d1");
  });

  it("a customer with no open deal says so and offers to create one (for a role that may)", async () => {
    const { user } = picker({ getDeals: (args) => (args.query?.companyId ? page([]) : page([])) });
    await user.click(await screen.findByRole("button", { name: "New quote" }));
    await user.click(await screen.findByRole("button", { name: /Kijani Foods/ }));
    expect(await screen.findByText("This customer has no open deal you can quote on.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create a new deal for this customer/ })).toBeInTheDocument();
  });

  it("creating a deal for the chosen customer opens the builder on the new deal", async () => {
    const { user, calls } = picker({ getDeals: (args) => (args.query?.companyId ? page([]) : page([])), postDeals: () => ({ id: "dNew" }) });
    await user.click(await screen.findByRole("button", { name: "New quote" }));
    await user.click(await screen.findByRole("button", { name: /Kijani Foods/ }));
    await user.click(await screen.findByRole("button", { name: /Create a new deal for this customer/ }));
    await user.click(await screen.findByRole("button", { name: "Create deal" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postDeals")).toBe(true));
    expect(calls.find((c) => c.id === "postDeals")!.args.body).toMatchObject({ companyId: "c1" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/figbloom/quotes/dNew"));
  });

  it("a deal's value is shown only when the API did not mask it", async () => {
    const masked = deal({ id: "d1", company: "Kijani Foods", stage: STAGES[1]!, valueMasked: true, value: null });
    const { user } = picker({ getDeals: (args) => (args.query?.companyId ? page([masked]) : page([])) });
    await user.click(await screen.findByRole("button", { name: "New quote" }));
    await user.click(await screen.findByRole("button", { name: /Kijani Foods/ }));
    await screen.findByRole("radio", { name: /Inventory system/ });
    expect(screen.getByRole("dialog").textContent).not.toMatch(/KES\s?\d/);
  });

  it("Back returns to the customer step", async () => {
    const { user } = picker();
    await user.click(await screen.findByRole("button", { name: "New quote" }));
    await user.click(await screen.findByRole("button", { name: /Kijani Foods/ }));
    await user.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Who is this quote for?" })).toBeInTheDocument();
  });
});

describe("Share panel (UC-R4)", () => {
  const SENT_LINK = { link: "https://crm.example/q/abc", signLink: null, share: { id: "s1", recipientEmail: null, expiresAt: "2026-12-30T00:00:00Z" } };
  const open = async (over: Record<string, unknown> = {}, handlers: Record<string, Handler> = {}, keys = SALES) => {
    const r = view(
      {
        getQuotes: (args) => (args.query?.dealId ? page([]) : withCounts([row({ latest: summary({ status: "APPROVED", locked: false, sentAt: null, ...over }) })])),
        postQuotesByQuoteIdVersionsByVersionSend: () => SENT_LINK,
        ...handlers,
      },
      keys,
    );
    await openAllQuotes(r.user);
    await r.user.click(await screen.findByRole("button", { name: "Q-2026-0001 · v1" }));
    await screen.findByTestId("quote-drawer");
    return r;
  };
  const sends = (calls: { id: string; args: { body?: unknown } }[]) => calls.filter((c) => c.id === "postQuotesByQuoteIdVersionsByVersionSend");

  it("Send email uses the existing send (the typed address, or the deal's contact when empty)", async () => {
    const { user, calls } = await open();
    await user.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0]!.args.body).toEqual({});
    await user.type(screen.getByLabelText("Email to"), "buyer@kijani.example");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(sends(calls)).toHaveLength(2));
    expect(sends(calls)[1]!.args.body).toEqual({ to: "buyer@kijani.example" });
  });

  it("Copy link makes the link without an email (channel link), copies it, and shows it", async () => {
    const { user, calls } = await open();
    // user-event installs its own clipboard when it is set up, so the spy goes in after that.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SENT_LINK.link));
    expect(sends(calls)[0]!.args.body).toEqual({ channel: "link" });
    expect(screen.getByLabelText("Share link")).toHaveValue(SENT_LINK.link);
  });

  it("WhatsApp opens click-to-chat with the link, and reuses the link a Copy link already made", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const { user, calls } = await open();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await screen.findByLabelText("Share link");
    await user.click(screen.getByRole("button", { name: "WhatsApp" }));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    const url = String(opened.mock.calls[0]![0]);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain(SENT_LINK.link);
    expect(sends(calls)).toHaveLength(1);
    opened.mockRestore();
  });

  it.each([
    ["a draft", { status: "DRAFT" }, /drafts cannot be shared/],
    ["an expired quote", { status: "SENT", expired: true }, /passed its validity date/],
    ["a quote with hidden amounts", { amountMasked: true, total: null }, /needs the right to see its amounts/],
  ] as const)("explains why %s cannot be shared and offers no share buttons", async (_name, over, text) => {
    await open(over as Record<string, unknown>);
    expect(within(screen.getByTestId("quote-drawer")).getByRole("note")).toHaveTextContent(text);
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument();
  });

  it("a role that can read but not send sees the quote and the reason, never the share buttons", async () => {
    await open({}, {}, FINANCE_NO_VALUE);
    expect(within(screen.getByTestId("quote-drawer")).getByRole("note")).toHaveTextContent(/read quotes but not send/);
    expect(screen.queryByRole("button", { name: "Send email" })).not.toBeInTheDocument();
  });

  it("the drawer lists the links and events the API recorded, and revokes a working link", async () => {
    const { user, calls } = await open({}, {
      getQuotesByQuoteIdVersionsByVersionActivity: () => ({
        shares: [{ id: "s9", active: true, expiresAt: "2026-12-30T00:00:00Z", revokedAt: null, createdAt: "2026-11-02T08:00:00Z" }],
        events: [{ id: "e1", type: "SENT", shareId: "s9", occurredAt: "2026-11-02T08:00:00Z" }, { id: "e2", type: "VIEWED", shareId: "s9", occurredAt: "2026-11-03T08:00:00Z" }],
      }),
      postQuotesByQuoteIdSharesByShareIdRevoke: () => ({ id: "s9" }),
    });
    expect(await screen.findByText("Opened by the client")).toBeInTheDocument();
    expect(screen.getByText("Sent with a secure link")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postQuotesByQuoteIdSharesByShareIdRevoke" && c.args.params?.shareId === "s9")).toBe(true));
  });
});
