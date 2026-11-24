import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SocialWorkspace } from "../../../../src/ui/screens/social/SocialWorkspace";
import { buildNav } from "../../../../src/ui/shell/navigation";
import { renderScreen, stubClient, violations } from "../deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/social", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const MGMT = { permissionKeys: ["reporting.view.all", "deals.view.value", "configuration.manage"], roleName: "Management" };
const MARKETING = { permissionKeys: ["reporting.view.all"], roleName: "Marketing" };
const open = async (member = MGMT) => {
  const { client } = stubClient({});
  const r = renderScreen(<SocialWorkspace />, client, member);
  return r;
};
const tab = (name: string) => userEvent.click(screen.getByRole("tab", { name }));

describe("Social workspace (demo data)", () => {
  it("explains no access without reporting.view.all", async () => {
    await open({ permissionKeys: [], roleName: "Sales" } as typeof MGMT);
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("shows KPIs and narrows the dashboard to one account", async () => {
    await open();
    expect(screen.getByText("Reach, 30 days")).toBeInTheDocument();
    expect(screen.getByText("Do these today")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Dashboard for"), "li");
    expect(screen.getByText("LinkedIn only")).toBeInTheDocument();
    expect(screen.getByText("Fleet GPS for logistics")).toBeInTheDocument();
    expect(screen.queryByText("Websites that book")).not.toBeInTheDocument();
  });

  it("is honest about an account that is not connected", async () => {
    await open();
    await tab("Accounts");
    expect(screen.getByText(/Token expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("converts a mention to a lead, record-only", async () => {
    await open();
    await tab("Monitor");
    await userEvent.click(screen.getAllByRole("button", { name: "Convert to lead" })[0]!);
    expect(await screen.findByText("Lead created")).toBeInTheDocument();
  });

  it("replies in the inbox and marks a thread done", async () => {
    await open();
    await tab("Inbox");
    await userEvent.type(screen.getByLabelText("Reply"), "Thanks, we will send a quote.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(within(screen.getByRole("list", { name: "Messages in this conversation" })).getByText("Thanks, we will send a quote.")).toBeInTheDocument();
  });

  it("masks campaign cost and pipeline value for a role without deal values", async () => {
    await open(MARKETING);
    await tab("Campaigns");
    expect(screen.queryByText("KES 31,200")).not.toBeInTheDocument();
    await open(MGMT);
  });

  it("schedules a post from the composer", async () => {
    await open();
    await tab("Publishing");
    await userEvent.click(screen.getByRole("button", { name: "New post" }));
    await userEvent.type(screen.getByLabelText("Text"), "A brand new post");
    await userEvent.click(screen.getByRole("button", { name: "Schedule" }));
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("A brand new post")).toBeInTheDocument();
  });

  it("has no accessibility violations on the overview", async () => {
    const { container } = await open();
    expect(await violations(container)).toEqual([]);
  });
});

describe("Social navigation", () => {
  const base = { permissionKeys: ["reporting.view.all"], membershipId: "m1" };
  it("draws the link only where demo screens are on and reporting.view.all is held", () => {
    const flat = (n: ReturnType<typeof buildNav>) => n.flatMap((s) => s.items.map((i) => i.key));
    expect(flat(buildNav(base))).not.toContain("social");
    expect(flat(buildNav({ ...base, demoScreens: true }))).toContain("social");
    expect(flat(buildNav({ ...base, permissionKeys: ["leads.view.own"], demoScreens: true }))).not.toContain("social");
  });
});
