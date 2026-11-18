import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContactDetailScreen } from "../../../../src/ui/screens/contacts/ContactDetailScreen";
import { MANAGEMENT, REFERENCE, SALES, VIEWER, apiError, contact, renderScreen, stubClient, violations } from "./fixtures";
import type { Handler } from "./fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/contacts/p1",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function setup(handlers: Record<string, Handler> = {}, keys = SALES, c: Record<string, unknown> = contact()) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    getContactsByContactId: () => c,
    getActivities: () => ({
      items: [
        { id: "a1", type: "CALL", subject: "Call · Reached", description: "Agreed to review the quote", occurredAt: iso(1), outcome: "Reached", authorMembershipId: "m-1" },
        { id: "a2", type: "NOTE", subject: "Note", description: "Internal note", occurredAt: iso(2), authorMembershipId: "m-1" },
        { id: "a3", type: "WHATSAPP", subject: "WhatsApp", description: "Sent the brochure", occurredAt: iso(3), authorMembershipId: "m-mg" },
      ],
    }),
    getCommunications: () => [
      { id: "cm1", channel: "PHONE", direction: "OUTBOUND", summary: "Agreed to review the quote", occurredAt: iso(1), activityId: "a1" },
      { id: "cm2", channel: "EMAIL", direction: "INBOUND", subject: "Re: quote", summary: "Please resend", occurredAt: iso(0), activityId: null, authorMembershipId: null },
    ],
    getTasks: () => ({ items: [{ id: "t1", title: "Send revised quote", dueAt: iso(-1), status: "PENDING" }, { id: "t2", title: "Done thing", dueAt: iso(5), status: "COMPLETED" }] }),
    ...handlers,
  });
  return { ...stub, ...renderScreen(<ContactDetailScreen contactId="p1" />, stub.client, { permissionKeys: keys }) };
}

describe("Contact detail (F3.02, C3)", () => {
  it("shows the person, company, facts, call and WhatsApp, conversations without duplicates, and open tasks", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Brookside Dairy" }).length).toBeGreaterThan(0);
    const facts = screen.getByRole("region", { name: "Details" });
    expect(within(facts).getByText("0712 345 605")).toBeInTheDocument();
    expect(within(facts).getByText("Operations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call Chebet/ })).toHaveAttribute("href", "tel:+254712345605");
    expect(screen.getByRole("link", { name: /Open WhatsApp/ })).toHaveAttribute("href", "https://wa.me/254712345605");
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:chebet@brookside.example");
    const convo = screen.getByRole("region", { name: "Recent conversations" });
    await within(convo).findByText(/Agreed to review the quote/);
    // The logged call is one entry (the communication that belongs to it is not added again), the note is not a conversation, the inbound email is.
    expect(within(convo).getAllByText(/Agreed to review the quote/)).toHaveLength(1);
    expect(within(convo).queryByText(/Internal note/)).toBeNull();
    expect(within(convo).getByText(/Re: quote: Please resend/)).toBeInTheDocument();
    expect(within(convo).getByText(/Sent the brochure/)).toBeInTheDocument();
    const tasks = screen.getByRole("region", { name: "Tasks" });
    expect(await within(tasks).findByText("Send revised quote")).toBeInTheDocument();
    expect(within(tasks).queryByText("Done thing")).toBeNull();
  });

  it("supports a standalone contact: no company, a prompt to link one, and no dead links", async () => {
    setup({}, SALES, contact({ companyId: null, company: null, jobTitle: null }));
    expect(await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("Standalone contact").length).toBeGreaterThan(0);
    expect(screen.getByText("A standalone contact: not linked to a company yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Link a company" })).toBeInTheDocument();
  });

  it("with no phone there is no Call or WhatsApp, and no email means no Email button", async () => {
    setup({}, SALES, contact({ phone: "", email: "" }));
    await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 });
    expect(screen.queryByRole("link", { name: /Call/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Email" })).toBeNull();
  });

  it("is read-only for a role that may only view: no Edit, Merge, Archive, Add task or owner select; no Call without the conversations key", async () => {
    setup({}, VIEWER);
    await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 });
    for (const n of ["Edit", "Merge", "Archive"]) expect(screen.queryByRole("button", { name: n })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Owner" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Call Chebet/ })).toBeNull();
  });

  it("Management can reassign the owner and merge", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ patchContactsByContactId: () => ({}) }, MANAGEMENT);
    await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 });
    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Owner" }), "m-mg");
    await waitFor(() => expect(calls.some((c) => c.id === "patchContactsByContactId" && (c.args.body as { ownerMembershipId?: string }).ownerMembershipId === "m-mg")).toBe(true));
  });

  it("an archived contact is read-only with a banner, no reach buttons, and Restore for those who may", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postContactsByContactIdRestore: () => ({}) }, SALES, contact({ archivedAt: "2026-09-01T00:00:00.000Z" }));
    expect(await screen.findByText(/Everything on this contact is read-only until it’s restored/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Call Chebet/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postContactsByContactIdRestore")).toBe(true));
  });

  it("archives with an undo", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postContactsByContactIdArchive: () => ({}) });
    await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 });
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postContactsByContactIdArchive")).toBe(true));
    expect(await screen.findByText("Chebet Kiprono archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("adds a task for the contact", async () => {
    const user = userEvent.setup();
    const { calls } = setup({ postTasks: () => ({ id: "t9" }) });
    await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 });
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    const drawer = await screen.findByRole("dialog", { name: "New task" });
    await user.type(within(drawer).getByLabelText(/What needs doing/), "Call back");
    await user.click(within(drawer).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postTasks")).toBe(true));
    expect(calls.find((c) => c.id === "postTasks")!.args.body).toMatchObject({ title: "Call back", contactId: "p1" });
  });

  it("explains a refusal, and a missing contact", async () => {
    const { unmount } = setup({ getContactsByContactId: () => apiError(403, "Nope", { denial: { yourRole: "Restricted Technical", ownerRoles: ["Management"], whoToAsk: ["Management"] } }) }, VIEWER);
    expect(await screen.findByRole("region", { name: /contact/i })).toHaveTextContent("Restricted Technical");
    unmount();
    setup({ getContactsByContactId: () => apiError(404, "Not found") });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = setup({}, MANAGEMENT);
    await screen.findByRole("heading", { name: "Chebet Kiprono", level: 1 });
    await screen.findByText("Send revised quote");
    expect(await violations(container)).toEqual([]);
  });
});
