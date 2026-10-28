import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactsScreen } from "../../../../src/ui/screens/contacts/ContactsScreen";
import { FALLBACK_PROMPT_MS } from "../../../../src/ui/screens/contacts/QuickLogPrompt";
import { REFERENCE, ROWS, SALES, apiError, directory, renderScreen, stubClient } from "./fixtures";
import type { Handler } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/contacts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setup(handlers: Record<string, Handler> = {}) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    listContactDirectory: () => directory(ROWS),
    getQuickLogPrompt: () => ({ hasPhone: true, code: null, telHref: "tel:+254712345605", whatsappHref: "https://wa.me/254712345605" }),
    quickLog: () => ({ activityId: "a1", communicationId: "cm1", taskId: null }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<ContactsScreen />, stub.client, { permissionKeys: SALES }) };
}

afterEach(() => {
  setVisibility("visible");
  window.sessionStorage.clear();
  vi.useRealTimers();
});

/** Leaving the tab (the phone app opens) and coming back, as a person does after a call. */
function leaveAndReturn() {
  act(() => setVisibility("hidden"));
  act(() => setVisibility("visible"));
}

describe("Call and WhatsApp log prompt (F3.02, B3.08)", () => {
  it("asks 'How did it go?' on return from a call and logs it in two taps", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const row = (await screen.findByRole("link", { name: "Chebet Kiprono" })).closest("tr")!;
    await user.click(within(row).getByRole("link", { name: "Call Chebet Kiprono" }));
    expect(screen.queryByRole("dialog", { name: "How did it go?" })).toBeNull();
    leaveAndReturn();
    const dialog = await screen.findByRole("dialog", { name: "How did it go?" });
    expect(within(dialog).getByText("Call with Chebet")).toBeInTheDocument();
    const log = within(dialog).getByRole("button", { name: "Log it" });
    expect(log).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Reached" })); // tap one
    await user.click(log); // tap two
    await waitFor(() => expect(calls.some((c) => c.id === "quickLog")).toBe(true));
    const sent = calls.find((c) => c.id === "quickLog")!;
    expect(sent.args.body).toEqual({ channel: "CALL", outcome: "REACHED", contactId: "p1" });
    expect((sent.args as { idempotencyKey?: string }).idempotencyKey).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "How did it go?" })).toBeNull());
    expect(await screen.findByText("Call with Chebet logged")).toBeInTheDocument();
  });

  it("WhatsApp is logged as WhatsApp, with the note and a next action as a follow-up task", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const row = (await screen.findByRole("link", { name: "Chebet Kiprono" })).closest("tr")!;
    await user.click(within(row).getByRole("link", { name: "WhatsApp Chebet Kiprono" }));
    leaveAndReturn();
    const dialog = await screen.findByRole("dialog", { name: "How did it go?" });
    expect(within(dialog).getByText("WhatsApp with Chebet")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Left a message" }));
    await user.type(within(dialog).getByLabelText("What happened"), "Asked for the quote");
    await user.type(within(dialog).getByLabelText("Next action"), "Send the quote");
    await user.click(within(dialog).getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(calls.some((c) => c.id === "quickLog")).toBe(true));
    const body = calls.find((c) => c.id === "quickLog")!.args.body as Record<string, unknown>;
    expect(body).toMatchObject({ channel: "WHATSAPP", outcome: "LEFT_MESSAGE", note: "Asked for the quote", contactId: "p1" });
    expect((body.followUp as { title: string }).title).toBe("Send the quote");
  });

  it("Skip closes the prompt and logs nothing", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const row = (await screen.findByRole("link", { name: "Chebet Kiprono" })).closest("tr")!;
    await user.click(within(row).getByRole("link", { name: "Call Chebet Kiprono" }));
    leaveAndReturn();
    const dialog = await screen.findByRole("dialog", { name: "How did it go?" });
    await user.click(within(dialog).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "How did it go?" })).toBeNull());
    expect(calls.some((c) => c.id === "quickLog")).toBe(false);
  });

  it("a refused log keeps the prompt open and says why", async () => {
    const user = userEvent.setup();
    setup({ quickLog: () => apiError(422, "No phone number on file.", { fieldErrors: [] }) });
    const row = (await screen.findByRole("link", { name: "Chebet Kiprono" })).closest("tr")!;
    await user.click(within(row).getByRole("link", { name: "Call Chebet Kiprono" }));
    leaveAndReturn();
    const dialog = await screen.findByRole("dialog", { name: "How did it go?" });
    await user.click(within(dialog).getByRole("button", { name: "No answer" }));
    await user.click(within(dialog).getByRole("button", { name: "Log it" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/phone number|Some of what you entered/);
    expect(screen.getByRole("dialog", { name: "How did it go?" })).toBeInTheDocument();
  });

  it("still asks when the tab never lost focus (a desktop with no phone app)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup();
    const row = (await screen.findByRole("link", { name: "Chebet Kiprono" })).closest("tr")!;
    await user.click(within(row).getByRole("link", { name: "Call Chebet Kiprono" }));
    expect(screen.queryByRole("dialog", { name: "How did it go?" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(FALLBACK_PROMPT_MS + 50);
    });
    expect(await screen.findByRole("dialog", { name: "How did it go?" })).toBeInTheDocument();
  });
});
