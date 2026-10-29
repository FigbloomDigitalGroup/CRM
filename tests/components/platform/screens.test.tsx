import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlatformStoreProvider } from "../../../src/ui/screens/platform/store";
import { seedPlatform } from "../../../src/ui/screens/platform/demo/data";
import { PlatformAdmins, PlatformSecurity } from "../../../src/ui/screens/platform/AdminsSecurity";
import { DataRequests } from "../../../src/ui/screens/platform/DataRequests";
import { PlatformHome } from "../../../src/ui/screens/platform/Home";
import { PlatformMobile } from "../../../src/ui/screens/platform/Mobile";
import { OrgDetail } from "../../../src/ui/screens/platform/OrgDetail";
import { Organisations } from "../../../src/ui/screens/platform/Organisations";
import { ProvisionWizard } from "../../../src/ui/screens/platform/Provision";
import { Toasts } from "../../../src/ui/screens/platform/kit";
import { VerifyPage } from "../../../src/ui/screens/platform/Verify";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/platform",
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = new Date("2026-10-30T12:00:00Z");
function renderIn(ui: ReactNode) {
  return render(
    <PlatformStoreProvider initial={seedPlatform(NOW)}>
      {ui}
      <Toasts />
    </PlatformStoreProvider>,
  );
}

describe("Platform home (PL1)", () => {
  it("says what needs attention and that no customer records are shown, and marks itself as demo data", () => {
    renderIn(<PlatformHome />);
    expect(screen.getByText("3 things need attention")).toBeTruthy();
    expect(screen.getByText(/No customer records are shown here/)).toBeTruthy();
    expect(screen.getAllByText("Demo data").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Website lead endpoint · Degraded/ })).toBeTruthy();
  });

  it("has loading, error and all-healthy states", async () => {
    const user = userEvent.setup();
    renderIn(<PlatformHome />);
    await user.click(screen.getByRole("button", { name: "Loading" }));
    expect(screen.getByRole("status", { name: /Loading platform metrics/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Error" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Platform metrics didn’t load/);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "All healthy" }));
    expect(screen.getByText("All systems healthy. Nothing needs attention.")).toBeTruthy();
  });
});

describe("Organisations (PL2)", () => {
  it("lists counts only, filters by name and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderIn(<Organisations />);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    await user.type(screen.getByLabelText("Search name or slug"), "west");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await user.clear(screen.getByLabelText("Search name or slug"));
    await user.type(screen.getByLabelText("Search name or slug"), "zzz");
    expect(screen.getByText(/No organisation matches “zzz”/)).toBeTruthy();
  });
});

describe("Provision wizard (PL3)", () => {
  it("blocks a taken slug, then walks to a ready organisation with an invite link", async () => {
    const user = userEvent.setup();
    renderIn(<ProvisionWizard />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert").textContent).toBe("Give the organisation a name.");
    await user.type(screen.getByLabelText("Organisation name"), "Figbloom");
    expect(screen.getByText("Taken. Try another.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert").textContent).toBe("That slug is taken. Choose another.");
    await user.clear(screen.getByLabelText("Organisation name"));
    await user.type(screen.getByLabelText("Organisation name"), "Kilimani Property Group");
    expect(screen.getByText("Available")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" })); // region
    await user.click(screen.getByRole("button", { name: "Continue" })); // admin email
    await user.type(screen.getByLabelText(/First admin/), "boss@kilimani.co.ke");
    await user.click(screen.getByRole("button", { name: "Continue" })); // defaults
    expect(screen.getByText(/The organisation starts with these lists/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove Website from Lead sources" }));
    await user.click(screen.getByRole("button", { name: "Continue" })); // keys
    await user.click(screen.getByRole("button", { name: "Continue" })); // review
    expect(screen.getByText("Kilimani Property Group")).toBeTruthy();
    await user.click(screen.getByLabelText("Demo: make seeding fail"));
    await user.click(screen.getByRole("button", { name: "Create organisation" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Nothing was created/);
    await user.click(screen.getByRole("button", { name: "Create organisation" }));
    expect(screen.getByRole("heading", { name: "Kilimani Property Group is ready" })).toBeTruthy();
    expect(screen.getByText(/crm.figbloom.co.ke\/invite\/kilimani-property-group-/)).toBeTruthy();
  });
});

describe("Organisation detail and the suspend dialog (PL4, PL5)", () => {
  it("shows operational counts, and the suspend button stays disabled until a reason and the exact name are given", async () => {
    const user = userEvent.setup();
    renderIn(<OrgDetail id="o2" />);
    expect(screen.getByText("Names, emails and roles only. No business data.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Actions/ }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Suspend organisation" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText(/Reason/), "Abuse report");
    await user.type(within(dialog).getByLabelText(/to confirm/), "Figbloom Sandbox");
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("Suspended").length).toBeGreaterThan(0);
    expect(screen.getByText(/Suspended: members can’t sign in/)).toBeTruthy();
  });

  it("closes the dialog with Escape and offers no offboarding twice", async () => {
    const user = userEvent.setup();
    renderIn(<OrgDetail id="o3" />);
    await user.click(screen.getByRole("button", { name: /Actions/ }));
    expect(screen.getByRole("menuitem", { name: /Start offboarding/ }).getAttribute("aria-disabled")).toBe("true");
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Data requests: the two-person rule (PL6)", () => {
  it("locks the delete step, rejects the same admin, and lets a different admin approve", async () => {
    const user = userEvent.setup();
    renderIn(<DataRequests />);
    expect(screen.getByText(/Waiting for a second, different admin/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve as second admin" })).toBeNull();
    const del = screen.getByLabelText(/Delete organisation data/) as HTMLInputElement;
    expect(del.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /Demo: approve as Given/ }));
    expect(screen.getByText(/Approved by Dev Super Admin and Given\. Deletion can run\./)).toBeTruthy();
    expect((screen.getByLabelText(/Delete organisation data/) as HTMLInputElement).disabled).toBe(false);
  });
});

describe("Platform admins and security (PL10, PL11, PL14)", () => {
  it("asks Verify it’s you before removing, refuses a wrong code, then blocks the second-last admin", async () => {
    const user = userEvent.setup();
    renderIn(<PlatformAdmins />);
    const removes = () => screen.getAllByRole("button", { name: "Remove" });
    expect(removes()).toHaveLength(3);
    await user.click(removes()[2]!); // Michael
    expect(screen.getByRole("dialog", { name: "Verify it’s you" })).toBeTruthy();
    await user.type(screen.getByLabelText("Authenticator code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByRole("alert").textContent).toBe("That code didn’t work. 4 attempts left.");
    expect(screen.getAllByText(/added by/)).toHaveLength(3);
    await user.clear(screen.getByLabelText("Authenticator code"));
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getAllByText(/added by/)).toHaveLength(2);
    expect(screen.getByText(/Only two admins left/)).toBeTruthy();
    await user.click(removes()[1]!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Blocked: at least two platform admins are required.")).toBeTruthy();
    expect(screen.getAllByText(/added by/)).toHaveLength(2);
  });

  it("locks verification after five wrong codes and keeps verification locked on in security", async () => {
    const user = userEvent.setup();
    renderIn(<PlatformAdmins />);
    await user.click(screen.getAllByRole("button", { name: "Remove" })[2]!);
    for (let i = 0; i < 5; i++) {
      await user.clear(screen.getByLabelText("Authenticator code"));
      await user.type(screen.getByLabelText("Authenticator code"), "000000");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      if (i < 4) continue;
    }
    expect(screen.getByRole("dialog").textContent).toMatch(/locked for 30 minutes/);
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
  });

  it("security: the verification switch is locked on", () => {
    renderIn(<PlatformSecurity />);
    const box = screen.getByLabelText("Verification required at every sign-in") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });
});

describe("Verify it’s you page (PL14)", () => {
  it("takes a backup code instead, and shows the lock after too many wrong codes", async () => {
    const user = userEvent.setup();
    renderIn(<VerifyPage next="/login" />);
    await user.click(screen.getByRole("button", { name: "Use a backup code" }));
    expect(screen.getByLabelText("Backup code")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use my authenticator code" }));
    for (let i = 0; i < 5; i++) {
      await user.type(screen.getByLabelText("Authenticator code"), "000000");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      if (i < 4) await user.clear(screen.getByLabelText("Authenticator code"));
    }
    expect(screen.getByText(/Platform sign-in is locked for 30 minutes/)).toBeTruthy();
  });
});

describe("Platform mobile (PLM)", () => {
  it("shows the approvals, and asks Verify it’s you before approving a deletion", async () => {
    const user = userEvent.setup();
    const state = seedPlatform(NOW);
    state.requests[0]!.approvals = []; // nobody has approved yet, so this admin can
    render(
      <PlatformStoreProvider initial={state}>
        <PlatformMobile tab="approvals" />
      </PlatformStoreProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Approve deletion" }));
    expect(screen.getByRole("dialog", { name: "Verify it’s you" })).toBeTruthy();
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.queryByRole("button", { name: "Approve deletion" })).toBeNull();
    expect(screen.getByText(/You already approved this/)).toBeTruthy();
  });

  it("has the three tabs and no tenant links", () => {
    render(
      <PlatformStoreProvider initial={seedPlatform(NOW)}>
        <PlatformMobile tab="health" />
      </PlatformStoreProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Platform mobile" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Health", "Approvals"]);
    expect(document.body.innerHTML).not.toMatch(/\/o\//);
  });
});
