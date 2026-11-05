import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrgBanners } from "../../../../src/ui/screens/orgside/OrgBanners";
import { OrgSwitcher } from "../../../../src/ui/screens/orgside/OrgSwitcher";
import { DataRequests, SupportHistory, TwoStepSettings } from "../../../../src/ui/screens/orgside/SettingsTabs";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";

const uncontracted = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/ui/data/client", async (orig) => ({ ...(await orig<typeof import("../../../../src/ui/data/client")>()), callUncontracted: uncontracted }));
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

const ORGS = {
  items: [
    { slug: "figbloom", name: "FigBloom Digital Group", membershipId: "mb1", roleKey: "MANAGEMENT", roleName: "Management", current: true },
    { slug: "brookside", name: "Brookside Ltd", membershipId: "mb2", roleKey: "SALES", roleName: "Sales", current: false },
  ],
  currentSlug: "figbloom",
};

describe("Organisation switcher (FIG-1165, TB4, wired to FIG-1133)", () => {
  it("lists the person's organisations with the role in each, and switches through the API", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    uncontracted.mockImplementation(async (method: string, path: string) => (method === "GET" && path === "/api/me/organizations" ? ORGS : { ok: true }));
    const { client } = stubClient({});
    renderScreen(<OrgSwitcher />, client, SALES);
    expect(screen.getByText("SWITCH ORGANISATION · ALT+O")).toBeInTheDocument();
    expect(await screen.findByText("Brookside Ltd")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /FigBloom Digital Group/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: /Brookside Ltd/ }));
    await waitFor(() => expect(uncontracted).toHaveBeenCalledWith("POST", "/api/me/organizations/switch", { organizationSlug: "brookside" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/o/brookside"));
    vi.unstubAllGlobals();
  });

  it("says why when the switch is refused and stays where it is", async () => {
    uncontracted.mockImplementation(async (method: string) => {
      if (method === "GET") return ORGS;
      throw apiError(404);
    });
    const { client } = stubClient({});
    renderScreen(<OrgSwitcher />, client, SALES);
    await userEvent.click(await screen.findByRole("button", { name: /Brookside Ltd/ }));
    expect(await screen.findByText(/Couldn’t switch/)).toBeInTheDocument();
  });

  it("Alt+O opens the identity popover that holds it", async () => {
    uncontracted.mockResolvedValue(ORGS);
    const { client } = stubClient({});
    renderScreen(
      <>
        <button type="button" className="fb-orgblock__trigger" onClick={() => (document.body.dataset.identityOpened = "yes")}>
          Organisation
        </button>
        <OrgSwitcher />
      </>,
      client,
      SALES,
    );
    await userEvent.keyboard("{Alt>}o{/Alt}");
    expect(document.body.dataset.identityOpened).toBe("yes");
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

  it("two-step policy is read from and saved to the API, and a trusted device can be forgotten", async () => {
    let required = false;
    uncontracted.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path.endsWith("/security/two-step-policy")) {
        if (method === "PATCH") {
          required = (body as { required: boolean }).required;
          return { required, signedOut: 2 };
        }
        return { required, trustedDeviceDays: 30, yourTwoStepIsOn: true };
      }
      if (path === "/api/me/two-step") return { enabled: true, enabledAt: null, backupCodesRemaining: 8, requiredByOrganisation: false, trustedDevices: [{ id: "d1", label: "Chrome on Windows", addedAt: "2026-10-01T00:00:00Z", lastUsedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z" }] };
      return { ok: true };
    });
    const { client } = stubClient({});
    renderScreen(<TwoStepSettings />, client, MGMT);
    const all = await screen.findByRole("checkbox", { name: /Require for everyone/ });
    expect(all).not.toBeChecked();
    await userEvent.click(all);
    await waitFor(() => expect(uncontracted).toHaveBeenCalledWith("PATCH", "/api/orgs/figbloom/security/two-step-policy", { required: true }));
    expect(await screen.findByText(/2 members without it were signed out/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Forget" }));
    await waitFor(() => expect(uncontracted).toHaveBeenCalledWith("DELETE", "/api/me/trusted-devices/d1"));
  });

  it("without the permission the policy is visible but not changeable", async () => {
    uncontracted.mockImplementation(async (_m: string, path: string) =>
      path === "/api/me/two-step" ? { enabled: false, enabledAt: null, backupCodesRemaining: 0, requiredByOrganisation: false, trustedDevices: [] } : { required: false, trustedDevice: 30, trustedDeviceDays: 30, yourTwoStepIsOn: false },
    );
    const { client } = stubClient({});
    renderScreen(<TwoStepSettings />, client, SALES);
    expect(await screen.findByRole("checkbox", { name: /Require for everyone/ })).toBeDisabled();
  });

  it("explains a feature that is not available instead of failing", async () => {
    uncontracted.mockRejectedValue(apiError(403, "Not yet", { code: "FEATURE_UNAVAILABLE", feature: { key: "release.v11", reason: "release", availableIn: "V1.1" } }));
    const { client } = stubClient({});
    renderScreen(<TwoStepSettings />, client, MGMT);
    expect((await screen.findAllByText(/not available yet/)).length).toBeGreaterThan(0);
  });
});
