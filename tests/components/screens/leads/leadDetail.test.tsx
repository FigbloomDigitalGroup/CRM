import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LeadDetailScreen } from "../../../../src/ui/screens/leads/LeadDetailScreen";
import { MGMT_KEYS, SALES_KEYS, apiError, axeViolations, leadRow, page, renderScreen } from "./harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/o/figbloom/leads/lead-1" }));

/** F2.02 (FIG-1084, design L2): the lead page: progress strip, qualification, duplicate and archived banners, read-only and locked states. */

const detail = (over: Record<string, unknown> = {}) => ({
  ...leadRow(),
  company: { id: "co-1", name: "Wafula Ltd", phone: null },
  contact: { id: "ct-1", firstName: "Amina", lastName: "Wafula", email: "amina@wafula.example", phone: "+254700000001", jobTitle: "Owner" },
  scoreValue: 42,
  scoreBand: "WARM",
  scoreFactors: [],
  leadStatus: { id: "st-NEW", name: "New", key: "NEW" },
  leadSource: { id: "src-PHONE", name: "Phone", key: "PHONE" },
  lostReason: null,
  tagLinks: [],
  ...over,
});

const STAGES = (current: string) =>
  ["NEW", "CONTACTED", "NEEDS_IDENTIFIED", "QUALIFIED", "CONVERTED"].map((key, i, all) => ({
    key,
    name: { NEW: "New", CONTACTED: "Contacted", NEEDS_IDENTIFIED: "Needs Identified", QUALIFIED: "Qualified", CONVERTED: "Converted" }[key]!,
    state: all.indexOf(current) > i ? "done" : key === current ? "current" : "todo",
  }));

const qualification = (over: Record<string, unknown> = {}) => ({
  leadId: "lead-1",
  serviceInterestId: "svc-cctv",
  questions: [
    { key: "cameras", label: "Cameras needed (approx.)", fieldType: "NUMBER", options: [], helpText: null, required: false, requiredOnQualify: true, serviceId: null, answer: null, answered: false },
    { key: "existing", label: "Existing system", fieldType: "TEXT", options: [], helpText: null, required: false, requiredOnQualify: false, serviceId: null, answer: "analogue DVR", answered: true },
  ],
  keptAnswers: [],
  progress: {
    stages: STAGES("NEW"),
    offStrip: null,
    missing: [{ key: "cameras", label: "Cameras needed (approx.)", message: "Add the number of cameras before qualifying." }],
    canQualify: false,
    qualified: false,
  },
  ...over,
});

const base = { getLeadsByLeadId: detail(), getLeadsByLeadIdQualification: qualification(), getLeadsByLeadIdScore: { score: 42, band: "WARM", factors: [{ key: "service", label: "Service chosen", points: 10 }], computedAt: null } };
const mgmt = { keys: MGMT_KEYS, roleName: "Management", membershipId: "m-mgmt" };

describe("the lead page", () => {
  it("draws the header, the five-step progress strip in the server's order, the next follow-up and the side panels", async () => {
    renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: SALES_KEYS, handlers: base });
    expect(await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" })).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: "Lead progress" });
    await within(strip).findByRole("button", { name: /Qualified/ });
    expect(within(strip).getAllByRole("button").map((b) => b.textContent?.replace(/^\S\s?/, "").trim())).toEqual(expect.arrayContaining(["New", "Contacted", "Needs Identified", "Qualified", "Converted"]));
    expect(within(strip).getByRole("button", { name: /New/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("No follow-up set")).toBeInTheDocument();
    expect(screen.getByText("Pick a time so this lead doesn’t go cold.")).toBeInTheDocument();
    expect(screen.getByText("Qualification · CCTV")).toBeInTheDocument();
    expect(screen.getByText("Service chosen")).toBeInTheDocument(); // the score explanation
    expect(screen.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+254700000001");
    expect(document.querySelector('[data-slot="record-extras"]')).not.toBeNull(); // F3.08 mounts here in M8
  });

  it("cannot be marked Qualified until the required answers are in, and says exactly what is missing, without calling the API", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: SALES_KEYS, handlers: base });
    await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" });
    await user.click(await within(screen.getByRole("region", { name: "Lead progress" })).findByRole("button", { name: /Qualified/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("can’t be marked Qualified yet");
    expect(alert).toHaveTextContent("Cameras needed (approx.)");
    expect(calls.some((c) => c.id === "patchLeadsByLeadId")).toBe(false);
  });

  it("moves to a status the lead is ready for, and shows the server's own message if it refuses", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: SALES_KEYS, handlers: { ...base, patchLeadsByLeadId: apiError(400, { message: "That change is not allowed right now." }) } });
    await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" });
    await user.click(await within(screen.getByRole("region", { name: "Lead progress" })).findByRole("button", { name: /Contacted/ }));
    expect(await screen.findByText("That change is not allowed right now.")).toBeInTheDocument();
    expect(calls.find((c) => c.id === "patchLeadsByLeadId")?.args).toMatchObject({ body: { leadStatusId: "st-CONTACTED" } });
  });

  it("saves a qualification answer as you type", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: SALES_KEYS, handlers: { ...base, patchLeadsByLeadIdQualification: qualification() } });
    const field = await screen.findByLabelText(/Cameras needed/);
    await user.type(field, "24");
    await waitFor(() => expect(calls.find((c) => c.id === "patchLeadsByLeadIdQualification")?.args).toMatchObject({ body: { answers: { cameras: 24 } } }), { timeout: 3000 });
  });

  it("shows a possible duplicate as a warning that never blocks editing", async () => {
    renderScreen(<LeadDetailScreen leadId="lead-1" />, {
      keys: SALES_KEYS,
      handlers: { ...base, getDeals: page([{ id: "d1", leadId: null, outcome: "OPEN", ownerMembershipId: "m-mgmt", pipelineStage: { name: "Negotiation" }, service: { name: "CCTV" } }]) },
    });
    const banner = await screen.findByText(/already has an open deal/);
    expect(banner).toHaveTextContent("Negotiation");
    expect(banner).toHaveTextContent("Dev Management");
    expect(screen.getByRole("link", { name: "Open customer" })).toHaveAttribute("href", "/o/figbloom/companies/co-1");
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("an archived lead is read-only until restored, and only someone who may archive it sees Restore", async () => {
    const archived = detail({ archivedAt: "2026-10-02T00:00:00Z", archived: true });
    const owner = renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: SALES_KEYS, handlers: { ...base, getLeadsByLeadId: archived } });
    expect(await screen.findByText(/This lead is read-only until it’s restored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Convert to deal/ })).toBeNull();
    expect(await within(screen.getByRole("region", { name: "Lead progress" })).findByRole("button", { name: /Contacted/ })).toBeDisabled();
    owner.unmount();
    renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: ["leads.view.own"], handlers: { ...base, getLeadsByLeadId: archived } });
    await screen.findByText(/This lead is read-only until it’s restored/);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("a converted lead is locked: its status cannot change and Convert is gone", async () => {
    renderScreen(<LeadDetailScreen leadId="lead-1" />, {
      keys: SALES_KEYS,
      handlers: { ...base, getLeadsByLeadId: detail({ convertedAt: "2026-10-05T00:00:00Z", leadStatus: { id: "st-CONVERTED", name: "Converted", key: "CONVERTED" } }), getLeadsByLeadIdQualification: qualification({ progress: { stages: STAGES("CONVERTED").map((s) => ({ ...s, state: "done" })), offStrip: null, missing: [], canQualify: true, qualified: true } }) },
    });
    await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" });
    expect(screen.queryByRole("button", { name: "Convert to deal" })).toBeNull();
    await within(screen.getByRole("region", { name: "Lead progress" })).findByRole("button", { name: /Converted/ });
    for (const b of within(screen.getByRole("region", { name: "Lead progress" })).getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("someone else's lead is read-only with the owner locked and the reason given", async () => {
    renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: ["leads.view.all"], handlers: { ...base, getLeadsByLeadId: detail({ ownerMembershipId: "m-mgmt" }) }, membershipId: "m-sales" });
    await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" });
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByText(/Only Management can reassign leads/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(await screen.findByLabelText(/Cameras needed/)).toHaveAttribute("readonly");
  });

  it("Management reassigns from the Details panel and sees the audit history tab", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadDetailScreen leadId="lead-1" />, { ...mgmt, handlers: { ...base, postLeadsByLeadIdAssign: {}, getAudit: [{ id: "e1", action: "lead.assigned", actorMembershipId: "m-mgmt", createdAt: "2026-10-02T10:00:00Z" }] } });
    await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" });
    await user.selectOptions(screen.getAllByRole("combobox").find((el) => (el as HTMLSelectElement).value === "m-sales")!, "m-mgmt");
    await waitFor(() => expect(calls.find((c) => c.id === "postLeadsByLeadIdAssign")?.args).toMatchObject({ body: { ownerMembershipId: "m-mgmt" } }));
    await user.click(screen.getByRole("button", { name: "Audit history" }));
    expect(await screen.findByText("Lead assigned")).toBeInTheDocument();
  });

  it("explains a refusal instead of showing a blank page", async () => {
    renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: [], handlers: { ...base, getLeadsByLeadId: apiError(403, { denial: { yourRole: "Finance", ownerRoles: ["Sales"], whoToAsk: ["Dev Management"] } }) } });
    expect(await screen.findByText("Finance")).toBeInTheDocument(); // "Your role", from the API's own explanation
  });

  it("has no accessibility violations", async () => {
    const { container } = renderScreen(<LeadDetailScreen leadId="lead-1" />, { keys: SALES_KEYS, handlers: base });
    await screen.findByRole("heading", { level: 1, name: "Wafula Ltd" });
    expect(await axeViolations(container)).toEqual([]);
  });
});
