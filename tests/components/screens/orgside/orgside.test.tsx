import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrgBanners } from "../../../../src/ui/screens/orgside/OrgBanners";
import { OrgSwitcher } from "../../../../src/ui/screens/orgside/OrgSwitcher";
import { DataRequests, SupportHistory, TwoStepSettings } from "../../../../src/ui/screens/orgside/SettingsTabs";
import { renderScreen, stubClient, violations } from "../deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const MGMT = { permissionKeys: ["configuration.manage", "security.manage"], roleName: "Management" };
const SALES = { permissionKeys: ["leads.view.own"], roleName: "Sales" };

describe("Organisation side of support access (FIG-1192, OS2, OS3, OS5)", () => {
  it("Management approves a request, the banner appears with End now, and ending it lands in the history", async () => {
    const { client } = stubClient({});
    renderScreen(
      <>
        <OrgBanners />
        <SupportHistory />
      </>,
      client,
      MGMT,
    );
    expect(screen.getByText(/Figbloom Support asks to view your workspace/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText(/Figbloom Support is viewing settings and health \(read-only\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "End now" }));
    expect(screen.queryByRole("button", { name: "End now" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Ended").length).toBeGreaterThan(1);
  });

  it("the announcement can be dismissed", async () => {
    const { client } = stubClient({});
    renderScreen(<OrgBanners />, client, SALES);
    expect(screen.queryByText(/asks to view your workspace/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss announcement" }));
    expect(screen.queryByText(/Planned maintenance/)).not.toBeInTheDocument();
  });
});

describe("Organisation switcher (FIG-1165, TB4)", () => {
  it("lists organisations with the role in each, disables a suspended one with the reason, and accepts an invitation", async () => {
    const { client } = stubClient({});
    renderScreen(<OrgSwitcher />, client, SALES);
    await userEvent.click(screen.getByRole("button", { name: "Switch organisation" }));
    expect(screen.getByText("SWITCH ORGANISATION · ALT+O")).toBeInTheDocument();
    expect(screen.getByText("Suspended by Figbloom on 14 Oct")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Westlands Clinics/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: /Nyeri Coffee/ }));
    expect(await screen.findByText(/Joined Nyeri Coffee Co-op as Delivery/)).toBeInTheDocument();
  });

  it("Alt+O opens it", async () => {
    const { client } = stubClient({});
    renderScreen(<OrgSwitcher />, client, SALES);
    await userEvent.keyboard("{Alt>}o{/Alt}");
    expect(screen.getByRole("dialog", { name: "Switch organisation" })).toBeInTheDocument();
  });
});

describe("Settings sections on the organisation side (FIG-1166, FIG-1167)", () => {
  it("files a data request, refuses an empty one, and lists the status", async () => {
    const { client } = stubClient({});
    const { container } = renderScreen(<DataRequests />, client, MGMT);
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText("Say what the request is about")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/What is it about/), "Customer list (CSV)");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText(/Data export · Customer list \(CSV\)/)).toBeInTheDocument();
    expect(screen.getByText(/Peter Ochieng/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("two-step policy toggles and a trusted device can be forgotten", async () => {
    const { client } = stubClient({});
    renderScreen(<TwoStepSettings />, client, MGMT);
    const all = screen.getByRole("checkbox", { name: /Require for everyone/ });
    expect(all).not.toBeChecked();
    await userEvent.click(all);
    expect(all).toBeChecked();
    await userEvent.click(screen.getAllByRole("button", { name: "Forget" })[0]!);
    expect(screen.queryByText("Chrome on Windows")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preview the code screen" })).toHaveAttribute("href", "/two-step?demo=1");
  });

  it("without the permission the policy is visible but not changeable", () => {
    const { client } = stubClient({});
    renderScreen(<TwoStepSettings />, client, SALES);
    expect(screen.getByRole("checkbox", { name: /Require for everyone/ })).toBeDisabled();
  });
});
