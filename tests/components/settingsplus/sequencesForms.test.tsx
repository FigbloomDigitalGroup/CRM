import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SequencesEditor } from "../../../src/ui/screens/settingsplus/Sequences";
import { WebFormsEditor } from "../../../src/ui/screens/settingsplus/WebForms";
import { sequenceBody, validateSequences, type SequenceView } from "../../../src/ui/screens/settingsplus/sequencesModel";
import { applyChoices, choicesFor, validateFormChoices } from "../../../src/ui/screens/settingsplus/webFormsModel";
import { apiError, renderScreen, stubClient } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const step = (over: Record<string, unknown> = {}) => ({ position: 0, dayOffset: 0, kind: "TASK", title: "Call task", description: null, priority: "MEDIUM", emailTemplateId: null, emailMode: "DRAFT", ...over });
const SEQ = { id: "s1", name: "Website lead", description: null, subjectType: "LEAD", trigger: "WEBSITE_LEAD", isActive: true, running: 4, steps: [step(), step({ position: 1, dayOffset: 2, title: "Follow up" })] } as unknown as SequenceView;
const MGMT = ["cadences.manage", "configuration.manage"];

describe("sequences editor reads and writes the real API (FIG-1174, B6.18)", () => {
  it("lists the API sequences with their steps and the running count", async () => {
    const stub = stubClient({ getSequences: () => ({ items: [SEQ] }), getEmailTemplates: () => ({ items: [] }) });
    renderScreen(<SequencesEditor />, stub.client, { permissionKeys: MGMT });
    expect(await screen.findByLabelText("Step 2 of Website lead")).toHaveValue("Follow up");
    expect(screen.getByText(/4 running/)).toBeInTheDocument();
  });

  it("pausing sends PATCH with isActive false and offers no stage or approval step", async () => {
    const patch = vi.fn(() => SEQ);
    const stub = stubClient({ getSequences: () => ({ items: [SEQ] }), getEmailTemplates: () => ({ items: [] }), patchSequencesBySequenceId: patch });
    renderScreen(<SequencesEditor />, stub.client, { permissionKeys: MGMT });
    await userEvent.click(await screen.findByRole("switch", { name: "Website lead on" }));
    expect(screen.getByRole("status")).toHaveTextContent(/pauses/);
    const kinds = within(screen.getByLabelText("Kind of step 1 of Website lead")).getAllByRole("option").map((o) => o.textContent);
    expect(kinds.join(" ")).not.toMatch(/stage|approval|discount|move/i);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stub.calls.some((c) => c.id === "patchSequencesBySequenceId")).toBe(true));
    const call = stub.calls.find((c) => c.id === "patchSequencesBySequenceId")!;
    expect(call.args.params).toEqual({ orgSlug: "figbloom", sequenceId: "s1" });
    expect((call.args.body as { isActive: boolean }).isActive).toBe(false);
  });

  it("a role without cadences.manage reads but cannot edit; an unavailable release is explained", async () => {
    const stub = stubClient({ getSequences: () => ({ items: [SEQ] }), getEmailTemplates: () => ({ items: [] }) });
    const first = renderScreen(<SequencesEditor />, stub.client, { permissionKeys: ["tasks.create"] });
    expect(await screen.findByLabelText("Sequence name")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /New sequence/ })).toHaveAttribute("aria-disabled", "true");
    first.unmount();
    const off = stubClient({ getSequences: () => apiError(403, "no", { code: "FEATURE_UNAVAILABLE", feature: { key: "release.v11", reason: "release", availableIn: "V1.1" } }), getEmailTemplates: () => ({ items: [] }) });
    renderScreen(<SequencesEditor />, off.client, { permissionKeys: MGMT });
    expect(await screen.findByText("Sequences is not available yet")).toBeInTheDocument();
  });

  it("model: steps must run in order, emails need a template, and the body carries no stage or owner fields", () => {
    const bad = { ...SEQ, steps: [step({ dayOffset: 5 }), step({ dayOffset: 2, kind: "EMAIL" })] } as unknown as SequenceView;
    const errors = validateSequences([bad]).join(" ");
    expect(errors).toMatch(/earlier than the step before/);
    expect(errors).toMatch(/needs an email template/);
    expect(Object.keys(sequenceBody(SEQ, false)).sort()).toEqual(["isActive", "name", "steps", "trigger"]);
  });
});

const FORM = {
  id: "f1", name: "Website enquiry", status: "DRAFT", publicKey: "wfk_abc", successMessage: "Thanks", allowedOrigins: [], captchaConfigured: false,
  fields: [
    { key: "name", label: "Full name", type: "text", required: true, maps: "name" },
    { key: "email", label: "Email", type: "email", required: true, maps: "email" },
  ],
};

describe("web forms editor reads and writes the real API (FIG-1174, B6.19)", () => {
  it("shows the form, its public address, and the submission log", async () => {
    const stub = stubClient({
      getWebForms: () => ({ items: [FORM] }),
      getWebFormsByFormIdSubmissions: () => ({ items: [{ id: "x1", at: "2026-11-04T08:00:00Z", outcome: "SPAM_CONTENT", explanation: "The submission held too many links.", duplicateWarning: null }] }),
    });
    renderScreen(<WebFormsEditor />, stub.client, { permissionKeys: MGMT });
    expect(await screen.findByLabelText("Form address")).toHaveTextContent("/api/public/orgs/figbloom/forms/wfk_abc/submissions");
    expect(await screen.findByText(/too many links/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Full name" })).toHaveAttribute("aria-disabled", "true");
  });

  it("adding a field and publishing sends PATCH with the new fields and PUBLISHED", async () => {
    const stub = stubClient({ getWebForms: () => ({ items: [FORM] }), getWebFormsByFormIdSubmissions: () => ({ items: [] }), patchWebFormsByFormId: () => FORM });
    renderScreen(<WebFormsEditor />, stub.client, { permissionKeys: MGMT });
    await userEvent.click(await screen.findByRole("switch", { name: "Company" }));
    await userEvent.click(screen.getByRole("switch", { name: "Published" }));
    expect(screen.getByRole("status")).toHaveTextContent(/goes live/);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stub.calls.some((c) => c.id === "patchWebFormsByFormId")).toBe(true));
    const body = stub.calls.find((c) => c.id === "patchWebFormsByFormId")!.args.body as { status: string; fields: { key: string }[] };
    expect(body.status).toBe("PUBLISHED");
    expect(body.fields.map((f) => f.key)).toEqual(["name", "email", "company"]);
  });

  it("with no forms it offers to create one, and a refusal is explained", async () => {
    const first = renderScreen(<WebFormsEditor />, stubClient({ getWebForms: () => ({ items: [] }) }).client, { permissionKeys: MGMT });
    expect(await screen.findByRole("button", { name: /Create a form/ })).toBeInTheDocument();
    first.unmount();
    renderScreen(<WebFormsEditor />, stubClient({ getWebForms: () => apiError(403) }).client, { permissionKeys: [] });
    expect(await screen.findByText(/part of your workspace/i)).toBeInTheDocument();
  });

  it("model: name stays on, and email or phone is required", () => {
    const choices = choicesFor(FORM.fields as never);
    expect(validateFormChoices(choices)).toEqual([]);
    const noContact = choices.map((c) => (c.key === "email" ? { ...c, on: false } : c));
    expect(validateFormChoices(noContact)[0]).toMatch(/Email or Phone/);
    expect(applyChoices(FORM.fields as never, choices.map((c) => (c.key === "phone" ? { ...c, on: true } : c))).map((f) => f.key)).toEqual(["name", "email", "phone"]);
  });
});
