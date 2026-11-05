import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../../../src/ui/screens/assistant/AssistantPanel";
import { useAssistantActions } from "../../../src/ui/screens/assistant/api";
import type { AskContext } from "../../../src/ui/screens/assistant/types";
import { apiError, renderScreen, type Handlers } from "../screens/home/harness";

const sales: AskContext = { orgSlug: "figbloom", roleName: "Sales", permissionKeys: ["leads.view.own", "deals.view.own", "tasks.view.own"] };

const ACTION = { proposalId: "p1", kind: "task" as const, title: "Follow up on the proposal to Sarova", forWhom: "You", due: "Tomorrow", about: "Sarova · deal" };
const ANSWER = { requestId: "r1", message: { who: "ai", text: "1 proposal is waiting.", basis: "Based on Sales access · 3 leads, 2 deals", action: ACTION, actionState: "pending" }, usage: { today: 1, limit: 15 } };

/** The panel wired to the real hooks, against a stand-in API. */
function Wired(props: Partial<React.ComponentProps<typeof AssistantPanel>>) {
  const a = useAssistantActions();
  return <AssistantPanel open onClose={vi.fn()} enabled ctx={sales} respond={a.respond} onConfirmAction={a.confirm} onDismissAction={a.dismiss} onFeedback={a.feedback} usage={{ today: 0, limit: 15 }} {...props} />;
}

function mount(handlers: Handlers, props: Partial<React.ComponentProps<typeof AssistantPanel>> = {}) {
  const view = renderScreen(<Wired {...props} />, { postAssistantAsk: () => ANSWER, ...handlers });
  return { ...view, user: userEvent.setup() };
}

async function ask(user: ReturnType<typeof userEvent.setup>, text = "proposals with no reply") {
  await user.type(screen.getByRole("textbox", { name: "Ask a question" }), `${text}{Enter}`);
  return screen.findByRole("group", { name: "Proposed action" });
}

describe("Ask Figbloom on the real API: nothing acts without confirmation (X2, FIG-1171)", () => {
  it("asks /assistant/ask and shows the proposed task as a card; the confirm route is not called until Confirm is pressed", async () => {
    const confirm = vi.fn(() => ({ status: "CONFIRMED" }));
    const { user, count, last } = mount({ postAssistantProposalsByProposalIdConfirm: confirm });
    const card = await ask(user);
    expect(last("postAssistantAsk")?.body).toEqual({ question: "proposals with no reply" });
    expect(card).toHaveTextContent("NOTHING HAPPENS UNTIL YOU CONFIRM");
    expect(count("postAssistantProposalsByProposalIdConfirm")).toBe(0);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(card).toHaveTextContent("Task created"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(last("postAssistantProposalsByProposalIdConfirm")?.params).toMatchObject({ proposalId: "p1" });
  });

  it("Not now tells the server the suggestion was declined and never confirms", async () => {
    const { user, count } = mount({ postAssistantProposalsByProposalIdDismiss: () => ({ status: "DISMISSED" }) });
    await ask(user);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("group", { name: "Proposed action" })).toBeNull();
    await waitFor(() => expect(count("postAssistantProposalsByProposalIdDismiss")).toBe(1));
    expect(count("postAssistantProposalsByProposalIdConfirm")).toBe(0);
  });

  it("a confirmation the server refuses (expired) leaves the card pending and says why", async () => {
    const expired = { status: 422, envelope: { code: "VALIDATION_FAILED", message: "This suggestion has expired. Ask again.", requestId: "x", fieldErrors: [{ path: "expiresAt", message: "Expired.", code: "PROPOSAL_EXPIRED" }] } };
    const { user } = mount({
      postAssistantProposalsByProposalIdConfirm: () => {
        throw expired;
      },
    });
    const card = await ask(user);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(card).toHaveTextContent("has expired"));
    expect(card).not.toHaveTextContent("Task created");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("sends the record the person is looking at, and a draft stays editable and unsent", async () => {
    const { user, last } = mount(
      { postAssistantAsk: () => ({ requestId: "r2", message: { who: "ai", text: "Here is a draft.", draft: "Hi, thanks for your time." }, usage: { today: 1, limit: 15 } }) },
      { ctx: { ...sales, record: { kind: "lead", name: "this lead", id: "lead-9" } } },
    );
    await user.click(screen.getByRole("button", { name: "Draft a follow-up" }));
    const box = await screen.findByRole("textbox", { name: "Draft message" });
    expect(last("postAssistantAsk")?.body).toMatchObject({ record: { kind: "lead", id: "lead-9" } });
    await user.type(box, " Thanks!");
    expect((box as HTMLTextAreaElement).value).toMatch(/Thanks!$/);
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });

  it("feedback goes to the server for that answer", async () => {
    const { user, last } = mount({ postAssistantRequestsByRequestIdFeedback: () => ({ requestId: "r1", feedback: "up" }) });
    await ask(user);
    await user.click(screen.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(last("postAssistantRequestsByRequestIdFeedback")?.body).toEqual({ value: "up" }));
  });
});

describe("Ask Figbloom: what the server says, the panel shows", () => {
  it("shows the answer's basis, and masked answers arrive masked (the server filters; the panel adds nothing)", async () => {
    const { user } = mount({ postAssistantAsk: () => ({ requestId: "r3", message: { who: "ai", text: "Open pipeline: [value hidden]", basis: "Based on Sales access · 3 leads, 2 deals" }, usage: { today: 1, limit: 15 } }) });
    await user.type(screen.getByRole("textbox", { name: "Ask a question" }), "pipeline{Enter}");
    expect(await screen.findByText(/value hidden/)).toBeInTheDocument();
    expect(screen.getByText(/Based on Sales access/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/KES/);
  });

  it("when the organisation switches it off, says so and offers no input", () => {
    mount({}, { enabled: false });
    expect(screen.getByTestId("assistant-off")).toHaveTextContent("The assistant is switched off");
    expect(screen.queryByRole("textbox", { name: "Ask a question" })).toBeNull();
  });

  it("an unavailable assistant (not on V1.1, no role) is explained with no input", () => {
    mount({}, { unavailable: "Your role is not allowed to use the assistant." });
    expect(screen.getByTestId("assistant-unavailable")).toHaveTextContent("not allowed");
    expect(screen.queryByRole("textbox", { name: "Ask a question" })).toBeNull();
  });

  it("stops at the daily limit the server reports and says when it resets", () => {
    mount({}, { usage: { today: 15, limit: 15 } });
    expect(screen.getByTestId("assistant-limit")).toHaveTextContent("resets tomorrow");
    expect(screen.getByRole("textbox", { name: "Ask a question" })).toBeDisabled();
  });

  it("a 429 shows the API's sentence and no Try again", async () => {
    const { user } = mount({
      postAssistantAsk: () => {
        throw apiError(429, { message: "You have used your 15 questions for today. The limit resets tomorrow." });
      },
    });
    await user.type(screen.getByRole("textbox", { name: "Ask a question" }), "overdue{Enter}");
    await screen.findByText(/used your 15 questions/);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a server failure shows a plain error, changes nothing and offers Try again", async () => {
    let calls = 0;
    const { user } = mount({
      postAssistantAsk: () => {
        if (++calls === 1) throw apiError(500);
        return { requestId: "r4", message: { who: "ai", text: "Back again" }, usage: { today: 1, limit: 15 } };
      },
    });
    await user.type(screen.getByRole("textbox", { name: "Ask a question" }), "overdue{Enter}");
    await screen.findByText(/couldn’t answer that just now/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Back again")).toBeInTheDocument());
    expect(screen.queryByText(/couldn’t answer/)).toBeNull();
  });

  it("renders nothing when closed", () => {
    mount({}, { open: false });
    expect(screen.queryByTestId("assistant-panel")).toBeNull();
  });
});
