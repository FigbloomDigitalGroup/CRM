import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SupportProvider } from "../../../src/ui/screens/palette/SupportContext";
import { buildPaletteItems } from "../../../src/ui/screens/palette/items";
import { ErrorState } from "../../../src/ui/components/states";
import { Sidebar } from "../../../src/ui/shell/Sidebar";
import { UserMenu, type IdentityInfo } from "../../../src/ui/shell/TopBar";
import { expectNoAxeViolations, renderScreen } from "../screens/home/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/deals/d1", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** FIG-1594: "Contact support" is one click away from every page. Each entry point opens the one shared dialog. */

const identity: IdentityInfo = {
  name: "Amina Otieno",
  email: "amina@example.test",
  roleName: "Restricted Technical",
  organisation: "Figbloom",
  avatarUrl: null,
  signedInLocal: null,
  device: null,
  place: null,
  timeZone: null,
  organisationTimeZone: null,
  supportNotice: null,
  preferencesHref: "/o/figbloom/preferences",
  signedInTime: null,
};

const handlers = { createSupportRequest: () => ({ reference: "FB-20261112-K7Q2X9", sent: true }) };

function inShell(ui: React.ReactNode) {
  return renderScreen(<SupportProvider>{ui}</SupportProvider>, handlers, { roleName: "Restricted Technical" });
}

describe("Support entry points", () => {
  it("the sidebar has a Support item with an icon and the word, and it opens the dialog", async () => {
    const { baseElement } = inShell(<Sidebar orgSlug="figbloom" sections={[]} initialCollapsed={false} />);
    const entry = screen.getByRole("button", { name: "Support" });
    expect(entry).toHaveTextContent("Support");
    await userEvent.click(entry);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contact support" })).toBeInTheDocument();
    await expectNoAxeViolations(baseElement);
  });

  it("the user menu has Contact support", async () => {
    inShell(<UserMenu identity={identity} />);
    await userEvent.click(screen.getByRole("button", { name: /account menu/ }));
    await userEvent.click(screen.getByRole("button", { name: "Contact support" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("the shared error and not-found states offer Contact support, but not when signed out", async () => {
    const { unmount } = inShell(<ErrorState error={{ status: 500, envelope: { requestId: "r1" } }} onRetry={() => undefined} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Something wrong? Contact support" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    unmount();

    const notFound = inShell(<ErrorState error={{ status: 404 }} />);
    expect(screen.getByRole("button", { name: "Something wrong? Contact support" })).toBeInTheDocument();
    notFound.unmount();

    inShell(<ErrorState error={{ status: 401 }} />);
    expect(screen.queryByRole("button", { name: /Contact support/ })).not.toBeInTheDocument();
  });

  it("outside the signed-in shell the entry points do not draw", () => {
    renderScreen(<ErrorState error={{ status: 500 }} onRetry={() => undefined} />, {});
    expect(screen.queryByRole("button", { name: /Contact support/ })).not.toBeInTheDocument();
  });

  it("the command palette lists Contact support for every role, with and without the server index", () => {
    const ids = (keys: string[], commands?: never[] | null) =>
      buildPaletteItems({ orgSlug: "figbloom", permissionKeys: keys, query: "support", commands }).flatMap((g) => g.items).map((i) => i.id);
    expect(ids([])).toEqual(["support"]);
    expect(ids([], [])).toEqual(["support"]);
    const item = buildPaletteItems({ orgSlug: "figbloom", permissionKeys: [], query: "", commands: [] }).flatMap((g) => g.items).find((i) => i.id === "support");
    expect(item).toMatchObject({ title: "Contact support", run: "support" });
  });

  it("the dialog shows what is sent with the request, the reply time, and the reference when sent", async () => {
    const { last } = inShell(<ErrorState error={{ status: 500 }} onRetry={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Something wrong? Contact support" }));
    const dialog = await screen.findByRole("dialog");
    const context = within(dialog).getByTestId("support-context");
    expect(context).toHaveTextContent("/o/figbloom/deals/d1");
    expect(context).toHaveTextContent("Restricted Technical");
    expect(context).toHaveTextContent("figbloom");
    expect(dialog).toHaveTextContent(/within one working day/);
    await userEvent.type(within(dialog).getByLabelText("What do you need help with?"), "Stuck");
    await userEvent.type(within(dialog).getByLabelText("Tell us more"), "Help please");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await screen.findByTestId("support-reference")).toHaveTextContent("FB-20261112-K7Q2X9");
    expect(last("createSupportRequest")).toMatchObject({ body: { pagePath: "/o/figbloom/deals/d1" } });
  });
});
