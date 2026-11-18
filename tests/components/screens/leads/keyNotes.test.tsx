import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { KeyNotesPreview } from "../../../../src/ui/screens/leads/KeyNotesPreview";
import { SALES_KEYS, apiError, axeViolations, renderScreen } from "./harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/o/figbloom/leads" }));

/** FIG-1678 (P2-24): key notes in the lead preview. */

const note = (id: string, text: string, authorName = "Dev Sales") => ({ id, authorName, occurredAt: "2026-11-10T09:00:00.000Z", text });
const answer = (notes: ReturnType<typeof note>[], total = notes.length, canAdd = true) => ({ canAdd, leads: { "lead-1": { total, notes } } });
const view = (handlers: Record<string, unknown>) => renderScreen(<KeyNotesPreview leadId="lead-1" name="Wafula Ltd" onClose={() => undefined} />, { keys: SALES_KEYS, handlers: handlers as never });

describe("key notes preview", () => {
  it("asks for the lead's notes in one batched call and shows them newest first with author, a View all link and no a11y violations", async () => {
    const r = view({ getLeadsKeyNotes: answer([note("n2", "Second note"), note("n1", "First note", "Mary")], 5) });
    expect(await screen.findByText("Second note")).toBeInTheDocument();
    expect(screen.getByText("Mary")).toBeInTheDocument();
    expect(r.calls.filter((c) => c.id === "getLeadsKeyNotes")).toHaveLength(1);
    expect(r.calls.find((c) => c.id === "getLeadsKeyNotes")!.args).toMatchObject({ query: { leadIds: "lead-1" } });
    expect(screen.getByRole("link", { name: /View all \(5\) in the Conversation/ })).toHaveAttribute("href", "/o/figbloom/leads/lead-1#conversation");
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });

  it("shows an empty state with the add box", async () => {
    view({ getLeadsKeyNotes: answer([]) });
    expect(await screen.findByText("No key notes yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Add note")).toBeInTheDocument();
  });

  it("adds a note at once (optimistic), with Ctrl+Enter, writes the same NOTE activity, and returns focus", async () => {
    const user = userEvent.setup();
    let saved = false;
    const r = view({
      getLeadsKeyNotes: () => answer(saved ? [note("n9", "Call back Friday")] : []),
      postActivities: () => {
        saved = true;
        return { id: "n9" };
      },
    });
    const box = await screen.findByLabelText("Add note");
    await user.type(box, "Call back Friday");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("Call back Friday")).toBeInTheDocument();
    await waitFor(() => expect(r.calls.filter((c) => c.id === "postActivities")).toHaveLength(1));
    expect(r.calls.find((c) => c.id === "postActivities")!.args).toMatchObject({ body: { type: "NOTE", leadId: "lead-1", description: "Call back Friday" } });
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue("");
  });

  it("does not double submit", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const r = view({ getLeadsKeyNotes: answer([]), postActivities: () => new Promise((res) => (release = () => res({ id: "x" }))) });
    await user.type(await screen.findByLabelText("Add note"), "Once");
    await user.keyboard("{Control>}{Enter}{Enter}{/Control}");
    release();
    await waitFor(() => expect(r.calls.filter((c) => c.id === "postActivities")).toHaveLength(1));
  });

  it("rolls back and says why when the save fails, keeping what was typed", async () => {
    const user = userEvent.setup();
    view({ getLeadsKeyNotes: answer([note("n1", "Existing")]), postActivities: () => apiError(500) });
    const box = await screen.findByLabelText("Add note");
    await user.type(box, "Will fail");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/We could not save the note/);
    expect(box).toHaveValue("Will fail");
    expect(screen.queryByText("Saving…")).toBeNull();
    expect(screen.getByText("Existing")).toBeInTheDocument();
  });

  it("a role that may not add notes sees why instead of the box", async () => {
    view({ getLeadsKeyNotes: answer([note("n1", "Readable")], 1, false) });
    expect(await screen.findByText("Readable")).toBeInTheDocument();
    expect(screen.getByText("You can read notes but not add them")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add note")).toBeNull();
  });

  it("shows the explained no-access state when the API refuses", async () => {
    view({ getLeadsKeyNotes: () => apiError(403, { code: "FORBIDDEN", denial: { yourRole: "Finance", ownerRoles: ["Management"] } }) });
    expect(await screen.findByRole("region", { name: /Notes on this lead/ })).toBeInTheDocument();
  });
});
