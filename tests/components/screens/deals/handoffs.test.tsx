import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HandoffsScreen } from "../../../../src/ui/screens/deals/HandoffsScreen";
import { REFERENCE, STAGES, apiError, deal, renderScreen, stubClient, violations } from "./harness";
import type { Handler } from "./harness";

const replace = vi.fn();
const search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/handoffs",
  useRouter: () => ({ push: vi.fn(), replace: (...a: unknown[]) => replace(...a), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

const WON = STAGES[3]!;
const ROWS = [
  { id: "h1", dealId: "d1", status: "AWAITING_OWNER", company: { id: "c1", name: "Sarova Hotels" }, service: { id: "s", name: "CCTV" }, deliveryOwner: null, startDate: "2026-11-02T00:00:00.000Z", createdAt: "2026-10-20T00:00:00.000Z", deliveredAt: null, deliverables: [] },
  { id: "h2", dealId: "d2", status: "ONBOARDING", company: { id: "c2", name: "Hillcrest School" }, service: { id: "s", name: "Website" }, deliveryOwner: { membershipId: "m-dl", name: "Dev Delivery" }, startDate: "2026-11-05T00:00:00.000Z", createdAt: "2026-10-18T00:00:00.000Z", deliveredAt: null, deliverables: [] },
  { id: "h3", dealId: "d3", status: "DELIVERED", company: { id: "c3", name: "Twiga Foods" }, service: { id: "s", name: "POS" }, deliveryOwner: { membershipId: "m-dl", name: "Dev Delivery" }, startDate: "2026-10-01T00:00:00.000Z", createdAt: "2026-09-20T00:00:00.000Z", deliveredAt: "2026-10-15T00:00:00.000Z", deliverables: [] },
];

function view(over: Record<string, unknown> = {}, can: Partial<Record<"take" | "edit" | "markDelivered" | "reopen", boolean>> = {}) {
  return {
    handoff: {
      id: "h1",
      dealId: "d1",
      status: "AWAITING_OWNER",
      deliveryOwner: null,
      team: [],
      startDate: "2026-11-02T00:00:00.000Z",
      scope: "Install 12 cameras and train staff.",
      requirements: "Site survey done\nPower at each pole",
      deliverables: [{ title: "Site survey", done: true }, { title: "Install", done: false }],
      createdAt: "2026-10-20T00:00:00.000Z",
      company: { id: "c1", name: "Sarova Hotels" },
      tasks: [{ id: "t1", title: "Kick-off call with the client", status: "PENDING", dueAt: "2026-11-04T08:00:00.000Z", assigneeMembershipId: "m-dl" }],
      can: { take: true, edit: false, markDelivered: false, reopen: false, ...can },
      ...over,
    },
  };
}

function setup(handlers: Record<string, Handler> = {}, keys = ["handoff.manage", "deals.view.won", "tasks.view.own"], rows = ROWS, v = view()) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    getHandoffs: () => ({ items: rows, page: 1, pageSize: 100, total: rows.length, pageCount: 1, nextCursor: null, counts: { AWAITING_OWNER: 1, ONBOARDING: 1, DELIVERED: 1 } }),
    getDealsByDealIdHandoff: () => v,
    getDeal: () => ({ ...deal({ id: "d1", company: "Sarova Hotels", stage: WON, value: null, valueMasked: true }), primaryContact: { firstName: "Amara", lastName: "Osei" } }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<HandoffsScreen />, stub.client, { permissionKeys: keys, roleName: "Delivery" }) };
}

describe("Delivery Handoffs (F2.06, P4)", () => {
  it("lists the handoffs with their status and opens the first in the receiving view, without prices", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Handoffs" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("Awaiting owner")).toBeInTheDocument();
    const view = await screen.findByRole("region", { name: "Handoff for Sarova Hotels" });
    expect(within(view).getByText("Pricing not shown for Delivery")).toBeInTheDocument();
    expect(within(view).getByText("Install 12 cameras and train staff.")).toBeInTheDocument();
    expect(within(view).getByText("Site survey done")).toBeInTheDocument();
    expect(within(view).getByText("Kick-off call with the client")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/KES\s?\d/);
  });

  it("filters by status with the counts", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("list", { name: "Handoffs" });
    await user.click(screen.getByRole("tab", { name: /Onboarding/ }));
    const list = screen.getByRole("list", { name: "Handoffs" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Hillcrest School")).toBeInTheDocument();
  });

  it("selecting a handoff updates the address", async () => {
    const user = userEvent.setup();
    setup();
    await user.click((await screen.findByText("Hillcrest School")).closest("button")!);
    expect(replace).toHaveBeenCalledWith("/o/figbloom/handoffs?deal=d2", { scroll: false });
  });

  it("lets Delivery take an ownerless handoff, and only when the server says they may", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postDealsByDealIdHandoffTake: () => ({}) });
    await user.click(await screen.findByRole("button", { name: "Take ownership" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postDealsByDealIdHandoffTake")).toBe(true));
  });

  it("offers no actions when the server says the person may not take, edit or deliver", async () => {
    setup({}, ["deals.view.own"], ROWS, view({}, { take: false }));
    await screen.findByRole("region", { name: "Handoff for Sarova Hotels" });
    expect(screen.queryByRole("button", { name: "Take ownership" })).toBeNull();
    expect(screen.getByLabelText("Delivery status")).toBeDisabled();
    expect(screen.queryByLabelText("New deliverable")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Install" })).toBeDisabled();
  });

  it("marks a handoff delivered, and ticks deliverables, for the owner", async () => {
    const user = userEvent.setup();
    const { calls } = setup(
      { patchDealsByDealIdHandoff: () => ({}) },
      ["handoff.manage", "deals.view.won"],
      ROWS,
      view({ status: "ONBOARDING", deliveryOwner: { membershipId: "m-dl", name: "Dev Delivery" } }, { take: false, edit: true, markDelivered: true }),
    );
    await user.selectOptions(await screen.findByLabelText("Delivery status"), "DELIVERED");
    await waitFor(() => expect(calls.find((c) => c.id === "patchDealsByDealIdHandoff")?.args.body).toMatchObject({ status: "DELIVERED" }));
    await user.click(screen.getByRole("checkbox", { name: "Install" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.id === "patchDealsByDealIdHandoff").at(-1)?.args.body).toMatchObject({ deliverables: [{ title: "Site survey", done: true }, { title: "Install", done: true }] }),
    );
  });

  it("says so when there are no handoffs, and explains a refusal", async () => {
    setup({}, undefined, []);
    expect(await screen.findByText("No handoffs yet")).toBeInTheDocument();
  });

  it("explains a refusal in words", async () => {
    setup({ getHandoffs: () => apiError(403, "No", { denial: { yourRole: "Finance", ownerRoles: ["Delivery"], whoToAsk: ["Your manager"] } }) });
    expect(await screen.findByText(/isn’t part of your workspace/)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    setup();
    await screen.findByRole("region", { name: "Handoff for Sarova Hotels" });
    expect(await violations(document.body)).toEqual([]);
  });
});
