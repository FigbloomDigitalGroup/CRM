import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderScreen, type Handlers } from "../screens/home/harness";
import { ToolsOverlays, ToolsTriggers, toolsEnabled, toolsPanel } from "../../../src/ui/screens/assistant/ToolsHost";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/leads/abc", useRouter: () => ({ push, refresh: vi.fn() }) }));

const SETTINGS = { enabled: true, providerConfigured: true, options: {}, limits: { perUser: 15, perOrganisation: 500 }, usage: { today: 0, remaining: 15 }, canConfigure: false };

function mount(keys: string[], handlers: Handlers = {}) {
  return renderScreen(
    <>
      <ToolsTriggers />
      <input aria-label="A field" />
      <ToolsOverlays />
    </>,
    { getAssistantSettings: () => SETTINGS, ...handlers },
    { permissionKeys: keys, roleName: "Sales" },
  );
}

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
});
afterEach(() => act(() => toolsPanel.set(null)));

describe("global keyboard shortcuts (X3, FIG-1172)", () => {
  it("Ctrl+K and Cmd+K open the palette; Escape closes it", () => {
    mount(["leads.view.own"]);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("G then L goes to Leads for a role that may open them, and does nothing for one that may not", () => {
    mount(["leads.view.own"]);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "l" });
    expect(push).toHaveBeenCalledWith("/o/figbloom/leads");
    push.mockClear();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "p" });
    expect(push).not.toHaveBeenCalled();
  });

  it("G then D is refused for a role without deals access", () => {
    mount(["leads.view.own"]);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "d" });
    expect(push).not.toHaveBeenCalled();
  });

  it("N opens a new lead only with leads.create", () => {
    mount(["leads.view.own"]);
    fireEvent.keyDown(window, { key: "n" });
    expect(push).not.toHaveBeenCalled();
  });

  it("single letters are ignored while typing in a field", () => {
    mount(["leads.view.own", "leads.create"]);
    const field = screen.getByLabelText("A field");
    fireEvent.keyDown(field, { key: "n" });
    fireEvent.keyDown(field, { key: "?" });
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("help-panel")).toBeNull();
  });

  it("? opens Help, and Escape closes it", () => {
    mount([]);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
    expect(screen.getByText(/Help · Leads/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("help-panel")).toBeNull();
  });

  it("the buttons open one panel at a time", () => {
    mount([]);
    fireEvent.click(screen.getByRole("button", { name: "Ask Figbloom assistant" }));
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Help and what/ }));
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
  });

  it("opens the assistant in its off state when the server says the organisation switched it off", async () => {
    mount([], { getAssistantSettings: () => ({ ...SETTINGS, enabled: false }) });
    fireEvent.click(screen.getByRole("button", { name: "Ask Figbloom assistant" }));
    expect(await screen.findByTestId("assistant-off")).toBeInTheDocument();
  });

  it("explains an organisation that is not on V1.1 instead of failing", async () => {
    mount([], {
      getAssistantSettings: () => {
        throw { status: 403, envelope: { code: "FEATURE_UNAVAILABLE", message: "x", requestId: "r", fieldErrors: [] } };
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Figbloom assistant" }));
    expect(await screen.findByTestId("assistant-unavailable")).toHaveTextContent("switched off for your organisation");
  });

  it("Help shows the role-filtered tips and release notes from the API", async () => {
    mount([], {
      getHelp: () => ({ items: [], tips: { title: "Leads", tips: ["Server tip for this role."] } }),
      getWhatsNew: () => ({ release: "v1.1", items: [{ id: "n1", release: "v1.1", date: "2026-11-01", title: "Server note", detail: "From the API." }] }),
      getCommands: () => ({ commands: [], search: {}, shortcuts: [{ label: "Server shortcut", keys: "Z" }] }),
    });
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByText("Server tip for this role.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Server note")).toBeInTheDocument());
    expect(screen.getByText("Server shortcut")).toBeInTheDocument();
  });

  it("is on in every build (the V1.1 tools are wired; the server says when an organisation is not on V1.1)", () => {
    expect(toolsEnabled()).toBe(true);
  });
});
