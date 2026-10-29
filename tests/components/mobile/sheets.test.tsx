import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../src/api-client";
import { ApiProvider, MemberProvider, ToastProvider, testMember } from "../../../src/ui";
import { CaptureSheet, LogSheet, QueueSheet } from "../../../src/ui/screens/mobile/Sheets";
import { getQueue } from "../../../src/ui/screens/mobile/queue";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/m", useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));

type Call = (id: string, args?: Record<string, unknown>) => Promise<unknown>;

function ui(call: Call, children: React.ReactNode) {
  const client = { call, operations: {} } as unknown as ApiClient;
  return (
    <ApiProvider client={client}>
      <ToastProvider>
        <MemberProvider value={testMember({ membershipId: "m-test", permissionKeys: ["leads.create", "contacts.create", "activities.create"] })}>{children}</MemberProvider>
      </ToastProvider>
    </ApiProvider>
  );
}

function reference(id: string): unknown {
  if (id === "getReferenceData") return { leadStatuses: [], leadSources: [{ id: "s1", name: "WhatsApp", isActive: true, sequence: 1 }], services: [{ id: "v1", name: "Web Development", isActive: true, sequence: 1 }], lostReasons: [], members: [] };
  return {};
}

beforeEach(() => {
  push.mockClear();
  // The queue is one object per person for the page's life; each test starts with it empty.
  const held = getQueue("figbloom", "m-test");
  for (const i of [...held.list()]) held.discard(i.clientId);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("quick capture sheet (F4.10)", () => {
  it("needs a name, then saves in one request and opens the new lead", async () => {
    const quick = vi.fn(async (..._args: unknown[]) => ({ status: "CREATED", lead: { id: "lead-1" } }));
    const call: Call = async (id, args) => (id === "quickCapture" ? quick(id as never, args as never) : reference(id));
    const onClose = vi.fn();
    render(ui(call, <CaptureSheet onClose={onClose} />));
    const save = screen.getByRole("button", { name: "Save lead" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Company or person *"), "Kenol Kobil");
    await userEvent.type(screen.getByLabelText("Phone *"), "+254722000111");
    await userEvent.click(save);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/figbloom/m/record/lead/lead-1"));
    expect(quick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("a likely duplicate stops the save and asks; Save as new anyway resends with the decision", async () => {
    const bodies: Record<string, unknown>[] = [];
    const call: Call = async (id, args) => {
      if (id !== "quickCapture") return reference(id);
      bodies.push((args as { body: Record<string, unknown> }).body);
      return bodies.length === 1
        ? { status: "DUPLICATE_WARNING", duplicates: [{ entityType: "Lead", id: "dup-1", label: "Kenol Kobil", reasons: ["same phone"] }], options: ["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"] }
        : { status: "CREATED", lead: { id: "lead-2" } };
    };
    render(ui(call, <CaptureSheet onClose={() => undefined} />));
    await userEvent.type(screen.getByLabelText("Company or person *"), "Kenol Kobil");
    await userEvent.type(screen.getByLabelText("Phone *"), "+254722000111");
    await userEvent.click(screen.getByRole("button", { name: "Save lead" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/already in the CRM/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(within(alert).getByRole("button", { name: "Open Kenol Kobil" })).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Add this to them" })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Save as new anyway" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/figbloom/m/record/lead/lead-2"));
    expect(bodies[1]).toMatchObject({ duplicateDecision: "CREATE_ANYWAY" });
  });

  it("with no signal the capture is kept on the phone and reported as saved there", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const call: Call = async (id) => reference(id);
    const onClose = vi.fn();
    render(ui(call, <CaptureSheet onClose={onClose} />));
    await userEvent.type(screen.getByLabelText("Company or person *"), "Offline Person");
    await userEvent.type(screen.getByLabelText("Phone *"), "+254722000111");
    await userEvent.click(screen.getByRole("button", { name: "Save lead" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const held = getQueue("figbloom", "m-test").list();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ kind: "QUICK_CAPTURE", state: "WAITING", label: "New lead: Offline Person" });
    expect(await screen.findByText(/Saved on this phone/)).toBeInTheDocument();
  });
});

describe("log sheet (F4.11)", () => {
  it("a call log needs an outcome, and is sent through the sync batch with its client id", async () => {
    const sent: { mutations: { clientId: string; kind: string; payload: Record<string, unknown> }[] }[] = [];
    const call: Call = async (id, args) => {
      if (id === "applySyncBatch") {
        const body = (args as { body: (typeof sent)[number] }).body;
        sent.push(body);
        return { results: body.mutations.map((m) => ({ clientId: m.clientId, status: "APPLIED" })) };
      }
      return reference(id);
    };
    const onClose = vi.fn();
    render(ui(call, <LogSheet target={{ contactId: "c1", name: "Chebet" }} mode="CALL" onClose={onClose} />));
    expect(screen.getByRole("heading", { name: "How did the call with Chebet go?" })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save to timeline" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Reached" }));
    await userEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.mutations[0]).toMatchObject({ kind: "CALL_LOG", payload: { contactId: "c1", outcome: "REACHED" } });
    expect(getQueue("figbloom", "m-test").list()).toHaveLength(0);
  });
});

describe("waiting list (F4.12)", () => {
  it("shows a conflict in plain words and offers the person's choices, never overwriting", async () => {
    const q = getQueue("figbloom", "m-test");
    const item = q.add({ kind: "QUICK_CAPTURE", payload: { name: "Chebet" }, label: "New lead: Chebet" });
    await q.flush(async () => ({
      results: [{ clientId: item.clientId, status: "CONFLICT", reason: { message: "Someone like this is already in the CRM." }, serverState: { duplicates: [{ id: "d1", label: "Chebet Korir", entityType: "Lead" }] } }],
    }));
    render(ui(async (id) => reference(id), <QueueSheet onClose={() => undefined} />));
    expect(screen.getByText("Someone like this is already in the CRM.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Chebet Korir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to them" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as new" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(q.list()).toHaveLength(0);
  });
});
