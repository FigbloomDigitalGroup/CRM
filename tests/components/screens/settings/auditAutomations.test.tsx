import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuditLog } from "../../../../src/ui/screens/settings/AuditLog";
import { Automations } from "../../../../src/ui/screens/settings/Automations";
import { Integrations } from "../../../../src/ui/screens/settings/Integrations";
import { apiError, page, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import * as clientModule from "../../../../src/ui/data/client";

vi.mock("../../../../src/ui/data/client", async (orig) => ({ ...(await orig<typeof import("../../../../src/ui/data/client")>()), getCsvText: vi.fn(async () => "a,b\n1,2\n") }));

const KEYS = ["audit.view", "configuration.manage"];

function ev(over: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    at: "2026-10-27T09:30:00.000Z",
    action: "membership.role_changed",
    actor: { membershipId: "m-1", name: "Dev Management", email: "m@x", roleKey: "MANAGEMENT" },
    entity: { type: "Membership", id: "m-2", label: "Dev Sales", exists: true, archived: false, link: null },
    previousValue: { roleKey: "SALES" },
    newValue: { roleKey: "DELIVERY" },
    metadata: null,
    ...over,
  };
}
const FILTERS = { entityTypes: [{ value: "Deal", count: 3 }, { value: "Membership", count: 4 }], actions: [{ value: "membership.role_changed", count: 4 }], actors: [{ membershipId: "m-1", name: "Dev Management", roleKey: "MANAGEMENT", events: 7 }], systemEvents: 2 };

describe("Audit log (S2, FIG-1107)", () => {
  const base = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
    getAuditLogFilters: () => FILTERS,
    listAuditLog: () => ({ ...page([ev(), ev({ id: "a-2", action: "deal.value_changed", entity: { type: "Deal", id: "d-1", label: "Brookside", exists: true, archived: false, link: { path: "/o/figbloom/deals/d-1" } }, previousValue: { value: null }, newValue: { value: null } })]), total: 2 }),
    ...over,
  });

  it("lists events with who, what and a link to the record, read-only", async () => {
    const { client } = stubClient(base());
    const { container } = renderScreen(<AuditLog />, client, { permissionKeys: KEYS });
    const row = await screen.findByRole("row", { name: /membership\.role_changed/ });
    expect(within(row).getByText("Dev Management")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Brookside" })).toHaveAttribute("href", "/o/figbloom/deals/d-1");
    // No edit or delete anywhere: the log is read-only.
    expect(screen.queryByRole("button", { name: /delete|edit|remove/i })).not.toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("filters by person, record type, action and dates, and goes back to page one", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<AuditLog />, client, { permissionKeys: KEYS });
    await screen.findByRole("row", { name: /membership\.role_changed/ });
    await user.selectOptions(screen.getByLabelText("Person"), "Dev Management");
    await user.selectOptions(screen.getByLabelText("Record type"), "Deal");
    await user.selectOptions(screen.getByLabelText("Action"), "membership.role_changed");
    await user.type(screen.getByLabelText("From"), "2026-10-01");
    await waitFor(() => {
      const last = calls.filter((c) => c.id === "listAuditLog").at(-1)!;
      expect(last.args.query).toMatchObject({ actorMembershipId: "m-1", entityType: "Deal", action: "membership.role_changed", dateFrom: "2026-10-01", page: "1" });
    });
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Person")).toHaveValue("");
    expect(screen.getByLabelText("Record type")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("opens the detail drawer with before and after (already masked by the API)", async () => {
    const user = userEvent.setup();
    const { client } = stubClient(base());
    renderScreen(<AuditLog />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Open details of membership.role_changed" }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveTextContent('"roleKey": "SALES"');
    expect(drawer).toHaveTextContent('"roleKey": "DELIVERY"');
  });

  it("shows money the API blanked as blank, never as a value", async () => {
    const user = userEvent.setup();
    const { client } = stubClient(base());
    renderScreen(<AuditLog />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Open details of deal.value_changed" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent('"value": null');
  });

  it("says when nothing matches, and offers to clear", async () => {
    const { client } = stubClient(base({ listAuditLog: () => ({ ...page([]), total: 0 }) }));
    renderScreen(<AuditLog />, client, { permissionKeys: KEYS });
    expect(await screen.findByText("No events yet")).toBeInTheDocument();
  });

  it("exports the CSV with the filters that are showing", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const { client } = stubClient(base());
    renderScreen(<AuditLog />, client, { permissionKeys: KEYS });
    await screen.findByRole("row", { name: /membership\.role_changed/ });
    await user.selectOptions(screen.getByLabelText("Record type"), "Deal");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(clientModule.getCsvText).toHaveBeenCalledWith("/api/orgs/figbloom/audit/events/export", { entityType: "Deal" }));
    expect(await screen.findByText(/Audit log exported/)).toBeInTheDocument();
  });

  it("is an explained no-access card for a role the API refuses", async () => {
    const { client } = stubClient(base({ listAuditLog: () => apiError(403, "No"), getAuditLogFilters: () => apiError(403, "No") }));
    renderScreen(<AuditLog />, client, { permissionKeys: [] });
    expect(await screen.findByRole("region", { name: /isn’t part of your workspace/ })).toBeInTheDocument();
  });
});

const RULE = {
  key: "STALLED_DEAL_FLAG",
  name: "Flag stalled deals",
  description: "Adds a Stalled flag and notifies the owner. The deal stays in its stage.",
  trigger: "No activity for 10 days",
  effect: "Flags",
  actions: ["flag", "notify"],
  enabled: true,
  params: [{ key: "days", label: "Days without activity", unit: "days", min: 1, max: 90, default: 10, value: 10 }, { key: "frozen", label: "Stage", unit: "days", default: 1, value: 1, readOnly: true, note: "Changed in deal rules." }],
  audience: "OWNER",
  audiences: ["OWNER", "OWNER_AND_MANAGEMENT"],
  origin: "built-in",
  recent: { applied: 4, skipped: 1, failed: 0, lastRunAt: new Date().toISOString() },
};
const BOUNDARY = "Automations assign, remind and draft. They never move a deal stage, set a discount, approve anything or change an owner outside an assignment rule.";

describe("Automations (S5, FIG-1108)", () => {
  const base = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
    listAutomationRules: () => ({ items: [RULE, { ...RULE, key: "RENEWAL_REMINDER", name: "Remind about renewals", enabled: false, params: [], audiences: ["OWNER"] }], boundary: BOUNDARY }),
    listAutomationRuns: () => ({ ...page([{ id: "r-1", at: "2026-10-27T08:00:00.000Z", rule: { key: "STALLED_DEAL_FLAG", name: "Flag stalled deals" }, record: { type: "Deal", id: "d-1" }, status: "APPLIED", result: "Flagged" }, { id: "r-2", at: "2026-10-27T07:00:00.000Z", rule: { key: "STALLED_DEAL_FLAG", name: "Flag stalled deals" }, record: { type: "Deal", id: "d-2" }, status: "SKIPPED", result: "Already flagged" }]), total: 2 }),
    updateAutomationRule: () => ({}),
    ...over,
  });

  it("states that automations never decide, and lists each rule with a switch and what it did lately", async () => {
    const { client } = stubClient(base());
    const { container } = renderScreen(<Automations />, client, { permissionKeys: KEYS });
    expect(await screen.findByText(/never move a deal stage/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Flag stalled deals" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Remind about renewals" })).not.toBeChecked();
    expect(screen.getAllByText(/Last 7 days: 4 done, 1 skipped/)).toHaveLength(2);
    expect(await violations(container)).toEqual([]);
  });

  it("turns a rule off and on through the API", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<Automations />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("switch", { name: "Flag stalled deals" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateAutomationRule")?.args).toMatchObject({ params: { ruleKey: "STALLED_DEAL_FLAG" }, body: { enabled: false } }));
    await user.click(screen.getByRole("switch", { name: "Remind about renewals" }));
    await waitFor(() => expect(calls.filter((c) => c.id === "updateAutomationRule").at(-1)?.args.body).toEqual({ enabled: true }));
  });

  it("edits a rule's numbers and audience, sending only the editable ones", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<Automations />, client, { permissionKeys: KEYS });
    await user.click((await screen.findAllByRole("button", { name: "Settings" }))[0]!);
    const days = screen.getByLabelText("Days without activity (days)");
    await user.clear(days);
    await user.type(days, "14");
    expect(screen.getByLabelText("Stage (days)")).toHaveAttribute("readonly");
    await user.selectOptions(screen.getByLabelText("Who is told"), "The owner, then Management");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateAutomationRule")?.args.body).toEqual({ params: { days: 14 }, audience: "OWNER_AND_MANAGEMENT" }));
  });

  it("shows the API's reason when a change is refused", async () => {
    const user = userEvent.setup();
    const { client } = stubClient(base({ updateAutomationRule: () => apiError(400, "Days must be between 1 and 90.", { code: "VALIDATION_FAILED" }) }));
    renderScreen(<Automations />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("switch", { name: "Flag stalled deals" }));
    expect(await screen.findByText(/Days must be between 1 and 90/)).toBeInTheDocument();
  });

  it("shows the run log and filters it by rule and outcome", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(base());
    renderScreen(<Automations />, client, { permissionKeys: KEYS });
    const log = await screen.findByRole("table");
    expect(within(log).getByText("Done")).toBeInTheDocument();
    expect(within(log).getByText("Skipped")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Outcome"), "Skipped");
    await waitFor(() => expect(calls.filter((c) => c.id === "listAutomationRuns").at(-1)?.args.query).toMatchObject({ status: "SKIPPED", page: "1" }));
  });
});

describe("Integrations (S6, FIG-1108)", () => {
  const E = (over: Record<string, unknown>) => ({ key: "WEBSITE", name: "Website enquiry form", description: "Enquiries become leads.", state: "CONNECTED", release: "V1", stateReason: "A lead arrived 2 hours ago.", lastActivityAt: null, lastError: null, configurable: true, ...over });
  it("shows Connected, Not connected and Planned with the next step, and only click-to-chat is configured here", async () => {
    const user = userEvent.setup();
    const { client } = stubClient({
      listIntegrations: () => ({ integrations: [E({}), E({ key: "INBOUND_EMAIL", name: "Inbound email", state: "NOT_CONNECTED", stateReason: "No mail has arrived." }), E({ key: "WHATSAPP_CLICK_TO_CHAT", name: "WhatsApp click-to-chat", state: "CONNECTED" }), E({ key: "GMAIL", name: "Google Workspace email", state: "PLANNED", release: "V1.1", configurable: false })], counts: {} }),
      getWhatsAppConfig: () => ({ number: "254711482900", defaultMessage: "Hello", templates: [] }),
    });
    const { container } = renderScreen(<Integrations />, client, { permissionKeys: KEYS });
    expect(await screen.findByRole("article", { name: "Website enquiry form" })).toHaveTextContent("Connected");
    expect(screen.getByRole("article", { name: "Inbound email" })).toHaveTextContent("Not connected");
    const planned = screen.getByRole("article", { name: "Google Workspace email" });
    expect(planned).toHaveTextContent("Planned");
    expect(within(planned).getByRole("button", { name: "Planned" })).toHaveAttribute("aria-disabled", "true");
    expect(within(screen.getByRole("article", { name: "Website enquiry form" })).getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/o/figbloom/settings?tab=website");
    await user.click(within(screen.getByRole("article", { name: "WhatsApp click-to-chat" })).getByRole("button", { name: "Configure" }));
    expect(await screen.findByLabelText("Organisation WhatsApp number")).toHaveValue("254711482900");
    expect(await violations(container)).toEqual([]);
  });
});
