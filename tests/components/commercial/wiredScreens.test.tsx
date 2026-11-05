import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Approvals } from "../../../src/ui/screens/commercial/Approvals";
import { QuoteBuilder } from "../../../src/ui/screens/commercial/QuoteBuilder";
import { QuoteList } from "../../../src/ui/screens/commercial/QuoteList";
import { ApprovalRulesEditor } from "../../../src/ui/screens/settingsplus/ApprovalRules";
import { CatalogueEditor } from "../../../src/ui/screens/settingsplus/Catalogue";
import { PipelinesEditor } from "../../../src/ui/screens/settingsplus/Pipelines";
import { DealsScreen } from "../../../src/ui/screens/deals/DealsScreen";
import { REFERENCE, STAGES, apiError, deal, page, renderScreen, stubClient } from "../screens/deals/harness";
import type { Handler } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/quotes",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const MANAGER = ["quotes.create", "quotes.approve", "deals.margin", "deals.view.value", "catalogue.manage", "configuration.manage"];
const SALES = ["quotes.create", "deals.view.own", "deals.view.value"];

const summary = (over: Record<string, unknown> = {}) => ({
  version: 1, status: "DRAFT", locked: false, expired: false, discountPercent: 0, validUntil: "2026-12-30", currency: "KES",
  subtotal: 37000, discountAmount: 0, total: 37000, marginPct: 40, amountMasked: false, marginMasked: false,
  submittedAt: null, approvedAt: null, decisionReason: null, sentAt: null, respondedAt: null, createdAt: "2026-11-01T08:00:00Z", ...over,
});
const version = (over: Record<string, unknown> = {}) => ({
  ...summary(over), terms: "50% deposit", cost: 22000, approvalRequired: false,
  lines: [{ id: "l1", position: 1, catalogueItemId: "c1", description: "CCTV camera", unit: "camera", quantity: 2, taxable: true, unitPrice: 18500, lineTotal: 37000, unitCost: over.marginMasked ? null : 11000 }],
  ...over,
});
const DEAL = { ...deal({ id: "d1", company: "Kijani Foods", stage: STAGES[1]! }), primaryContact: null };
const quote = (v = summary()) => ({ id: "q1", number: "Q-2026-0001", dealId: "d1", currency: "KES", currentVersion: v.version, versions: [v] });
const CATALOGUE = page([{ id: "c1", name: "CCTV camera", unit: "camera", price: 18500, currency: "KES", cost: 11000, marginPct: 41, costMasked: false, status: "ACTIVE", kind: "PRODUCT", sku: null, description: null, taxable: true }]);

function builder(handlers: Record<string, Handler> = {}, keys = MANAGER) {
  const stub = stubClient({
    getDeal: () => DEAL,
    getDealsByDealIdQuote: () => quote(),
    getQuotesByQuoteIdVersionsByVersion: () => version(),
    getQuotesByQuoteIdVersionsByVersionActivity: () => ({ shares: [], events: [] }),
    getCatalogue: () => CATALOGUE,
    ...handlers,
  });
  return { ...stub, ...renderScreen(<QuoteBuilder dealId="d1" />, stub.client, { permissionKeys: keys }) };
}

describe("quote builder reads the real API (FIG-1168)", () => {
  it("shows the quote, its lines and totals from the API, and margin only when the API sends it", async () => {
    const { calls } = builder();
    expect(await screen.findByRole("heading", { name: "Quote Q-2026-0001" })).toBeInTheDocument();
    expect(calls.some((c) => c.id === "getQuotesByQuoteIdVersionsByVersion" && c.args.params?.version === "1")).toBe(true);
    expect(screen.getByLabelText("Quantity for CCTV camera")).toHaveValue(2);
    expect(screen.getByRole("columnheader", { name: "Margin" })).toBeInTheDocument();
    expect(screen.getByText("Margin (Management only)")).toBeInTheDocument();
    expect(screen.getAllByText("KES 37,000").length).toBeGreaterThan(0);
  });

  it("never shows or works out an amount, cost or margin the API masked", async () => {
    builder(
      { getQuotesByQuoteIdVersionsByVersion: () => version({ amountMasked: true, marginMasked: true, subtotal: null, discountAmount: null, total: null, marginPct: null, cost: null, lines: [{ id: "l1", position: 1, catalogueItemId: "c1", description: "CCTV camera", unit: "camera", quantity: 2, taxable: true, unitPrice: null, lineTotal: null, unitCost: null }] }) },
      SALES,
    );
    await screen.findByRole("heading", { name: "Quote Q-2026-0001" });
    expect(screen.queryByRole("columnheader", { name: "Margin" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Margin/)).not.toBeInTheDocument();
    // The catalogue list price in the "Add" picker is the catalogue's own (readable with quotes.create); the quote itself shows no figure.
    expect(screen.getByRole("table", { name: "Quote line items" }).textContent).not.toMatch(/KESs?d/);
    expect(screen.getByRole("complementary", { name: "Quote summary" }).textContent).not.toMatch(/KESs?d/);
    expect(screen.getByText("Amounts are hidden for your role.")).toBeInTheDocument();
  });

  it("a locked version is read-only and New version asks the API for the next draft", async () => {
    const { calls } = builder({
      getDealsByDealIdQuote: () => quote(summary({ status: "SENT", locked: true })),
      getQuotesByQuoteIdVersionsByVersion: () => version({ status: "SENT", locked: true }),
      postQuotesByQuoteIdVersions: () => version({ version: 2 }),
    });
    await screen.findByRole("heading", { name: "Quote Q-2026-0001" });
    expect(screen.getByLabelText("Quantity for CCTV camera")).toHaveAttribute("readonly");
    expect(screen.getByText(/cannot be changed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /New version/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "postQuotesByQuoteIdVersions")).toBe(true));
  });

  it("saves the draft, then asks for approval when the API says the discount needs it", async () => {
    const { calls } = builder({
      getQuotesByQuoteIdVersionsByVersion: () => version({ discountPercent: 12, approvalRequired: true }),
      putQuotesByQuoteIdVersionsByVersion: () => version({ discountPercent: 12, approvalRequired: true }),
      postQuotesByQuoteIdVersionsByVersionRequestApproval: () => ({ id: "ap1" }),
    });
    await screen.findByRole("heading", { name: "Quote Q-2026-0001" });
    const qty = screen.getByLabelText("Quantity for CCTV camera");
    await userEvent.clear(qty);
    await userEvent.type(qty, "3");
    await userEvent.click(screen.getByRole("button", { name: /Request approval/ }));
    await waitFor(() => expect(calls.some((c) => c.id === "postQuotesByQuoteIdVersionsByVersionRequestApproval")).toBe(true));
    const put = calls.find((c) => c.id === "putQuotesByQuoteIdVersionsByVersion")!;
    expect(put.args.body).toMatchObject({ lines: [{ lineId: "l1", quantity: 3 }], discountPercent: 12 });
    expect(calls.some((c) => c.id === "postQuotesByQuoteIdVersionsByVersionSend")).toBe(false);
  });

  it("a deal with no quote offers to start one", async () => {
    const { calls } = builder({ getDealsByDealIdQuote: () => apiError(404, "none"), postDealsByDealIdQuote: () => ({ quote: quote(), version: version() }) });
    await userEvent.click(await screen.findByRole("button", { name: "Start a quote" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postDealsByDealIdQuote")).toBe(true));
  });

  it("an organisation not on V1.1 gets the explained not-available state, not an error", async () => {
    builder({ getDealsByDealIdQuote: () => apiError(403, "off", { code: "FEATURE_UNAVAILABLE", feature: { key: "quotes.enabled", reason: "release", availableIn: "V1.1" } }) });
    expect(await screen.findByText("Quotes is not available yet")).toBeInTheDocument();
  });

  it("a role without quote permissions gets the explained no-access", async () => {
    builder({}, ["reporting.view.own"]);
    expect(await screen.findByRole("region", { name: /Quotes/ })).toBeInTheDocument();
  });
});

describe("quotes list reads the API", () => {
  it("lists quotes and open deals, hiding masked totals", async () => {
    const stub = stubClient({
      getQuotes: () => page([{ id: "q1", number: "Q-2026-0001", dealId: "d1", companyName: "Kijani Foods", currency: "KES", latest: summary({ amountMasked: true, total: null }), updatedAt: "2026-11-01T00:00:00Z" }]),
      getDeals: () => page([DEAL, deal({ id: "d2", company: "Savannah", stage: STAGES[0]! })]),
    });
    renderScreen(<QuoteList />, stub.client, { permissionKeys: SALES });
    expect(await screen.findByText("Q-2026-0001 · v1")).toBeInTheDocument();
    expect(screen.getByText("No quote yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/KES\s?\d/);
  });
});

const approval = (over: Record<string, unknown> = {}) => ({
  id: "ap1", source: "REQUEST", kind: "DISCOUNT", kindLabel: "Discount", status: "PENDING", title: "Q-2026-0001 v1: 12% discount", summary: "A 12% discount is above the 5% that needs approval.",
  requestedBy: { membershipId: "m-1", name: "Dev Sales" }, requestedAt: "2026-11-02T08:00:00Z", requesterNote: null, decidedBy: null, decidedAt: null, decisionReason: null,
  subject: { type: "QUOTE_VERSION", id: "v1", dealId: "d1" }, canDecide: true, resumeError: null, resumed: false, ...over,
});

describe("approvals inbox reads the API (FIG-1169)", () => {
  it("declining needs a reason, and the decision goes to the API", async () => {
    const stub = stubClient({ getApprovals: () => ({ ...page([approval()]), pending: 1, canDecide: true }), postApprovalsByApprovalIdDecision: () => approval({ status: "REJECTED" }) });
    renderScreen(<Approvals />, stub.client, { permissionKeys: MANAGER, membershipId: "m-mg" });
    const card = (await screen.findByRole("heading", { name: /12% discount/ })).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Decline" }));
    expect(within(card).getByRole("alert")).toHaveTextContent(/Say why/);
    expect(stub.calls.some((c) => c.id === "postApprovalsByApprovalIdDecision")).toBe(false);
    await userEvent.type(within(card).getByPlaceholderText(/Reason/), "Try 5%");
    await userEvent.click(within(card).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "postApprovalsByApprovalIdDecision")?.args.body).toEqual({ approve: false, reason: "Try 5%" }));
  });

  it("approving sends approve: true", async () => {
    const stub = stubClient({ getApprovals: () => ({ ...page([approval()]), pending: 1, canDecide: true }), postApprovalsByApprovalIdDecision: () => approval({ status: "APPROVED" }) });
    renderScreen(<Approvals />, stub.client, { permissionKeys: MANAGER, membershipId: "m-mg" });
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "postApprovalsByApprovalIdDecision")?.args.body).toEqual({ approve: true }));
  });

  it("a requester sees their own requests read-only, with the reason once decided", async () => {
    const stub = stubClient({ getApprovals: () => ({ ...page([approval({ canDecide: false }), approval({ id: "ap2", status: "REJECTED", decisionReason: "Too deep", canDecide: false })]), pending: 1, canDecide: false }) });
    renderScreen(<Approvals />, stub.client, { permissionKeys: SALES, membershipId: "m-1" });
    expect(await screen.findByText("Waiting for Management")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Decided/ }));
    expect(screen.getByText(/Declined · Too deep/)).toBeInTheDocument();
  });

  it("shows the explained state when the feature is off", async () => {
    const stub = stubClient({ getApprovals: () => apiError(403, "off", { code: "FEATURE_UNAVAILABLE", feature: { key: "quotes.enabled", reason: "toggle", availableIn: null } }) });
    renderScreen(<Approvals />, stub.client, { permissionKeys: MANAGER });
    expect(await screen.findByText("Approvals is not available yet")).toBeInTheDocument();
  });
});

describe("settings editors read and write the API (FIG-1174)", () => {
  it("catalogue: no cost or margin columns when the API masks cost; a price change PATCHes the item", async () => {
    const masked = page([{ ...(CATALOGUE as { items: Record<string, unknown>[] }).items[0], cost: null, marginPct: null, costMasked: true }]);
    const stub = stubClient({ getCatalogue: () => masked, patchCatalogueByItemId: () => ({}) });
    renderScreen(<CatalogueEditor />, stub.client, { permissionKeys: ["catalogue.manage"] });
    const price = await screen.findByLabelText("Price for CCTV camera");
    expect(screen.queryByRole("columnheader", { name: "Cost" })).not.toBeInTheDocument();
    await userEvent.clear(price);
    await userEvent.type(price, "20000");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "patchCatalogueByItemId")?.args).toMatchObject({ params: { itemId: "c1" }, body: { price: 20000 } }));
  });

  it("catalogue: Management with margin sees cost and margin", async () => {
    const stub = stubClient({ getCatalogue: () => CATALOGUE });
    renderScreen(<CatalogueEditor />, stub.client, { permissionKeys: MANAGER });
    expect(await screen.findByRole("columnheader", { name: "Margin" })).toBeInTheDocument();
  });

  it("approval rules: loads from the API and PATCHes the threshold", async () => {
    const rules = { discount: { enabled: true, thresholdPercent: 5 }, export: { enabled: true, thresholdRows: 500 }, largeDeal: { enabled: false, thresholdAmount: 1000000, currency: "KES" }, deletion: { enabled: true, locked: true } };
    const stub = stubClient({ getApprovalRules: () => rules, patchApprovalRules: () => rules });
    renderScreen(<ApprovalRulesEditor />, stub.client, { permissionKeys: MANAGER });
    const n = await screen.findByLabelText(/Threshold for Discount on a quote above/);
    expect(n).toHaveValue(5);
    await userEvent.clear(n);
    await userEvent.type(n, "8");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "patchApprovalRules")?.args.body).toMatchObject({ discount: { enabled: true, thresholdPercent: 8 } }));
  });

  it("pipelines: shows the API's pipelines and saves a stage rule", async () => {
    const stage = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, key: id, name, sequence: 1, probability: 50, stalledAfterDays: null, isWon: false, isLost: false, isActive: true, rules: [], ...over });
    const list = { items: [{ id: "p1", key: "SALES", name: "Sales", isDefault: true, isActive: true, serviceIds: [], stages: [stage("s1", "Proposal Sent"), stage("s2", "Closed Won", { isWon: true }), stage("s3", "Closed Lost", { isLost: true })] }], ruleTypes: [], fields: {} };
    const stub = stubClient({ getPipelines: () => list, putPipelinesByPipelineIdStagesByStageIdRules: () => ({ stageId: "s1", rules: [], impact: "ok" }) });
    renderScreen(<PipelinesEditor />, stub.client, { permissionKeys: MANAGER });
    await userEvent.click(await screen.findByRole("switch", { name: "Proposal Sent: Needs a valid quote" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "putPipelinesByPipelineIdStagesByStageIdRules")?.args).toMatchObject({ params: { pipelineId: "p1", stageId: "s1" }, body: { rules: [{ type: "QUOTE_REQUIRED", enabled: true }] } }));
  });
});

describe("deals board pipeline switching (B6.15)", () => {
  it("offers a switcher with more than one pipeline and shows only that pipeline's stages", async () => {
    const mk = (id: string, name: string, stages: ReturnType<typeof STAGES.slice>, isDefault: boolean) => ({ id, key: id, name, isDefault, isActive: true, serviceIds: [], stages: stages.map((s) => ({ ...s, rules: [] })) });
    const other = [{ id: "x-1", key: "SURVEY", name: "Site survey", sequence: 1, isWon: false, isLost: false, isActive: true }];
    const stub = stubClient({
      getReferenceData: () => ({ ...REFERENCE, pipelineStages: [...STAGES, ...other] }),
      getDeals: () => page([deal({ id: "d1", company: "Brookside", stage: STAGES[0]! }), deal({ id: "d2", company: "Tana Co", stage: other[0] as never })]),
      getHandoffs: () => page([]),
      getPipelines: () => ({ items: [mk("p1", "Digital", STAGES, true), mk("p2", "Installations", other as never, false)], ruleTypes: [], fields: {} }),
    });
    renderScreen(<DealsScreen />, stub.client, { permissionKeys: ["deals.view.all", "deals.edit.all", "deals.view.value"] });
    const select = await screen.findByRole("combobox", { name: "Pipeline" });
    expect(await screen.findByText("Solution Presented")).toBeInTheDocument();
    expect(screen.queryByText("Site survey")).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "p2");
    expect(await screen.findByText("Site survey")).toBeInTheDocument();
    expect(screen.queryByText("Solution Presented")).not.toBeInTheDocument();
  });
});
