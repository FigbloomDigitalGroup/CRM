import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MergeDialog } from "../../../../src/ui/screens/customers/merge/MergeDialog";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";
import { KEYS, REFERENCE, company, directory } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/companies",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const THIS = company({ id: "c-1", name: "Brookside Dairy", website: null, phone: "+254700111222", notes: null });
const DUP = company({ id: "c-2", name: "Brookside Dairy Ltd", website: "https://brookside.example", phone: "+254711999888", industry: "Dairy", ownerMembershipId: null, owner: null, notes: "Imported 3 Oct", contacts: [{ id: "p-9", archivedAt: null }] });

function setup(handlers: Record<string, Handler> = {}, props: Partial<React.ComponentProps<typeof MergeDialog>> = {}, keys = KEYS.sales) {
  const stub = stubClient({
    getReferenceData: () => REFERENCE,
    getCompaniesByCompanyId: ({ params }) => (params?.companyId === "c-1" ? THIS : DUP),
    postCompaniesCheckDuplicates: () => ({ possibleDuplicates: [{ id: "c-2", name: "Brookside Dairy Ltd", industry: "Dairy", location: "Nakuru" }], duplicates: [], hiddenDuplicates: 0 }),
    listCompanyDirectory: () => directory([DUP]),
    ...handlers,
  });
  const onClose = vi.fn();
  const onMerged = vi.fn();
  const onUndone = vi.fn();
  return { ...stub, onClose, onMerged, onUndone, ...renderScreen(<MergeDialog kind="company" id="c-1" onClose={onClose} onMerged={onMerged} onUndone={onUndone} {...props} />, stub.client, { permissionKeys: keys }) };
}

async function pickDuplicate() {
  const dialog = await screen.findByRole("dialog", { name: "Merge duplicates" });
  await userEvent.click(await within(dialog).findByRole("button", { name: /Brookside Dairy Ltd/ }));
  await within(dialog).findByRole("group", { name: "Choose the record to keep" });
  return dialog;
}

describe("Merge duplicates (F3.03, C4)", () => {
  it("suggests likely duplicates first, then compares the two records side by side", async () => {
    setup();
    const dialog = await pickDuplicate();
    expect(within(dialog).getByText(/Contacts, deals, tasks and timelines move to the company you keep/)).toBeInTheDocument();
    const keep = within(dialog).getByRole("group", { name: "Choose the record to keep" });
    expect(within(keep).getByText("THIS RECORD · KEPT")).toBeInTheDocument();
    expect(within(keep).getByText("POSSIBLE DUPLICATE")).toBeInTheDocument();
    const table = within(dialog).getByRole("table", { name: "Field by field" });
    // only the fields that differ are offered
    expect(within(table).getByText("Phone")).toBeInTheDocument();
    expect(within(table).getByText("Website")).toBeInTheDocument();
    expect(within(table).queryByText("Industry")).not.toBeInTheDocument();
  });

  it("defaults to the kept value, fills a blank from the other record, and previews the result", async () => {
    setup();
    const dialog = await pickDuplicate();
    // website is blank on the kept record, so the other record's value is taken by default; the phone keeps the kept record's
    expect(within(dialog).getByRole("button", { name: /Website: take https:\/\/brookside.example/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByRole("button", { name: /Phone: keep \+254700111222/ })).toHaveAttribute("aria-pressed", "true");
    const result = within(dialog).getByText(/is kept/).closest("div")!;
    expect(result).toHaveTextContent("Brookside Dairy is kept");
    expect(result).toHaveTextContent("Brookside Dairy Ltd is archived, never deleted");
    await userEvent.click(within(dialog).getByRole("button", { name: /Phone: take \+254711999888/ }));
    expect(result).toHaveTextContent("phone +254711999888");
  });

  it("merges with the chosen fields into the kept record and offers Undo for the server's window", async () => {
    const merge = vi.fn(() => ({ mergeRecordId: "mr-1", undoExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }));
    const undo = vi.fn(() => ({}));
    const { onMerged, onUndone, onClose } = setup({ postCompaniesByCompanyIdMerge: merge, postMergesByMergeIdUndo: undo });
    const dialog = await pickDuplicate();
    await userEvent.click(within(dialog).getByRole("button", { name: /Phone: take/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Merge into selected" }));
    await waitFor(() => expect(merge).toHaveBeenCalled());
    const args = (merge.mock.calls[0] as unknown[])[0] as { params: Record<string, string>; body: { intoCompanyId: string; fields: Record<string, string> } };
    // the path record is the one that goes away; the body names the one that stays
    expect(args.params.companyId).toBe("c-2");
    expect(args.body.intoCompanyId).toBe("c-1");
    expect(args.body.fields.phone).toBe("loser");
    expect(args.body.fields.website).toBe("loser");
    expect(args.body.fields.name).toBe("winner");
    expect(onMerged).toHaveBeenCalledWith("c-1");
    expect(await screen.findByRole("dialog", { name: "Merged" })).toHaveTextContent("Brookside Dairy Ltd was archived and its history moved to Brookside Dairy");
    await userEvent.click(screen.getByRole("button", { name: "Undo merge" }));
    await waitFor(() => expect(undo).toHaveBeenCalled());
    expect(((undo.mock.calls[0] as unknown[])[0] as { params: { mergeId: string } }).params.mergeId).toBe("mr-1");
    expect(await screen.findByRole("dialog", { name: "Merge undone" })).toBeInTheDocument();
    // the dialog stays open through the merge and the undo (the page behind it only moves on when it is closed)
    expect(onUndone).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("can keep the other record instead, which swaps who is merged into whom", async () => {
    const merge = vi.fn(() => ({ mergeRecordId: "mr-2", undoExpiresAt: null }));
    setup({ postCompaniesByCompanyIdMerge: merge });
    const dialog = await pickDuplicate();
    await userEvent.click(within(dialog).getByRole("button", { name: /POSSIBLE DUPLICATE/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Merge into selected" }));
    await waitFor(() => expect(merge).toHaveBeenCalled());
    const args = (merge.mock.calls[0] as unknown[])[0] as { params: Record<string, string>; body: { intoCompanyId: string } };
    expect(args.params.companyId).toBe("c-1");
    expect(args.body.intoCompanyId).toBe("c-2");
  });

  it("explains a refusal and keeps the dialog open so nothing is lost", async () => {
    setup({ postCompaniesByCompanyIdMerge: () => apiError(400, "Cannot merge into an archived company.", { code: "VALIDATION_ERROR" }) });
    const dialog = await pickDuplicate();
    await userEvent.click(within(dialog).getByRole("button", { name: "Merge into selected" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Merge duplicates" })).toBeInTheDocument();
  });

  it("will not merge a record that is archived already", async () => {
    setup({ getCompaniesByCompanyId: ({ params }) => (params?.companyId === "c-1" ? THIS : { ...DUP, archivedAt: "2026-10-01T00:00:00.000Z" }) });
    const dialog = await pickDuplicate();
    expect(within(dialog).getByRole("button", { name: "Merge into selected" })).toBeDisabled();
    expect(within(dialog).getByText(/archived already/)).toBeInTheDocument();
  });

  it("searches for the duplicate when none is suggested", async () => {
    setup({ postCompaniesCheckDuplicates: () => ({ possibleDuplicates: [], duplicates: [], hiddenDuplicates: 0 }) });
    const dialog = await screen.findByRole("dialog", { name: "Merge duplicates" });
    await userEvent.type(await within(dialog).findByLabelText("Search for the duplicate company"), "Brook");
    expect(await within(dialog).findByRole("button", { name: /Brookside Dairy Ltd/ })).toBeInTheDocument();
  });

  it("merges contacts through the contact route", async () => {
    const merge = vi.fn(() => ({ mergeRecordId: "mr-3", undoExpiresAt: null }));
    const a = { id: "p-1", firstName: "Wanjiru", lastName: "Kamau", phone: "0700", email: "w@x", jobTitle: "Ops", department: null, notes: null, ownerMembershipId: null, company: { name: "Brookside" }, archivedAt: null };
    const b = { ...a, id: "p-2", phone: "0711", email: null };
    const stub = stubClient({
      getReferenceData: () => REFERENCE,
      getContactsByContactId: ({ params }) => (params?.contactId === "p-1" ? a : b),
      listContactDirectory: () => directory([b]),
      postContactsByContactIdMerge: merge,
    });
    renderScreen(<MergeDialog kind="contact" id="p-1" />, stub.client, { permissionKeys: KEYS.sales });
    const dialog = await screen.findByRole("dialog", { name: "Merge duplicates" });
    await userEvent.type(await within(dialog).findByLabelText("Search for the duplicate contact"), "Wan");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Wanjiru Kamau/ }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Merge into selected" }));
    await waitFor(() => expect(merge).toHaveBeenCalled());
    const args = (merge.mock.calls[0] as unknown[])[0] as { params: Record<string, string>; body: { intoContactId: string } };
    expect(args.params.contactId).toBe("p-2");
    expect(args.body.intoContactId).toBe("p-1");
  });

  it("explains that leads are not merged in this release instead of offering a dead button", async () => {
    const stub = stubClient({});
    renderScreen(<MergeDialog kind="lead" id="l-1" />, stub.client, { permissionKeys: KEYS.sales });
    const dialog = await screen.findByRole("dialog", { name: "Merge duplicates" });
    expect(within(dialog).getByText("Leads are not merged in this release.")).toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toHaveTextContent("merge the company or the contact");
    expect(within(dialog).queryByRole("button", { name: "Merge into selected" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    setup();
    const dialog = await pickDuplicate();
    expect(await violations(dialog)).toEqual([]);
  });
});
