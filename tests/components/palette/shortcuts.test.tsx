import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../src/ui/components/toast";
import { MemberProvider, testMember } from "../../../src/ui/data/member";
import { ToolsOverlays, ToolsTriggers, toolsEnabled, toolsPanel } from "../../../src/ui/screens/assistant/ToolsHost";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/leads/abc", useRouter: () => ({ push, refresh: vi.fn() }) }));

function mount(keys: string[]) {
  render(
    <MemberProvider value={testMember({ permissionKeys: keys, roleName: "Sales" })}>
      <ToastProvider>
        <ToolsTriggers />
        <input aria-label="A field" />
        <ToolsOverlays />
      </ToastProvider>
    </MemberProvider>,
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
    fireEvent.click(screen.getByRole("button", { name: "Ask Figbloom" }));
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Help and what/ }));
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
    expect(screen.getByTestId("help-panel")).toBeInTheDocument();
  });

  it("opens the assistant in its off state when the organisation switched it off", () => {
    localStorage.setItem("figbloom-demo-ai-settings", JSON.stringify({ assist: false }));
    mount([]);
    fireEvent.click(screen.getByRole("button", { name: "Ask Figbloom" }));
    expect(screen.getByTestId("assistant-off")).toBeInTheDocument();
  });

  it("is off in a production build unless demo screens are switched on", () => {
    expect(toolsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(toolsEnabled({ NODE_ENV: "production", NEXT_PUBLIC_DEMO_SCREENS: "true" })).toBe(true);
    expect(toolsEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});
