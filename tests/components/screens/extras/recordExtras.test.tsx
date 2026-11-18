import { act, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordExtras, type ExtrasKind } from "../../../../src/ui/screens/extras/RecordExtras";
import { KIND_OPS, refuseFile } from "../../../../src/ui/screens/extras/kinds";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";
import type { Handler } from "../deals/harness";

vi.mock("../../../../src/ui/data/client", async (orig) => {
  const real = await orig<typeof import("../../../../src/ui/data/client")>();
  return { ...real, putSignedUpload: vi.fn(async () => undefined) };
});
import { putSignedUpload } from "../../../../src/ui/data/client";

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const ALL = ["attachments.manage", "tags.manage", "configuration.manage"];

const TAGS = [
  { id: "t1", name: "Priority", colour: "sun" },
  { id: "t2", name: "Dairy", colour: "forest" },
];
const FIELDS = [
  { id: "f1", key: "herd_size", label: "Herd size", fieldType: "NUMBER", options: null, required: false, serviceId: null, sortOrder: 1, isActive: true },
  { id: "f2", key: "channel", label: "Preferred channel", fieldType: "SELECT", options: ["WhatsApp", "Call", "Email"], required: true, serviceId: null, sortOrder: 2, isActive: true },
];
const FILE = (over: Record<string, unknown> = {}) => ({
  id: "a1", title: null, shared: true, uploadedByMembershipId: "m-1", createdAt: iso(1),
  file: { id: "fl1", name: "Brief.pdf", sizeBytes: 420_000, mimeType: "application/pdf", status: "READY" },
  ...over,
});
const COMMENT = (over: Record<string, unknown> = {}) => ({
  id: "c1", authorName: "Dev Sales", body: "Called the farm.", deleted: false, edited: false, mentions: [], canEdit: true, canDelete: true, createdAt: iso(1), ...over,
});

/** Handlers for one record kind: the per-kind operation names come from the same table the panel uses. */
function handlersFor(kind: ExtrasKind, over: Record<string, Handler> = {}): Record<string, Handler> {
  const o = KIND_OPS[kind];
  return {
    [o.tags]: () => ({ tags: [TAGS[0]] }),
    getTags: () => ({ items: TAGS }),
    getCustomFields: () => ({ items: FIELDS }),
    [o.record]: () => ({ id: "r1", serviceId: null, customFields: { herd_size: 210 } }),
    [o.attachments]: () => ({ items: [FILE()] }),
    [o.comments]: () => ({ comments: [COMMENT()], following: false }),
    [o.mentionable]: () => ({ members: [{ membershipId: "m-9", name: "Wanjiru Kamau", roleName: "Delivery" }] }),
    getLeadsByLeadIdScore: () => ({ score: 72, band: "HOT", factors: [{ key: "src", label: "Referral", points: 20 }, { key: "idle", label: "Quiet for 9 days", points: -5 }], computedAt: iso(0) }),
    getCompaniesByCompanyIdHealth: () => ({ score: 55, band: "WATCH", factors: [{ key: "recent", label: "Last contact", points: 10 }], computedAt: iso(0) }),
    ...over,
  };
}

function setup(kind: ExtrasKind, over: Record<string, Handler> = {}, keys = ALL, archived = false) {
  const stub = stubClient(handlersFor(kind, over));
  return { ...stub, ...renderScreen(<RecordExtras kind={kind} id="r1" archived={archived} />, stub.client, { permissionKeys: keys }) };
}

const KINDS: ExtrasKind[] = ["lead", "contact", "company", "deal"];

beforeEach(() => vi.mocked(putSignedUpload).mockClear());
afterEach(() => vi.useRealTimers());

describe("Record extras (F3.08, X1): one panel on four record types", () => {
  it.each(KINDS)("shows tags, custom fields, files and comments on a %s, from that record's own endpoints", async (kind) => {
    const { calls } = setup(kind);
    expect(await screen.findByText("Priority")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Herd size/)).toHaveValue(210);
    expect(await screen.findByText("Brief.pdf")).toBeInTheDocument();
    expect(await screen.findByText("Called the farm.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Tags/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Internal comments" })).toBeInTheDocument();
    const o = KIND_OPS[kind];
    const ids = calls.map((c) => c.id);
    for (const op of [o.tags, o.attachments, o.comments]) expect(ids).toContain(op);
    expect(calls.find((c) => c.id === o.tags)!.args.params).toMatchObject({ orgSlug: "figbloom", [o.param]: "r1" });
    expect(calls.find((c) => c.id === "getCustomFields")!.args.query).toMatchObject({ entityType: o.entityType, section: "GENERAL" });
  });

  it("shows the lead score with its reasons, and customer health on companies only", async () => {
    setup("lead");
    const card = await screen.findByRole("region", { name: "Lead score" });
    expect(within(card).getByText("72")).toBeInTheDocument();
    expect(within(card).getByText("Hot")).toBeInTheDocument();
    expect(within(card).getByText(/Referral/)).toBeInTheDocument();
    expect(within(card).getByText("+20")).toBeInTheDocument();
    expect(within(card).getByText("-5")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Customer health" })).not.toBeInTheDocument();
  });

  it("shows customer health on a company, none of it on a contact or deal", async () => {
    const { unmount } = setup("company");
    const card = await screen.findByRole("region", { name: "Customer health" });
    expect(within(card).getByText(/Needs attention/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Lead score" })).not.toBeInTheDocument();
    unmount();
    setup("contact");
    await screen.findByText("Priority");
    expect(screen.queryByRole("region", { name: "Customer health" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Lead score" })).not.toBeInTheDocument();
  });

  it.each(KINDS)("follows and unfollows a %s", async (kind) => {
    const o = KIND_OPS[kind];
    let following = false;
    const { calls } = setup(kind, {
      [o.comments]: () => ({ comments: [], following }),
      [o.follow]: () => { following = true; return { following: true }; },
      [o.unfollow]: () => { following = false; return { following: false }; },
    });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Follow" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Following" })).toHaveAttribute("aria-pressed", "true");
    expect(calls.map((c) => c.id)).toContain(o.follow);
    await user.click(screen.getByRole("button", { name: "Following" }));
    expect(await screen.findByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(calls.map((c) => c.id)).toContain(o.unfollow);
  });

  describe("tags", () => {
    it("adds an existing tag and creates a new one when the role manages tags", async () => {
      const o = KIND_OPS.company;
      const { calls } = setup("company");
      const user = userEvent.setup();
      await screen.findByText("Priority");
      const picker = screen.getByRole("combobox", { name: "Add tag" });
      expect(within(picker).queryByRole("option", { name: "Priority" })).not.toBeInTheDocument();
      await user.selectOptions(picker, "Dairy");
      await waitFor(() => expect(calls.find((c) => c.id === o.changeTags)?.args.body).toEqual({ addTagIds: ["t2"] }));
      await user.selectOptions(screen.getByRole("combobox", { name: "Add tag" }), "Create a new tag…");
      await user.type(screen.getByLabelText("New tag name"), "Organic");
      await user.click(screen.getByRole("button", { name: "Add" }));
      await waitFor(() => expect(calls.filter((c) => c.id === o.changeTags).pop()?.args.body).toEqual({ addTagNames: ["Organic"] }));
    });

    it("does not offer creating a tag without tags.manage", async () => {
      setup("lead", {}, ["attachments.manage"]);
      await screen.findByText("Priority");
      expect(within(screen.getByRole("combobox", { name: "Add tag" })).queryByRole("option", { name: /Create a new tag/ })).not.toBeInTheDocument();
    });

    it("removes a tag, offers Undo, and only sends the removal when Undo is not used", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const o = KIND_OPS.deal;
      const { calls } = setup("deal");
      await screen.findByText("Priority");
      fireEvent.click(screen.getByRole("button", { name: "Remove tag Priority" }));
      expect(screen.queryByRole("button", { name: "Remove tag Priority" })).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: /Undo/ }));
      expect(await screen.findByRole("button", { name: "Remove tag Priority" })).toBeInTheDocument();
      await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
      expect(calls.some((c) => c.id === o.changeTags)).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Remove tag Priority" }));
      await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
      await waitFor(() => expect(calls.find((c) => c.id === o.changeTags)?.args.body).toEqual({ removeTagIds: ["t1"] }));
    });

    it("explains in place when the role cannot see tags", async () => {
      setup("contact", { [KIND_OPS.contact.tags]: () => apiError(403) });
      expect(await screen.findByText(/Tags aren’t available to your role on this contact/)).toBeInTheDocument();
    });
  });

  describe("custom fields", () => {
    it("saves a typed value as the field is left, then offers Undo", async () => {
      const o = KIND_OPS.lead;
      const { calls } = setup("lead", { [o.patch]: () => ({ id: "r1" }) });
      const user = userEvent.setup();
      const input = await screen.findByLabelText(/Herd size/);
      await user.clear(input);
      await user.type(input, "300");
      await user.tab();
      await waitFor(() => expect(calls.find((c) => c.id === o.patch)?.args.body).toEqual({ customFields: { herd_size: 300 } }));
      expect(await screen.findByRole("button", { name: /Undo/ })).toBeInTheDocument();
    });

    it("saves a dropdown at once and does not save an unchanged value", async () => {
      const o = KIND_OPS.deal;
      const { calls } = setup("deal", { [o.patch]: () => ({ id: "r1" }) });
      const user = userEvent.setup();
      const select = await screen.findByLabelText(/Preferred channel/);
      await user.selectOptions(select, "Call");
      await waitFor(() => expect(calls.find((c) => c.id === o.patch)?.args.body).toEqual({ customFields: { channel: "Call" } }));
      const herd = screen.getByLabelText(/Herd size/);
      await user.click(herd);
      await user.tab();
      expect(calls.filter((c) => c.id === o.patch)).toHaveLength(1);
    });

    it("will not clear a required field and says why", async () => {
      const o = KIND_OPS.company;
      const { calls } = setup("company", { [o.record]: () => ({ id: "r1", customFields: { channel: "Call" } }) });
      const user = userEvent.setup();
      const select = await screen.findByLabelText(/Preferred channel/);
      await waitFor(() => expect(select).toHaveValue("Call"));
      await user.selectOptions(select, "");
      expect(await screen.findByRole("alert")).toHaveTextContent("Preferred channel is required.");
      expect(calls.some((c) => c.id === o.patch)).toBe(false);
    });

    it("rejects text in a number field before sending, and shows the server's field message", async () => {
      const o = KIND_OPS.contact;
      const { calls } = setup("contact", { [o.patch]: () => apiError(400, "Some custom fields are not valid.", { code: "VALIDATION_ERROR", fieldErrors: [{ path: "customFields.herd_size", message: "Herd size is too large." }] }) });
      const user = userEvent.setup();
      const input = await screen.findByLabelText(/Herd size/);
      await user.clear(input);
      await user.type(input, "99999999");
      await user.tab();
      await waitFor(() => expect(calls.some((c) => c.id === o.patch)).toBe(true));
    });

    it("is read-only on an archived record", async () => {
      setup("lead", {}, ALL, true);
      expect(await screen.findByLabelText(/Herd size/)).toHaveAttribute("readonly");
      expect(screen.getByText(/read-only until this record is restored/)).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Add tag" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Remove tag/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Write a comment")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Follow" })).toBeDisabled();
    });
  });

  describe("attachments", () => {
    it("uploads through the signed link, then completes the upload", async () => {
      const o = KIND_OPS.company;
      const { calls } = setup("company", {
        [o.addAttachment]: () => ({ attachment: { id: "a2", file: { id: "fl2" } }, upload: { url: "/api/storage/blob?token=x", method: "PUT", headers: { "Content-Type": "application/pdf" } } }),
        postAttachmentsByAttachmentIdComplete: () => ({ id: "a2" }),
      });
      const user = userEvent.setup();
      await screen.findByText("Brief.pdf");
      const file = new File(["%PDF-1.4"], "Quote.pdf", { type: "application/pdf" });
      await user.upload(screen.getByLabelText("Choose files to upload"), file);
      await waitFor(() => expect(calls.map((c) => c.id)).toContain("postAttachmentsByAttachmentIdComplete"));
      expect(calls.find((c) => c.id === o.addAttachment)!.args.body).toEqual({ name: "Quote.pdf", mimeType: "application/pdf", sizeBytes: file.size });
      expect(putSignedUpload).toHaveBeenCalledWith(expect.objectContaining({ url: "/api/storage/blob?token=x" }), file);
      expect(calls.find((c) => c.id === "postAttachmentsByAttachmentIdComplete")!.args.params).toMatchObject({ attachmentId: "a2" });
    });

    it("refuses a file over 25 MB or of a blocked type before anything is sent", () => {
      expect(refuseFile({ name: "Drone-survey.mov", size: 1000 })).toMatch(/aren’t allowed/);
      expect(refuseFile({ name: "Big.pdf", size: 40 * 1024 * 1024 })).toBe("Big.pdf wasn’t uploaded: files can be up to 25 MB. Nothing else changed.");
      expect(refuseFile({ name: "Ok.xlsx", size: 1000 })).toBeNull();
    });

    it("shows the refusal in the panel, with Dismiss, and sends nothing", async () => {
      const { calls } = setup("lead");
      const user = userEvent.setup({ applyAccept: false });
      await screen.findByText("Brief.pdf");
      await user.upload(screen.getByLabelText("Choose files to upload"), new File(["x"], "Drone-survey.mov", { type: "video/quicktime" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Drone-survey.mov wasn’t uploaded");
      expect(calls.some((c) => c.id === KIND_OPS.lead.addAttachment)).toBe(false);
      await user.click(within(alert).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("explains a server refusal of an upload in words", async () => {
      const o = KIND_OPS.deal;
      setup("deal", { [o.addAttachment]: () => apiError(400, "That file type is not allowed.", { code: "VALIDATION_ERROR", fieldErrors: [{ path: "mimeType", message: "Not allowed." }] }) });
      const user = userEvent.setup();
      await screen.findByText("Brief.pdf");
      await user.upload(screen.getByLabelText("Choose files to upload"), new File(["x"], "A.pdf", { type: "application/pdf" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("A.pdf wasn’t uploaded");
    });

    it("shows scan status: Scanning… has no Preview, Blocked by the scan is explained", async () => {
      setup("lead", {
        [KIND_OPS.lead.attachments]: () => ({
          items: [
            FILE({ id: "a1", file: { id: "f1", name: "Scanning.pdf", sizeBytes: 100, mimeType: "application/pdf", status: "UPLOADING" } }),
            FILE({ id: "a2", file: { id: "f2", name: "Bad.docx", sizeBytes: 100, mimeType: "application/x", status: "QUARANTINED" } }),
          ],
        }),
      });
      expect(await screen.findByText("Scanning…")).toBeInTheDocument();
      expect(screen.getByText("Blocked by the scan")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
    });

    it("previews through a short-lived link and offers Download", async () => {
      const { calls } = setup("contact", {
        getAttachmentsByAttachmentIdDownload: () => ({ download: { url: "/api/storage/blob?token=dl" }, file: { id: "fl1", name: "Brief.pdf" } }),
      });
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Preview Brief.pdf" }));
      const dialog = await screen.findByRole("dialog", { name: "Brief.pdf" });
      expect(within(dialog).getByRole("link", { name: /Download/ })).toHaveAttribute("href", "/api/storage/blob?token=dl");
      expect(calls.map((c) => c.id)).toContain("getAttachmentsByAttachmentIdDownload");
    });

    it("deletes with Undo, and offers delete only to the uploader or Management", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { calls } = setup("company", { [KIND_OPS.company.attachments]: () => ({ items: [FILE(), FILE({ id: "a9", uploadedByMembershipId: "m-other", file: { id: "f9", name: "Theirs.pdf", sizeBytes: 5, mimeType: "application/pdf", status: "READY" } })] }) }, ["attachments.manage"]);
      await screen.findByText("Brief.pdf");
      expect(screen.queryByRole("button", { name: "Delete Theirs.pdf" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Delete Brief.pdf" }));
      expect(screen.queryByText("Brief.pdf")).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: /Undo/ }));
      expect(await screen.findByText("Brief.pdf")).toBeInTheDocument();
      await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
      expect(calls.some((c) => c.id === "deleteAttachmentsByAttachmentId")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Delete Brief.pdf" }));
      await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
      await waitFor(() => expect(calls.find((c) => c.id === "deleteAttachmentsByAttachmentId")?.args.params).toMatchObject({ attachmentId: "a1" }));
    });

    it("hides Upload without attachments.manage and marks deal files not shared", async () => {
      setup("deal", { [KIND_OPS.deal.attachments]: () => ({ items: [FILE({ shared: false })] }) }, []);
      expect(await screen.findByText(/Only people who can see the deal value/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    });

    it("says so when there are no files, and when the role cannot see them", async () => {
      const { unmount } = setup("lead", { [KIND_OPS.lead.attachments]: () => ({ items: [] }) });
      expect(await screen.findByText(/No files yet/)).toBeInTheDocument();
      unmount();
      setup("lead", { [KIND_OPS.lead.attachments]: () => apiError(403) });
      expect(await screen.findByText(/Files aren’t available to your role on this lead/)).toBeInTheDocument();
    });
  });

  describe("comments", () => {
    it.each(KINDS)("posts a comment on a %s", async (kind) => {
      const o = KIND_OPS[kind];
      const { calls } = setup(kind, { [o.addComment]: () => COMMENT({ id: "c2", body: "New" }) });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("Write a comment"), "Sending the revised quote");
      await user.click(screen.getByRole("button", { name: "Post" }));
      await waitFor(() => expect(calls.find((c) => c.id === o.addComment)?.args.body).toEqual({ body: "Sending the revised quote", mentions: [] }));
    });

    it("offers people who can open the record when you type @, and sends their id", async () => {
      const o = KIND_OPS.lead;
      const { calls } = setup("lead", { [o.addComment]: () => COMMENT({ id: "c2" }) });
      const user = userEvent.setup();
      const box = await screen.findByLabelText("Write a comment");
      await user.type(box, "Please check @Wan");
      await user.click(await screen.findByRole("button", { name: "@Wanjiru Kamau" }));
      expect(box).toHaveValue("Please check @Wanjiru Kamau ");
      await user.type(box, "the herd numbers");
      await user.click(screen.getByRole("button", { name: "Post" }));
      await waitFor(() => expect(calls.find((c) => c.id === o.addComment)?.args.body).toEqual({ body: "Please check @Wanjiru Kamau the herd numbers", mentions: ["m-9"] }));
    });

    it("says when nobody with that name can open the record", async () => {
      setup("deal");
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText("Write a comment"), "hi @Zed");
      expect(await screen.findByText(/No one with that name can open this deal/)).toBeInTheDocument();
    });

    it("sets mentioned people apart in the thread", async () => {
      setup("lead", { [KIND_OPS.lead.comments]: () => ({ comments: [COMMENT({ body: "Ask @Wanjiru Kamau about it", mentions: ["m-9"] })], following: false }) });
      const mention = await screen.findByText("@Wanjiru Kamau");
      expect(mention).toHaveClass("fb-xmention");
    });

    it("edits your own comment, and deletes with Undo", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { calls } = setup("lead", { editComment: () => COMMENT({ body: "Changed", edited: true }) });
      await screen.findByText("Called the farm.");
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const box = screen.getByLabelText("Edit your comment");
      fireEvent.change(box, { target: { value: "Changed" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(calls.find((c) => c.id === "editComment")?.args.body).toEqual({ body: "Changed", mentions: [] }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.queryByText(/Called the farm|Changed/)).not.toBeInTheDocument();
      await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
      await waitFor(() => expect(calls.find((c) => c.id === "deleteCommentsByCommentId")?.args.params).toMatchObject({ commentId: "c1" }));
    });

    it("shows no edit or delete on someone else's comment", async () => {
      setup("lead", { [KIND_OPS.lead.comments]: () => ({ comments: [COMMENT({ canEdit: false, canDelete: false })], following: false }) });
      await screen.findByText("Called the farm.");
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("explains in place when comments are not available to the role (Restricted Technical)", async () => {
      setup("company", { [KIND_OPS.company.comments]: () => apiError(403) });
      expect(await screen.findByText(/Comments aren’t available to your role on this company/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Follow" })).not.toBeInTheDocument();
    });
  });

  it.each(KINDS)("has no accessibility violations on a %s", async (kind) => {
    const { container } = setup(kind);
    await screen.findByText("Called the farm.");
    expect(await violations(container)).toEqual([]);
  });
});
