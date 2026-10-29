import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalRulesEditor } from "../../../src/ui/screens/settingsplus/ApprovalRules";
import { CatalogueEditor } from "../../../src/ui/screens/settingsplus/Catalogue";
import { DevelopersEditor } from "../../../src/ui/screens/settingsplus/Developers";
import { RolesEditor } from "../../../src/ui/screens/settingsplus/Roles";
import { MANAGEMENT, renderAs, SALES } from "../commercial/helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }) }));

describe("service catalogue (FIG-1174)", () => {
  it("cost and margin columns exist only for a role with deals.margin", () => {
    const { unmount } = renderAs(<CatalogueEditor />, MANAGEMENT);
    expect(screen.getByRole("columnheader", { name: "Margin" })).toBeInTheDocument();
    unmount();
    renderAs(<CatalogueEditor />, { ...MANAGEMENT, permissionKeys: ["catalogue.manage"] });
    expect(screen.queryByRole("columnheader", { name: "Margin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).not.toBeInTheDocument();
  });

  it("explains the impact before saving, and a zero price blocks the save with the reason", async () => {
    renderAs(<CatalogueEditor />, MANAGEMENT);
    const price = screen.getByLabelText("Price for Support retainer");
    await userEvent.clear(price);
    await userEvent.type(price, "30000");
    expect(screen.getByRole("status")).toHaveTextContent(/KES 25,000 → KES 30,000/);
    expect(screen.getByRole("status")).toHaveTextContent(/already sent keep the price/);
    await userEvent.clear(price);
    await userEvent.type(price, "0");
    expect(screen.getByRole("alert")).toHaveTextContent(/price must be more than 0/);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
  });

  it("saving asks for confirmation, repeats the impact, and writes an audit entry", async () => {
    renderAs(<CatalogueEditor />, MANAGEMENT);
    const price = screen.getByLabelText("Price for Support retainer");
    await userEvent.clear(price);
    await userEvent.type(price, "30000");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/recorded in the audit log/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Recent changes")).toBeInTheDocument();
    expect(screen.getByText("Catalogue changed")).toBeInTheDocument();
  });
});

describe("approval rules (FIG-1174)", () => {
  it("a discount threshold above the maximum a quote may carry cannot be saved", async () => {
    renderAs(<ApprovalRulesEditor />, MANAGEMENT);
    const n = screen.getByLabelText(/Threshold for Discount on a quote above/);
    await userEvent.clear(n);
    await userEvent.type(n, "45");
    expect(screen.getByRole("alert")).toHaveTextContent(/could never trigger/);
  });

  it("is read-only with a stated reason for a role that cannot change it", () => {
    renderAs(<ApprovalRulesEditor />, SALES);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("roles and field access (FIG-1194)", () => {
  it("shows the effect on a sample record before anything is saved", async () => {
    renderAs(<RolesEditor />, MANAGEMENT);
    const preview = screen.getByRole("region", { name: "Effect preview" });
    // Sales has Hidden access to cost and margin by default.
    expect(within(preview).getByText("Cost and margin").closest("div")).toHaveTextContent("Hidden");
    await userEvent.click(screen.getByRole("button", { name: /Cost and margin for Sales: Hidden/ }));
    expect(within(preview).getByText("Cost and margin").closest("div")).toHaveTextContent("42% Can change it");
    expect(screen.getByRole("status")).toHaveTextContent(/Sales will start to see “Cost and margin”/);
  });

  it("will not let Management lose sight of a field", async () => {
    renderAs(<RolesEditor />, MANAGEMENT);
    await userEvent.click(screen.getByRole("button", { name: /Deal value for Management: Edit/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Management must keep at least View/);
  });
});

describe("developers (FIG-1194)", () => {
  it("shows a new token's secret exactly once; afterwards only a masked tail is on the page", async () => {
    renderAs(<DevelopersEditor />, MANAGEMENT);
    await userEvent.click(screen.getByRole("button", { name: /New token/ }));
    const form = await screen.findByRole("dialog");
    await userEvent.type(within(form).getByLabelText("Name"), "Reports sync");
    await userEvent.click(within(form).getByLabelText("deals:read"));
    await userEvent.click(within(form).getByRole("button", { name: "Create token" }));

    const secret = (await screen.findByTestId("secret-once")).textContent!;
    expect(secret).toMatch(/^fbk_live_[A-Za-z0-9]{32}$/);
    await userEvent.click(screen.getByRole("button", { name: "I have saved it" }));

    await waitFor(() => expect(screen.queryByTestId("secret-once")).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(secret);
    expect(screen.getByLabelText("Token Reports sync").textContent).toMatch(/^fbk_live_••••.{3}$/);
  });

  it("makes the person pick a scope and a name", async () => {
    renderAs(<DevelopersEditor />, MANAGEMENT);
    await userEvent.click(screen.getByRole("button", { name: /New token/ }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Create token" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Name the token/);
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one scope/);
  });

  it("revoking is confirmed, immediate and audited", async () => {
    renderAs(<DevelopersEditor />, MANAGEMENT);
    const row = screen.getByText("Accounting sync").closest(".fb-set-row") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/stop working immediately/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke now" }));
    await waitFor(() => expect(screen.queryByLabelText("Token Accounting sync")).not.toBeInTheDocument());
    expect(screen.getByText("API token revoked")).toBeInTheDocument();
  });

  it("a webhook test shows up in the delivery log, and a failing endpoint shows its retry", async () => {
    renderAs(<DevelopersEditor />, MANAGEMENT);
    const failing = screen.getAllByText("https://pms.example.co.ke/in")[0]!.closest(".fb-set-row") as HTMLElement;
    await userEvent.click(within(failing).getByRole("button", { name: "Send test" }));
    const log = screen.getByRole("table", { name: "Webhook deliveries" });
    expect(within(log).getAllByText("test.ping")).toHaveLength(1);
    expect(within(log).getAllByRole("button", { name: "Retry now" }).length).toBeGreaterThan(0);
  });

  it("refuses to create tokens for a role without api_tokens.manage, and says why", () => {
    renderAs(<DevelopersEditor />, { ...MANAGEMENT, permissionKeys: [] });
    expect(screen.getByRole("button", { name: /New token/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: /API docs/ })).toHaveAttribute("href", "/api/openapi.json");
  });
});
