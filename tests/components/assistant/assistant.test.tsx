import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../../../src/ui/screens/assistant/AssistantPanel";
import { demoRespond } from "../../../src/ui/screens/assistant/demo/respond";
import type { AskContext } from "../../../src/ui/screens/assistant/types";

const sales: AskContext = { orgSlug: "figbloom", roleName: "Sales", permissionKeys: ["leads.view.own", "deals.view.own", "tasks.view.own"] };
const management: AskContext = { ...sales, roleName: "Management", permissionKeys: [...sales.permissionKeys, "deals.view.all", "deals.view.value", "leads.view.all"] };
const finance: AskContext = { orgSlug: "figbloom", roleName: "Finance", permissionKeys: ["finance.view.payments"] };

beforeEach(() => localStorage.clear());

function panel(over: Partial<React.ComponentProps<typeof AssistantPanel>> = {}) {
  const props = { open: true, onClose: vi.fn(), enabled: true, ctx: sales, ...over };
  render(<AssistantPanel {...props} />);
  return { ...props, user: userEvent.setup() };
}

describe("Ask Figbloom: nothing acts without confirmation (X2, FIG-1171)", () => {
  it("shows a proposed task as a card and does nothing until Confirm is pressed", async () => {
    const onConfirmAction = vi.fn();
    const { user } = panel({ onConfirmAction });
    await user.click(screen.getByRole("button", { name: /proposals have no reply/i }));
    const card = await screen.findByRole("group", { name: "Proposed action" });
    expect(card).toHaveTextContent("NOTHING HAPPENS UNTIL YOU CONFIRM");
    expect(onConfirmAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirmAction).toHaveBeenCalledTimes(1);
    expect(onConfirmAction.mock.calls[0]![0]).toMatchObject({ kind: "task" });
    expect(card).toHaveTextContent("Task created");
  });

  it("Not now removes the card and never runs the action", async () => {
    const onConfirmAction = vi.fn();
    const { user } = panel({ onConfirmAction });
    await user.click(screen.getByRole("button", { name: /proposals have no reply/i }));
    await screen.findByRole("group", { name: "Proposed action" });
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("group", { name: "Proposed action" })).toBeNull();
    expect(onConfirmAction).not.toHaveBeenCalled();
  });

  it("every answer the demo gives leaves any action pending", async () => {
    for (const q of ["proposals with no reply", "hot leads with no task", "overdue", "pipeline worth", "something else"]) {
      for (const ctx of [sales, management, finance]) {
        const out = await demoRespond(q, ctx);
        expect(out.filter((m) => m.actionState && m.actionState !== "pending")).toEqual([]);
      }
    }
  });

  it("a draft can be edited and is never sent from the panel", async () => {
    const { user } = panel({ ctx: { ...sales, record: { kind: "lead", name: "this lead" } } });
    await user.click(screen.getByRole("button", { name: "Draft a follow-up" }));
    const box = await screen.findByRole("textbox", { name: "Draft message" });
    await user.type(box, " Thanks!");
    expect((box as HTMLTextAreaElement).value).toMatch(/Thanks!$/);
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });
});

describe("Ask Figbloom: what it may say (hard rule 7)", () => {
  it("does not say a deal value to a role without deals.view.value", async () => {
    const out = await demoRespond("What is my open pipeline worth?", sales);
    expect(out.map((m) => m.text + (m.items ?? []).map((i) => i.sub).join(" ")).join(" ")).not.toMatch(/KES/);
    expect(out.at(-1)!.text).toMatch(/hidden for your role/);
  });

  it("does not put a value in a list item for a role without it, but does for one with it", async () => {
    const hidden = await demoRespond("proposals with no reply", sales);
    expect(JSON.stringify(hidden)).not.toMatch(/KES/);
    const shown = await demoRespond("proposals with no reply", management);
    expect(JSON.stringify(shown)).toMatch(/KES/);
  });

  it("explains instead of answering about records the role cannot open", async () => {
    const out = await demoRespond("show hot leads with no task", finance);
    expect(out.at(-1)!.text).toMatch(/can’t open leads/);
    expect(out.at(-1)!.items).toBeUndefined();
  });

  it("says what the answer was based on", async () => {
    const out = await demoRespond("overdue", sales);
    expect(out.at(-1)!.basis).toMatch(/Based on Sales access/);
  });
});

describe("Ask Figbloom: off, limits and errors", () => {
  it("when the organisation switches it off, says so and offers no input", () => {
    panel({ enabled: false });
    expect(screen.getByTestId("assistant-off")).toHaveTextContent("The assistant is switched off");
    expect(screen.queryByRole("textbox", { name: "Ask a question" })).toBeNull();
  });

  it("stops at the daily limit and says when it resets", async () => {
    const { user } = panel({ limit: 1 });
    await user.type(screen.getByRole("textbox", { name: "Ask a question" }), "overdue{Enter}");
    await screen.findByTestId("assistant-limit");
    expect(screen.getByRole("textbox", { name: "Ask a question" })).toBeDisabled();
    expect(screen.getByTestId("assistant-limit")).toHaveTextContent("resets tomorrow");
  });

  it("shows an error, changes nothing and offers Try again", async () => {
    const respond = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([{ id: "1", who: "ai", text: "Back again" }]);
    const { user } = panel({ respond });
    await user.type(screen.getByRole("textbox", { name: "Ask a question" }), "overdue{Enter}");
    await screen.findByText(/couldn’t answer that just now/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Back again")).toBeInTheDocument());
    expect(screen.queryByText(/couldn’t answer/)).toBeNull();
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when closed", () => {
    panel({ open: false });
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
  });
});
