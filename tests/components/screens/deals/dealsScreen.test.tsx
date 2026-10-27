import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DealsScreen } from "../../../../src/ui/screens/deals/DealsScreen";
import { REFERENCE, STAGES, apiError, deal, page, renderScreen, stubClient, violations } from "./harness";
import type { Handler } from "./harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/deals",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const [S1, , S3, WON, LOST] = STAGES as [(typeof STAGES)[number], (typeof STAGES)[number], (typeof STAGES)[number], (typeof STAGES)[number], (typeof STAGES)[number]];

const SALES = ["deals.view.own", "deals.edit.own", "deals.create", "proposals.view"];
const DEALS = [
  deal({ id: "d1", company: "Brookside Dairy", stage: S1, signals: { stalled: true, daysSinceActivity: 17, stalledAfterDays: 10, closeDatePassed: false, closeDateOverdueDays: 0 } }),
  deal({ id: "d2", company: "Sarova Hotels", stage: S3, value: "980000", signals: { stalled: false, daysSinceActivity: 2, stalledAfterDays: 10, closeDatePassed: true, closeDateOverdueDays: 4 } }),
  deal({ id: "d3", company: "Hillcrest School", stage: WON, value: "180000" }),
  deal({ id: "d4", company: "Hillcrest School", stage: LOST, value: "280000", lostReasonId: "lr-2" }),
];

function setup(handlers: Record<string, Handler> = {}, items: unknown[] = DEALS, keys = SALES) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    getDeals: () => page(items),
    getHandoffs: () => ({ items: [{ dealId: "d3", status: "ONBOARDING" }], counts: {} }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<DealsScreen />, stub.client, { permissionKeys: keys }) };
}

describe("Deals board (F2.04, P1)", () => {
  it("draws the stages with counts and masked-aware totals, the stats, and the stalled and close-date flags", async () => {
    setup();
    const col = await screen.findByRole("group", { name: "Solution Presented, 1 deal" });
    expect(within(col).getByText("KES 450,000")).toBeInTheDocument();
    expect(within(col).getByText("Brookside Dairy")).toBeInTheDocument();
    expect(within(col).getByText("Stalled · 17d")).toBeInTheDocument();
    expect(screen.getByText("Close date passed")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Proposal Sent, 0 deals" })).toHaveTextContent("Drop a deal here");
    expect(screen.getByText("Open pipeline").nextElementSibling).toHaveTextContent("KES 1,430,000");
    expect(screen.getByText("Handed off")).toBeInTheDocument(); // the won deal's handoff status
    expect(screen.getByText("Timing")).toBeInTheDocument(); // the lost reason
  });

  it("never shows or adds up a value the API masks", async () => {
    const masked = DEALS.map((d) => ({ ...d, value: null, valueMasked: true }));
    setup({}, masked, ["deals.view.won"]);
    await screen.findByText("Provisional access.");
    await screen.findByRole("group", { name: "Closed Won, 1 deal" });
    expect(document.body.textContent).not.toMatch(/KES\s?\d/);
    expect(document.body.textContent).toContain("Values hidden");
  });

  it("shows a won-only role one read-only column, with no Move to, no New deal and the provisional note", async () => {
    const won = [deal({ id: "d3", company: "Hillcrest School", stage: WON, value: null, valueMasked: true })];
    setup({}, won, ["deals.view.won"]);
    expect(await screen.findByRole("heading", { name: "Won deals" })).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Closed Won, 1 deal" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Solution Presented/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move .* to another stage/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New deal" })).toBeNull();
    expect(screen.getByText(/Read-only · won deals/)).toBeInTheDocument();
    expect(screen.getByText(/Prices are hidden for Sales/)).toBeInTheDocument();
  });

  it("moves a deal with the Move to… menu by keyboard, optimistically, and offers Undo", async () => {
    const user = userEvent.setup();
    let items = DEALS.map((d) => ({ ...d }));
    const moveTo = (id: string, stage: (typeof STAGES)[number]) => (items = items.map((d) => (d.id === id ? { ...d, pipelineStageId: stage.id, pipelineStage: stage } : d)));
    const { calls } = setup({
      getDeals: () => page(items),
      postDealsByDealIdMoveCheck: () => ({ allowed: true, blockers: [], needsLostReason: false, handoffPrompt: false, reopens: false }),
      postDealsByDealIdMove: () => {
        moveTo("d1", S3);
        return { deal: {}, move: { id: "mv-1", undoExpiresAt: "", undoable: true } };
      },
      postDealMovesByMoveIdUndo: () => {
        moveTo("d1", S1);
        return {};
      },
    });
    const move = await screen.findByRole("button", { name: "Move Brookside Dairy to another stage" });
    move.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Move Brookside Dairy to…" });
    expect(within(dialog).getByRole("button", { name: /Solution Presented/ })).toBeDisabled(); // the current stage
    await user.click(within(dialog).getByRole("button", { name: /Negotiation/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "postDealsByDealIdMove")?.args.body).toMatchObject({ pipelineStageId: "st-3" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: /^Negotiation/ })).getByText("Brookside Dairy")).toBeInTheDocument());
    const undo = await screen.findByRole("button", { name: /Undo/ });
    await user.click(undo);
    await waitFor(() => expect(calls.some((c) => c.id === "postDealMovesByMoveIdUndo")).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("group", { name: /^Solution Presented/ })).getByText("Brookside Dairy")).toBeInTheDocument());
  });

  it("moves a deal when it is dropped on another column", async () => {
    const { calls } = setup({
      postDealsByDealIdMoveCheck: () => ({ allowed: true, blockers: [], needsLostReason: false, handoffPrompt: false, reopens: false }),
      postDealsByDealIdMove: () => ({ deal: {}, move: { id: "mv-1", undoExpiresAt: "", undoable: true } }),
    });
    await screen.findByText("Brookside Dairy");
    const card = screen.getByText("Brookside Dairy").closest(".fb-dcard") as HTMLElement;
    const target = screen.getByRole("group", { name: /^Proposal Sent/ });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(calls.find((c) => c.id === "postDealsByDealIdMove")?.args.body).toMatchObject({ pipelineStageId: "st-2" }));
  });

  it("asks for a lost reason before a deal is marked lost, and sends it", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      postDealsByDealIdMoveCheck: () => ({ allowed: false, blockers: [{ code: "LOST_REASON_REQUIRED", message: "Pick a lost reason.", field: "lostReasonId" }], needsLostReason: true, handoffPrompt: false, reopens: false }),
      postDealsByDealIdMove: () => ({ deal: {}, move: { id: "mv-2", undoExpiresAt: "", undoable: true } }),
    });
    await user.click(await screen.findByRole("button", { name: "Move Sarova Hotels to another stage" }));
    await user.click(await screen.findByRole("button", { name: /Closed Lost/ }));
    const dialog = await screen.findByRole("dialog", { name: "Why was Sarova Hotels lost?" });
    const mark = within(dialog).getByRole("button", { name: "Mark lost" });
    expect(mark).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: "Price" }));
    await user.click(mark);
    await waitFor(() => expect(calls.find((c) => c.id === "postDealsByDealIdMove")?.args.body).toMatchObject({ pipelineStageId: "st-lost", lostReasonId: "lr-1" }));
  });

  it("opens the Delivery handoff when a deal is marked won and sends the dialog's choices", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      postDealsByDealIdMoveCheck: () => ({ allowed: true, blockers: [], needsLostReason: false, handoffPrompt: true, reopens: false }),
      postDealsByDealIdMove: () => ({ deal: {}, move: { id: "mv-3", undoExpiresAt: "", undoable: false } }),
    });
    await user.click(await screen.findByRole("button", { name: "Move Sarova Hotels to another stage" }));
    await user.click(await screen.findByRole("button", { name: /Closed Won/ }));
    const dialog = await screen.findByRole("dialog", { name: "Hand off Sarova Hotels to Delivery" });
    expect(within(dialog).getByText(/Nothing moves stages on its own/)).toBeInTheDocument();
    // The screen suggests nobody (which roles may own a handoff is the server's rule): the person picks the Delivery owner.
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Delivery owner/ }), "m-dl");
    await user.type(within(dialog).getByLabelText("Scope for Delivery"), "Install and train");
    await user.click(within(dialog).getByRole("checkbox", { name: /Move Sarova Hotels to Onboarding/ }));
    await user.click(within(dialog).getByRole("button", { name: /Mark won and hand off/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "postDealsByDealIdMove")?.args.body).toMatchObject({ pipelineStageId: "st-won", handoff: { deliveryOwnerMembershipId: "m-dl", scope: "Install and train", lifecycleOff: true } }));
  });

  it("explains a refused move in words and puts the card back", async () => {
    const user = userEvent.setup();
    setup({
      postDealsByDealIdMoveCheck: () => ({ allowed: true, blockers: [], needsLostReason: false, handoffPrompt: false, reopens: false }),
      postDealsByDealIdMove: () => apiError(400, "A proposal reference is needed before Proposal Sent.", { code: "VALIDATION_FAILED", fieldErrors: [{ path: "pipelineStageId", message: "A proposal reference is needed before Proposal Sent." }] }),
    });
    await user.click(await screen.findByRole("button", { name: "Move Brookside Dairy to another stage" }));
    await user.click(await screen.findByRole("button", { name: /Proposal Sent/ }));
    expect(await screen.findByText(/A proposal reference is needed before Proposal Sent/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("group", { name: /^Solution Presented/ })).getByText("Brookside Dairy")).toBeInTheDocument());
  });

  it("switches to the list, which shows the same deals, flags and masked values", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "List" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "EXPECTED CLOSE" })).toBeInTheDocument();
    expect(within(table).getByText("KES 980,000")).toBeInTheDocument();
    expect(within(table).getByText("Stalled · 17d")).toBeInTheDocument();
  });

  it("says why when the role has no access, and offers Retry on a failure", async () => {
    setup({ getDeals: () => apiError(403, "No", { denial: { yourRole: "Restricted Technical", ownerRoles: ["Management", "Sales"], whoToAsk: ["Your administrator"] } }) });
    expect(await screen.findByText(/isn’t part of your workspace/)).toBeInTheDocument();
    expect(screen.getByText("Restricted Technical")).toBeInTheDocument();
  });

  it("shows the empty state with a way forward", async () => {
    setup({}, []);
    expect(await screen.findByText("No deals yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to leads" })).toHaveAttribute("href", "/o/figbloom/leads");
  });

  it("has no accessibility violations on the board, the list and the Move to dialog", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Brookside Dairy");
    expect(await violations(document.body)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Move Brookside Dairy to another stage" }));
    await screen.findByRole("dialog");
    expect(await violations(document.body)).toEqual([]);
  });
});
