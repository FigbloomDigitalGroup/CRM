import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../src/app/o/[orgSlug]/_shared/Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom",
}));

/**
 * FIG-785: every active member -- not just configuration.manage holders --
 * must be able to reach Settings, since that's the only place to reach
 * their own notification preferences. Modeled on a Restricted Technical-
 * style role: every org-level `canView*`/view permission false, nothing
 * but the baseline every active member has.
 */
describe("Sidebar", () => {
  it("still shows the Settings link for a role with none of the other view permissions", () => {
    render(
      <Sidebar
        orgSlug="figbloom"
        userName="Restricted User"
        roleName="Restricted Technical"
        canViewLeads={false}
        canViewDeals={false}
        canViewTasks={false}
        canViewReports={false}
        canViewCompanies={false}
        canViewContacts={false}
        logoutButton={<button>Log out</button>}
      />,
    );

    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink).toHaveAttribute("href", "/o/figbloom/settings");
  });

  it("does not label that section 'Administration' -- every member reaches it, not just admins", () => {
    render(
      <Sidebar
        orgSlug="figbloom"
        userName="Restricted User"
        roleName="Restricted Technical"
        canViewLeads={false}
        canViewDeals={false}
        canViewTasks={false}
        canViewReports={false}
        canViewCompanies={false}
        canViewContacts={false}
        logoutButton={<button>Log out</button>}
      />,
    );

    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });
});
