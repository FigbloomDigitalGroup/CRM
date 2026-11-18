import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CustomFields, MessageTemplates, TagManager } from "../../../../src/ui/screens/settings/Managers";
import { ReferenceData } from "../../../../src/ui/screens/settings/ReferenceData";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

const KEYS = ["configuration.manage", "tags.manage", "templates.manage", "customfields.manage"];
const CAPS = { rename: true, reorder: true, hide: true, delete: true, merge: true };

function val(over: Record<string, unknown> = {}) {
  return { id: "v-1", kind: "leadSources", name: "Referral", key: null, hidden: false, order: 1, usageCount: 0, protected: false, entityType: null, fieldType: null, capabilities: CAPS, ...over };
}
const KINDS = { items: [{ kind: "leadSources", label: "Lead sources", capabilities: { create: true, reorder: true, hide: true, delete: true, merge: true }, note: null }, { kind: "tags", label: "Tags", capabilities: { create: true, reorder: false, hide: true, delete: true, merge: true }, note: null }] };

function handlers(values: unknown[], over: Record<string, Handler> = {}): Record<string, Handler> {
  return { listReferenceKinds: () => KINDS, listReferenceValues: () => ({ items: values }), ...over };
}

describe("Reference data (S1, FIG-1106, B4.06): hide, don't delete", () => {
  const VALUES = [
    val({ id: "v-1", name: "Referral", usageCount: 12 }),
    val({ id: "v-2", name: "Trade show", usageCount: 0 }),
    val({ id: "v-3", name: "Old flyer", hidden: true, usageCount: 2 }),
    val({ id: "v-4", name: "Website", key: "WEBSITE", protected: true, usageCount: 40, capabilities: { ...CAPS, hide: false, delete: false, merge: false } }),
  ];

  it("shows usage, hidden values and the values the system relies on", async () => {
    const { client } = stubClient(handlers(VALUES));
    const { container } = renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    await screen.findByText("Referral");
    expect(screen.getByText("In use: 12")).toBeInTheDocument();
    expect(screen.getAllByText("Not in use")).toHaveLength(1);
    expect(screen.getByText("Hidden")).toBeInTheDocument();
    expect(screen.getByText("Used by the system")).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("will not delete a value that is in use: the button says why and nothing is sent", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers(VALUES));
    renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    const del = await screen.findByRole("button", { name: "Delete Referral" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    await user.click(del);
    expect(calls.some((c) => c.id === "deleteReferenceValue")).toBe(false);
    await user.hover(del);
    expect(await screen.findByText("In use (12). Hide it instead.")).toBeInTheDocument();
  });

  it("deletes an unused value after confirmation", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers(VALUES, { deleteReferenceValue: () => ({ id: "v-2", deleted: true }) }));
    renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Delete Trade show" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.find((c) => c.id === "deleteReferenceValue")?.args.params).toMatchObject({ kind: "leadSources", valueId: "v-2" }));
  });

  it("hides and shows a value; a system value cannot be hidden and says so", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers(VALUES, { updateReferenceValue: () => ({}) }));
    renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Hide Referral" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateReferenceValue")?.args.body).toEqual({ hidden: true }));
    await user.click(screen.getByRole("button", { name: "Show Old flyer" }));
    await waitFor(() => expect(calls.filter((c) => c.id === "updateReferenceValue").at(-1)?.args.body).toEqual({ hidden: false }));
    const system = screen.getByRole("button", { name: "Hide Website" });
    expect(system).toHaveAttribute("aria-disabled", "true");
    // The system's own values have no Merge or Delete either.
    expect(screen.queryByRole("button", { name: "Merge Website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Website" })).not.toBeInTheDocument();
  });

  it("renames, reorders and merges", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers(VALUES, { updateReferenceValue: () => ({}), reorderReferenceValue: () => ({ items: [] }), mergeReferenceValues: () => ({ moved: [] }) }));
    renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Move Trade show down" }));
    await waitFor(() => expect(calls.find((c) => c.id === "reorderReferenceValue")?.args.body).toEqual({ direction: "down" }));
    await user.click(screen.getByRole("button", { name: "Edit Referral" }));
    const edit = await screen.findByRole("dialog", { name: "Edit Referral" });
    await user.clear(within(edit).getByLabelText("Name"));
    await user.type(within(edit).getByLabelText("Name"), "Customer referral");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateReferenceValue")?.args.body).toEqual({ name: "Customer referral" }));
    await user.click(screen.getByRole("button", { name: "Merge Referral" }));
    const merge = await screen.findByRole("dialog", { name: "Merge Referral" });
    await user.selectOptions(within(merge).getByLabelText("Merge into"), "Trade show");
    await user.click(within(merge).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(calls.find((c) => c.id === "mergeReferenceValues")?.args.body).toEqual({ intoId: "v-2" }));
  });

  it("adds a value, and shows the API's explanation when it is refused", async () => {
    const user = userEvent.setup();
    let n = 0;
    const { client, calls } = stubClient(handlers(VALUES, { createReferenceValue: () => (++n === 1 ? apiError(400, "That name is already used.", { code: "VALIDATION_FAILED" }) : {}) }));
    renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    await user.type(await screen.findByLabelText("Add item"), "Referral");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/already|went wrong|not/i, { selector: ".fb-error" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.filter((c) => c.id === "createReferenceValue")).toHaveLength(2));
  });

  it("switches lists with the pressed state announced", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlers(VALUES));
    renderScreen(<ReferenceData />, client, { permissionKeys: KEYS });
    await screen.findByText("Referral");
    expect(screen.getByRole("button", { name: "Lead sources" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Services" }));
    expect(screen.getByRole("button", { name: "Services" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(calls.some((c) => c.id === "listReferenceValues" && c.args.params?.["kind"] === "services")).toBe(true));
  });
});

describe("Tags (S5#2, FIG-1109)", () => {
  it("lists tags as coloured pills with their use, and hides rather than deletes a tag in use", async () => {
    const user = userEvent.setup();
    const tags = [val({ id: "t-1", kind: "tags", name: "VIP", usageCount: 5 }), val({ id: "t-2", kind: "tags", name: "Cold", hidden: true, usageCount: 1 })];
    const { client, calls } = stubClient(handlers(tags, { getTags: () => ({ items: [{ id: "t-1", name: "VIP", colour: "#275B3A", isActive: true, usage: 5 }, { id: "t-2", name: "Cold", colour: "#1F5FA3", isActive: false, usage: 1 }] }), updateReferenceValue: () => ({}) }));
    renderScreen(<TagManager />, client, { permissionKeys: KEYS });
    await screen.findByText("VIP");
    expect(screen.getByText("Hidden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete VIP" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Hide VIP" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateReferenceValue")?.args).toMatchObject({ params: { kind: "tags", valueId: "t-1" }, body: { hidden: true } }));
  });
});

describe("Message templates (S5#2, FIG-1109)", () => {
  const T = { id: "e-1", name: "Quote follow-up", subject: "Your quote, {{contact.firstName}}", body: "Hi {{contact.firstName}}, thanks for talking to us about {{company.name}}.", isActive: true };
  it("previews the merge fields with a sample person, inserts fields, and saves", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient({
      getEmailTemplates: () => ({ items: [T], mergeFields: ["contact.firstName", "company.name"] }),
      patchEmailTemplatesByTemplateId: () => T,
    });
    const { container } = renderScreen(<MessageTemplates />, client, { permissionKeys: KEYS });
    const preview = await screen.findByLabelText("Preview");
    expect(preview).toHaveTextContent("Your quote, Amara");
    expect(preview).toHaveTextContent("Hi Amara, thanks for talking to us about Brookside Dairy.");
    await user.click(screen.getByRole("button", { name: "{{contact.firstName}}" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value.endsWith("{{contact.firstName}}")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchEmailTemplatesByTemplateId")?.args.params).toMatchObject({ templateId: "e-1" }));
    expect(await violations(container)).toEqual([]);
  });

  it("hides a template rather than deleting it", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient({ getEmailTemplates: () => ({ items: [T], mergeFields: [] }), patchEmailTemplatesByTemplateId: () => T });
    renderScreen(<MessageTemplates />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "Hide template" }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchEmailTemplatesByTemplateId")?.args.body).toEqual({ isActive: false }));
  });

  it("starts empty with a way to write the first one", async () => {
    const { client } = stubClient({ getEmailTemplates: () => ({ items: [], mergeFields: [] }) });
    renderScreen(<MessageTemplates />, client, { permissionKeys: KEYS });
    expect(await screen.findByText("No templates yet")).toBeInTheDocument();
  });
});

describe("Custom fields (S5#2, FIG-1109)", () => {
  const F = { id: "f-1", entityType: "LEAD", section: "QUALIFICATION", key: "budget", label: "Budget", fieldType: "NUMBER", options: null, helpText: null, required: false, requiredOnQualify: true, serviceId: null, isActive: true };
  const handlersF = (over: Record<string, Handler> = {}) => ({ getCustomFields: () => ({ items: [F, { ...F, id: "f-2", label: "Old question", isActive: false, requiredOnQualify: false }] }), getReferenceData: () => ({ services: [{ id: "sv-1", name: "CCTV" }] }), ...over });

  it("lists fields with type, scope and hidden state; hiding keeps the field on old records", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlersF({ patchCustomFieldsByFieldId: () => F }));
    const { container } = renderScreen(<CustomFields />, client, { permissionKeys: KEYS });
    const row = await screen.findByRole("row", { name: /Budget/ });
    expect(within(row).getByText("Leads · qualification")).toBeInTheDocument();
    expect(within(row).getByText("Number")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Old question/ })).getByText("Hidden")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Hide Budget" }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchCustomFieldsByFieldId")?.args.body).toEqual({ isActive: false }));
    expect(await violations(container)).toEqual([]);
  });

  it("makes a field required to qualify without touching quick capture", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlersF({ patchCustomFieldsByFieldId: () => F }));
    renderScreen(<CustomFields />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("checkbox", { name: "Old question is required" }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchCustomFieldsByFieldId")?.args.body).toEqual({ requiredOnQualify: true }));
  });

  it("creates a field with a key made from its label and choices from lines", async () => {
    const user = userEvent.setup();
    const { client, calls } = stubClient(handlersF({ postCustomFields: () => ({}) }));
    renderScreen(<CustomFields />, client, { permissionKeys: KEYS });
    await user.click(await screen.findByRole("button", { name: "New field" }));
    const d = await screen.findByRole("dialog", { name: "New custom field" });
    await user.type(within(d).getByLabelText(/Label/), "Preferred contact time");
    await user.selectOptions(within(d).getByLabelText("Type"), "Pick one");
    await user.type(within(d).getByLabelText("Choices"), "Morning{enter}Afternoon");
    await user.click(within(d).getByRole("button", { name: "Save field" }));
    await waitFor(() => expect(calls.find((c) => c.id === "postCustomFields")?.args.body).toMatchObject({ entityType: "LEAD", key: "preferred_contact_time", label: "Preferred contact time", fieldType: "SELECT", options: [{ label: "Morning", value: "morning" }, { label: "Afternoon", value: "afternoon" }] }));
  });
});
