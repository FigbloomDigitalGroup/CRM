import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { seedPlatform } from "../../../src/ui/screens/platform/demo/data";
import { PlatformRoot } from "../../../src/ui/screens/platform/PlatformRoot";
import { PlatformShell } from "../../../src/ui/screens/platform/PlatformShell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/platform/organisations/o1",
  useSearchParams: () => new URLSearchParams(),
}));

function shell() {
  return render(
    <PlatformRoot>
      <PlatformShell identity={{ name: "Dev Super Admin", email: "superadmin@platform.figbloom.co.ke" }} signOut={<button type="button">Sign out</button>}>
        <p>page body</p>
      </PlatformShell>
    </PlatformRoot>,
  );
}

describe("Platform console shell (PL1, TB6)", () => {
  it("is its own frame: platform badge, environment, no tenant links, the dev-only strip", () => {
    shell();
    expect(screen.getByText("Platform console")).toBeTruthy();
    expect(screen.getByText(/PRODUCTION · v1\.1\.3/)).toBeTruthy();
    expect(screen.getByText(/Dev only: verification skipped/)).toBeTruthy();
    const nav = screen.getByRole("navigation");
    const links = within(nav).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.every((h) => h!.startsWith("/platform"))).toBe(true);
    expect(links).not.toContain("/o/figbloom");
    expect(within(nav).getByRole("link", { name: /Organisations/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText(/hold no organisation role and see no customer records by default/)).toBeTruthy();
  });

  it("shows the V2 pages only when V2 is on, and the data-requests badge counts what waits", async () => {
    const user = userEvent.setup();
    shell();
    expect(screen.getByRole("link", { name: /Flags and limits/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Release shown in the console"), "v11");
    expect(screen.queryByRole("link", { name: /Flags and limits/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Announcements/ })).toBeNull();
    const seeded = seedPlatform();
    const waiting = seeded.requests.filter((r) => ["Received", "In review", "Approved"].includes(r.status)).length;
    expect(screen.getByRole("link", { name: /Data requests/ }).textContent).toContain(String(waiting));
  });

  it("searches organisation names only, and says so when nothing matches", async () => {
    const user = userEvent.setup();
    shell();
    await user.type(screen.getByLabelText("Search organisations"), "sandbox");
    expect(screen.getByRole("link", { name: /Figbloom Sandbox/ }).getAttribute("href")).toBe("/platform/organisations/o2");
    await user.clear(screen.getByLabelText("Search organisations"));
    await user.type(screen.getByLabelText("Search organisations"), "peter ochieng");
    expect(screen.getByText(/Search covers organisation names only/)).toBeTruthy();
  });

  it("the account menu says the admin holds no organisation role, and offers Preferences and Sign out", async () => {
    const user = userEvent.setup();
    shell();
    await user.click(screen.getByRole("button", { name: /Dev Super Admin/ }));
    expect(screen.getByText("Platform · no organisation role")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Preferences" }).getAttribute("href")).toBe("/platform/preferences");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Platform · no organisation role")).toBeNull();
  });

  it("switches to the dark look on this device", async () => {
    const user = userEvent.setup();
    const { container } = shell();
    await user.click(screen.getByRole("button", { name: "Toggle dark mode" }));
    expect(container.querySelector(".fb-pl")!.getAttribute("data-pl-theme")).toBe("dark");
  });
});
