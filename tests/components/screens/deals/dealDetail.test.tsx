import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DealDetailScreen } from "../../../../src/ui/screens/deals/DealDetailScreen";
import { REFERENCE, STAGES, apiError, deal, renderScreen, stubClient, violations } from "./harness";
import type { Handler } from "./harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/deals/d1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const S2 = STAGES[1]!;
const WON = STAGES[3]!;
const SALES = ["deals.view.own", "deals.edit.own", "deals.archive.own", "deals.create", "proposals.view", "proposals.manage", "activities.view", "activities.create", "tasks.view.own", "tasks.create", "contacts.view", "companies.view"];

function detail(over: Record<string, unknown> = {}) {
  return {
    ...deal({ id: "d1", company: "Brookside Dairy", stage: S2 }),
    tags: [],
    primaryContact: { id: "p1", firstName: "Chebet", lastName: "Kiprono", jobTitle: "Supply Chain Manager", phone: "+254712345605" },
    lostReason: null,
    archived: false,
    scope: "own",
    ...over,
  };
}

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const PROPOSAL = { id: "pr-1", proposalNumber: "P-2026-014", status: "SENT", amount: "450000", currency: "KES", sentAt: iso(7), respondedAt: null, documentReference: "Drive / Proposals / Brookside.pdf", updatedAt: iso(7), amountMasked: false };

function setup(handlers: Record<string, Handler> = {}, keys = SALES, d: Record<string, unknown> = detail()) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    getDeal: () => d,
    getDealsByDealIdProposals: () => [PROPOSAL],
    getActivities: () => ({ items: [{ id: "a1", type: "CALL", subject: "Call · Reached", description: "Agreed to review the quote", occurredAt: iso(1), outcome: "Reached", authorMembershipId: "m-1" }] }),
    getTasks: () => ({ items: [{ id: "t1", title: "Send revised quote", dueAt: iso(1), status: "PENDING", assigneeName: "Dev Sales" }] }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<DealDetailScreen dealId="d1" />, stub.client, { permissionKeys: keys }) };
}

describe("Deal detail (F2.05, P2)", () => {
  it("shows the header, stage stepper, summary, proposals, timeline, contact and tasks", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 })).toBeInTheDocument();
    const steps = screen.getByRole("region", { name: "Deal stages" });
    expect(within(steps).getByRole("button", { name: "Proposal Sent" })).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByRole("button", { name: "Negotiation" })).toBeEnabled();
    expect(screen.getByText("Figbloom never moves a deal on its own. Won opens the Delivery handoff; Lost asks for a reason.")).toBeInTheDocument();
    const proposals = await screen.findByRole("table", { name: "Proposals on this deal" });
    expect(within(proposals).getByText("P-2026-014")).toBeInTheDocument();
    expect(within(proposals).getByText("KES 450,000")).toBeInTheDocument();
    expect(await screen.findByText(/Call · Reached/)).toBeInTheDocument();
    expect(screen.getByText("Chebet Kiprono")).toBeInTheDocument();
    expect(await screen.findByText("Send revised quote")).toBeInTheDocument();
  });

  it("never shows a value or an amount the API masks, in the header, summary, proposals or tasks", async () => {
    setup({ getDealsByDealIdProposals: () => [{ ...PROPOSAL, amount: null, amountMasked: true }] }, SALES, detail({ value: null, valueMasked: true }));
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    await screen.findByRole("table", { name: "Proposals on this deal" });
    expect(document.body.textContent).not.toMatch(/KES\s?\d/);
    expect(screen.getAllByText("Values hidden").length).toBeGreaterThan(0);
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("is read-only when archived: a banner, no actions, a disabled stepper, and Restore for those who may", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postDealsByDealIdRestore: () => ({}) }, SALES, detail({ archivedAt: "2026-10-01T00:00:00.000Z", archived: true }));
    expect(await screen.findByText(/This deal is read-only until it’s restored/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark won" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Deal stages" })).getByRole("button", { name: "Negotiation" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postDealsByDealIdRestore")).toBe(true));
  });

  it("is read-only for a role that may not edit, with the explanation of its scope", async () => {
    setup({}, ["deals.view.won"], detail({ pipelineStageId: WON.id, pipelineStage: WON, outcome: "WON", value: null, valueMasked: true }));
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to…" })).toBeNull();
    expect(screen.getByRole("link", { name: /Won deals/ })).toHaveAttribute("href", "/o/figbloom/deals");
    expect(screen.queryByRole("heading", { name: "Proposals" })).toBeNull(); // proposals.view is not part of this role
  });

  it("shows the stalled banner and lets the person log activity", async () => {
    const user = userEvent.setup();
    const { calls } = setup(
      { postActivities: () => ({}), postTasks: () => ({}) },
      SALES,
      detail({ signals: { stalled: true, daysSinceActivity: 17, stalledAfterDays: 10, closeDatePassed: true, closeDateOverdueDays: 3 } }),
    );
    expect(await screen.findByText(/Stalled: no activity for 17 days/)).toBeInTheDocument();
    await user.click(within(screen.getByText(/Stalled: no activity/).closest(".fb-dnotice") as HTMLElement).getByRole("button", { name: "Log activity" }));
    const drawer = await screen.findByRole("dialog", { name: "Log a call or note" });
    await user.click(within(drawer).getByRole("button", { name: "Interested" }));
    await user.type(within(drawer).getByLabelText("Note"), "Wants a revised quote");
    await user.type(within(drawer).getByLabelText("Next action"), "Send revised quote");
    await user.click(within(drawer).getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postActivities")?.args.body).toMatchObject({ type: "CALL", dealId: "d1", outcome: "Interested", description: "Wants a revised quote" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postTasks")?.args.body).toMatchObject({ title: "Send revised quote", dealId: "d1" }));
  });

  it("shows the proposal follow-up reminder and snoozing it puts a follow-up task on the list (FIG-795)", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postTasks: () => ({}) });
    const reminder = await screen.findByRole("status", { name: "Proposal follow-up reminder" });
    expect(reminder).toHaveTextContent("No answer to proposal P-2026-014 for 7 days.");
    await user.selectOptions(within(reminder).getByLabelText("Snooze the reminder"), "3");
    await waitFor(() => expect(calls.find((c) => c.id === "postTasks")?.args.body).toMatchObject({ title: "Follow up on proposal P-2026-014", dealId: "d1" }));
  });

  it("shows the reminder as snoozed while a follow-up task is waiting", async () => {
    setup({ getTasks: () => ({ items: [{ id: "t9", title: "Follow up on proposal P-2026-014", dueAt: new Date(NOW + 3 * 86_400_000).toISOString(), status: "PENDING", assigneeName: "Dev Sales" }] }) });
    expect(await screen.findByText("Follow-up snoozed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Snooze the reminder")).toBeNull();
  });

  it("moves the deal through the stepper with the same checks as the board", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      postDealsByDealIdMoveCheck: () => ({ allowed: true, blockers: [], needsLostReason: false, handoffPrompt: true, reopens: false }),
      postDealsByDealIdMove: () => ({ deal: {}, move: { id: "mv", undoExpiresAt: "", undoable: false } }),
    });
    await screen.findByRole("heading", { name: "Brookside Dairy", level: 1 });
    await user.click(screen.getByRole("button", { name: "Mark won" }));
    await screen.findByRole("dialog", { name: "Hand off Brookside Dairy to Delivery" });
    expect(calls.find((c) => c.id === "postDealsByDealIdMoveCheck")?.args.body).toMatchObject({ pipelineStageId: "st-won" });
  });

  it("adds a proposal reference", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postDealsByDealIdProposals: () => ({}) });
    await user.click(await screen.findByRole("button", { name: "+ Add proposal reference" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a proposal reference" });
    await user.type(within(dialog).getByLabelText("Proposal number"), "P-2026-015");
    await user.click(within(dialog).getByRole("button", { name: "Add proposal" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postDealsByDealIdProposals")?.args.body).toMatchObject({ proposalNumber: "P-2026-015" }));
  });

  it("explains a deal the role cannot open, and a deal that is not found", async () => {
    setup({ getDeal: () => apiError(403, "No", { denial: { yourRole: "Sales", ownerRoles: ["Management"], whoToAsk: ["Your manager"] } }) });
    expect(await screen.findByText(/isn’t part of your workspace/)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    setup();
    await screen.findByText(/Call · Reached/);
    await screen.findByText("Send revised quote");
    expect(await violations(document.body)).toEqual([]);
  });
});
