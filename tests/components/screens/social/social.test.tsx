import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SocialAnalytics, SocialCampaigns, SocialInbox, SocialOverview, SocialPublishing } from "../../../../src/ui/screens/social";
import { buildNav } from "../../../../src/ui/shell/navigation";
import { renderScreen, stubClient, violations } from "../deals/harness";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/social", useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));

const MGMT = { permissionKeys: ["social.view", "social.publish", "deals.view.value", "configuration.manage"], roleName: "Management" };
const MARKETING = { permissionKeys: ["social.view", "social.publish"], roleName: "Marketing" };
const open = (ui: ReactNode, member: Partial<typeof MGMT> = MGMT) => renderScreen(ui, stubClient({}).client, member);

describe("Social media pages (demo data)", () => {
  it("explains no access without social.view", () => {
    open(<SocialOverview />, { permissionKeys: [], roleName: "Sales" });
    expect(screen.queryByRole("heading", { name: "Social overview" })).not.toBeInTheDocument();
  });

  it("shows the overview as designed: accounts, mentions with filter, sentiment, needs attention", async () => {
    open(<SocialOverview />);
    expect(screen.getByRole("heading", { name: "Social overview" })).toBeInTheDocument();
    expect(screen.getByText("Your accounts, what people are saying and what needs a reply.")).toBeInTheDocument();
    expect(screen.getByText("Marketing team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect account" })).toBeInTheDocument();
    expect(screen.getByText(/Token expired/)).toBeInTheDocument();
    expect(screen.getByText("Sentiment this week")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Negative/ }));
    expect(screen.getByText("Nairobi Dev")).toBeInTheDocument();
    expect(screen.queryByText("Tausi Beauty Lounge")).not.toBeInTheDocument();
  });

  it("reconnects an expired account", async () => {
    open(<SocialOverview />);
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(screen.queryByText(/Token expired/)).not.toBeInTheDocument();
  });

  it("creates a lead from a mention (record-only) and opens the inbox", async () => {
    push.mockClear();
    open(<SocialOverview />);
    await userEvent.click(screen.getAllByRole("button", { name: "Create lead" })[0]!);
    expect(await screen.findByText("Lead created")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Reply in inbox" })[0]!);
    expect(push).toHaveBeenCalledWith("/o/figbloom/social/inbox");
  });

  it("replies in the inbox", async () => {
    open(<SocialInbox />);
    await userEvent.type(screen.getByLabelText("Reply"), "Thanks, we will send a quote.");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(within(screen.getByRole("list", { name: "Messages in this conversation" })).getByText("Thanks, we will send a quote.")).toBeInTheDocument();
  });

  it("publishing needs social.publish, and schedules a post from the composer", async () => {
    const { unmount } = open(<SocialPublishing />, { permissionKeys: ["social.view"], roleName: "Marketing" });
    expect(screen.queryByRole("button", { name: "New post" })).not.toBeInTheDocument();
    unmount();
    open(<SocialPublishing />);
    await userEvent.click(screen.getByRole("button", { name: "New post" }));
    await userEvent.type(screen.getByLabelText("Text"), "A brand new post");
    await userEvent.click(screen.getByRole("button", { name: "Schedule" }));
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("A brand new post")).toBeInTheDocument();
  });

  it("masks campaign cost for a role without deal values", () => {
    open(<SocialCampaigns />, MARKETING);
    expect(screen.queryByText("KES 31,200")).not.toBeInTheDocument();
  });

  it("shows analytics", () => {
    open(<SocialAnalytics />);
    expect(screen.getByText("Engagements per day")).toBeInTheDocument();
  });

  it("has no accessibility violations on the overview", async () => {
    const { container } = open(<SocialOverview />);
    expect(await violations(container)).toEqual([]);
  });
});

describe("Social navigation", () => {
  it("draws the group only where demo screens are on and social.view is held", () => {
    const flat = (n: ReturnType<typeof buildNav>) => n.flatMap((s) => s.items.map((i) => i.key));
    const base = { permissionKeys: ["social.view"], membershipId: "m1" };
    expect(flat(buildNav(base))).not.toContain("social");
    expect(flat(buildNav({ ...base, demoScreens: true }))).toContain("social");
    expect(flat(buildNav({ ...base, permissionKeys: ["leads.view.own"], demoScreens: true }))).not.toContain("social");
  });
});
