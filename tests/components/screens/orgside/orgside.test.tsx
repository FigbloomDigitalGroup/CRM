import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrgSwitcher } from "../../../../src/ui/screens/orgside/OrgSwitcher";
import { DataRequests, TwoStepSettings } from "../../../../src/ui/screens/orgside/SettingsTabs";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";

const uncontracted = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/ui/data/client", async (orig) => ({ ...(await orig<typeof import("../../../../src/ui/data/client")>()), callUncontracted: uncontracted }));
vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const MGMT = { permissionKeys: ["configuration.manage", "security.manage"], roleName: "Management" };
const SALES = { permissionKeys: ["leads.view.own"], roleName: "Sales" };

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
  const REQ = (over: Record<string, unknown>) => ({ id: "r1", kind: "EXPORT", status: "SUBMITTED_TO_PLATFORM", note: null, submittedAt: "2026-11-02T08:00:00Z", exportStatus: "NONE", exportExpiresAt: null, deleteAfter: null, ...over });

  it("lists the organisation's requests from the API, files a new one, and offers a ready export for download", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    let items = [REQ({ id: "r1", status: "APPROVED", exportStatus: "READY", exportExpiresAt: "2026-12-01T00:00:00Z" })];
    const { client, calls } = stubClient({
      listOrganisationDataRequests: () => ({ items }),
      submitOrganisationDataRequest: ({ body }) => {
        items = [...items, REQ({ id: "r2", kind: (body as { kind: string }).kind, note: (body as { note?: string }).note ?? null })];
        return items[1];
      },
      getPrivacyOrganisationRequestsByRequestIdDownload: () => ({ download: { url: "https://files.example/export.gz" } }),
    });
    const { container } = renderScreen(<DataRequests />, client, MGMT);
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Type"), "DELETE");
    await userEvent.type(screen.getByLabelText("Notes for Figbloom"), "Closing the branch");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(calls.find((c) => c.id === "submitOrganisationDataRequest")?.args).toMatchObject({ params: { orgSlug: "figbloom" }, body: { kind: "DELETE", note: "Closing the branch" } }));
    expect(await screen.findByText(/Organisation deletion · Closing the branch/)).toBeInTheDocument();
    expect(screen.getByText("With Figbloom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://files.example/export.gz"));
    expect(calls.find((c) => c.id === "getPrivacyOrganisationRequestsByRequestIdDownload")?.args).toMatchObject({ params: { requestId: "r1" } });
    expect(await violations(container)).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("says why a request was refused, and never shows a preview of the suspended screen", async () => {
    const { client } = stubClient({
      listOrganisationDataRequests: () => ({ items: [] }),
      submitOrganisationDataRequest: () => apiError(400, "A request to export the organisation is already with the platform team."),
    });
    renderScreen(<DataRequests />, client, MGMT);
    expect(await screen.findByText("No requests yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/already with the platform team/)).toBeInTheDocument();
    expect(screen.queryByText(/suspended screen/i)).not.toBeInTheDocument();
    expect(document.cookie).not.toContain("fb_demo_suspended");
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
