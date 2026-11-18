import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiAssistantSettings } from "../../../src/ui/screens/assistant/settings/AiAssistantSettings";
import { SavedViewsBar } from "../../../src/ui/screens/views/SavedViewsBar";
import { SavedViewsNav } from "../../../src/ui/screens/views/SavedViewsNav";
import { fromDto, toFilters } from "../../../src/ui/screens/views/store";
import { apiError, renderScreen, type Handlers } from "../screens/home/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/leads", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const MINE = { id: "v1", entity: "leads", name: "Hot leads", scope: "PERSONAL", filters: { tab: "all", temp: "HOT" }, mine: true, ownerName: "Test Member", canEdit: true, pinned: true, pinPosition: 1 };
const THEIRS = { id: "v2", entity: "leads", name: "Wanjiru's view", scope: "SHARED", filters: { tab: "all" }, mine: false, ownerName: "Wanjiru", canEdit: false, pinned: false, pinPosition: null };
const KEYS = { permissionKeys: ["leads.view.own", "views.share"] };

function bar(handlers: Handlers = {}) {
  const view = renderScreen(<SavedViewsBar page="leads" current={{ tab: "all", filters: { temp: "HOT", status: "" } }} onApply={vi.fn()} />, { getViews: () => ({ items: [MINE, THEIRS] }), ...handlers }, KEYS);
  return { ...view, user: userEvent.setup() };
}

describe("saved views on the real API (X4, FIG-1173)", () => {
  it("maps the server's views and stores only the filters that are set", () => {
    expect(fromDto(MINE as never, "m-1", 0)).toMatchObject({ page: "leads", shared: false, pinned: true, by: "m-1", state: { tab: "all", filters: { temp: "HOT" } } });
    expect(fromDto(THEIRS as never, "m-1", 1)).toMatchObject({ shared: true, byName: "Wanjiru" });
    expect(fromDto(THEIRS as never, "m-1", 1).by).not.toBe("m-1");
    expect(toFilters({ tab: "all", filters: { temp: "HOT", status: "" } })).toEqual({ tab: "all", temp: "HOT" });
  });

  it("lists the views the server returned, with the shared one marked", async () => {
    const { last } = bar();
    expect(await screen.findByRole("button", { name: /Hot leads/ })).toBeInTheDocument();
    expect(screen.getByText("Shared by Wanjiru")).toBeInTheDocument();
    expect(last("getViews")?.query).toMatchObject({ entity: "leads" });
  });

  it("Save as view creates it on the server with the list set-up", async () => {
    const { user, last } = bar({ postViews: () => ({ ...MINE, id: "v3", name: "New one" }) });
    await screen.findByRole("button", { name: /Hot leads/ });
    await user.click(screen.getByRole("button", { name: "Save as view" }));
    await user.type(screen.getByLabelText("Name for this view"), "New one");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(last("postViews")?.body).toEqual({ entity: "leads", name: "New one", filters: { tab: "all", temp: "HOT" } }));
  });

  it("shows the API's own sentence when a save is refused", async () => {
    const { user } = bar({
      postViews: () => {
        throw { status: 422, envelope: { code: "VALIDATION_FAILED", message: "A view cannot use the value filter for your role.", requestId: "r", fieldErrors: [] } };
      },
    });
    await screen.findByRole("button", { name: /Hot leads/ });
    await user.click(screen.getByRole("button", { name: "Save as view" }));
    await user.type(screen.getByLabelText("Name for this view"), "Value view");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/cannot use the value filter/)).toBeInTheDocument();
  });

  it("only the owner can change a view; a colleague's shared view has no rename, share or delete", async () => {
    const { user, count } = bar({ patchViewsByViewId: () => MINE });
    await screen.findByRole("button", { name: /Hot leads/ });
    await user.click(screen.getByRole("button", { name: "Manage views" }));
    const rows = screen.getAllByRole("listitem");
    const theirs = rows.find((r) => r.textContent?.includes("Wanjiru's view"))!;
    expect(theirs.querySelector('button[aria-label^="Delete"]')).toHaveAttribute("aria-disabled", "true");
    const rename = Array.from(theirs.querySelectorAll("button")).find((b) => b.textContent === "Rename")!;
    expect(rename).toHaveAttribute("aria-disabled", "true");
    await user.click(rename);
    expect(count("patchViewsByViewId")).toBe(0);
  });

  it("pins and shares through the pin and update routes", async () => {
    const { user, last } = bar({ putViewsByViewIdPin: () => MINE, patchViewsByViewId: () => MINE });
    await screen.findByRole("button", { name: /Hot leads/ });
    await user.click(screen.getByRole("button", { name: "Manage views" }));
    await user.click(screen.getByRole("button", { name: /Unpin/ }));
    await waitFor(() => expect(last("putViewsByViewIdPin")?.body).toEqual({ pinned: false }));
    await user.click(screen.getByRole("button", { name: /^Share$/ }));
    await waitFor(() => expect(last("patchViewsByViewId")?.body).toEqual({ scope: "SHARED" }));
  });

  it("says plainly that saved views are not available when the organisation is not on V1.1", async () => {
    bar({
      getViews: () => {
        throw apiError(403, { code: "FEATURE_UNAVAILABLE" });
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("not available");
  });

  it("the sidebar lists the pinned views from the server in order", async () => {
    const view = renderScreen(<SavedViewsNav />, { getViews: () => ({ items: [MINE] }) }, KEYS);
    expect(await screen.findByRole("link", { name: /Hot leads/ })).toHaveAttribute("href", "/o/figbloom/leads?savedView=v1");
    expect(view.last("getViews")?.query).toMatchObject({ pinned: "true" });
  });
});

describe("Settings, AI assistant on the real API (S6#2, FIG-1175)", () => {
  const SETTINGS = { enabled: true, providerConfigured: true, options: { summaries: true, drafts: true, scoring: true, retention: false }, limits: { perUser: 15, perOrganisation: 500 }, usage: { today: 0, remaining: 15 }, canConfigure: true };

  it("shows the server's switches and saves a change with PUT /assistant/settings", async () => {
    const user = userEvent.setup();
    const view = renderScreen(<AiAssistantSettings />, { getAssistantSettings: () => SETTINGS, putAssistantSettings: () => ({ ...SETTINGS, options: { ...SETTINGS.options, drafts: false } }) });
    const drafts = await screen.findByRole("switch", { name: "Message drafts" });
    expect(drafts).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Churn risk hints (V2)" })).toHaveAttribute("aria-checked", "false");
    await user.click(drafts);
    await waitFor(() => expect(view.last("putAssistantSettings")?.body).toEqual({ drafts: false }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Message drafts" })).toHaveAttribute("aria-checked", "false"));
  });

  it("the organisation switch is sent as enabled", async () => {
    const user = userEvent.setup();
    const view = renderScreen(<AiAssistantSettings />, { getAssistantSettings: () => SETTINGS, putAssistantSettings: () => ({ ...SETTINGS, enabled: false }) });
    await user.click(await screen.findByRole("switch", { name: "Ask Figbloom" }));
    await waitFor(() => expect(view.last("putAssistantSettings")?.body).toEqual({ enabled: false }));
  });

  it("a member without ai.configure sees the state but cannot change it, and nothing is sent", async () => {
    const user = userEvent.setup();
    const view = renderScreen(<AiAssistantSettings />, { getAssistantSettings: () => ({ ...SETTINGS, canConfigure: false }) });
    const sw = await screen.findByRole("switch", { name: "Message drafts" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    await user.click(sw);
    expect(view.count("putAssistantSettings")).toBe(0);
  });

  it("explains a refused read instead of showing demo values", async () => {
    renderScreen(<AiAssistantSettings />, {
      getAssistantSettings: () => {
        throw apiError(403);
      },
    });
    expect(await screen.findByRole("region")).toBeInTheDocument();
  });

  it("says when no model is connected to the deployment", async () => {
    renderScreen(<AiAssistantSettings />, { getAssistantSettings: () => ({ ...SETTINGS, providerConfigured: false }) });
    expect(await screen.findByText(/No assistant model is connected/)).toBeInTheDocument();
  });
});
