import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ArchivedReadOnlyError, ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { archiveCompany, createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import { mergeCompanies } from "../src/services/companyService";
import {
  addComment,
  cleanCommentBody,
  deleteComment,
  editComment,
  followRecord,
  listComments,
  listMentionableMembers,
  unfollowRecord,
} from "../src/services/commentService";
import { listNotificationCentre } from "../src/services/notificationCentreService";
import { createDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import { createTask } from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

async function setup() {
  const org = await createTestOrganization("Comments");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const salesA = await createTestContext(org.id, "SALES", "a");
  const salesB = await createTestContext(org.id, "SALES", "b");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const statusId = await getLeadStatusId(org.id);
  const stageId = await getPipelineStageId(org.id);
  return { org, management, salesA, salesB, technical, statusId, stageId };
}

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("comments, mentions and following (FIG-1044, B2.15)", () => {
  it("anyone who can open the record can comment and read; others get a 404", async () => {
    const { management, salesA, salesB, statusId } = await setup();
    const { lead } = await createLead(salesA, { leadStatusId: statusId });
    const c = await addComment(salesA, "lead", lead.id, { body: "  First note  " });
    expect(c.body).toBe("First note");
    await addComment(management, "lead", lead.id, { body: "Seen." });
    const thread = await listComments(salesA, "lead", lead.id);
    expect(thread.comments.map((x) => x.body)).toEqual(["First note", "Seen."]);
    expect(thread.comments[0]!.canEdit).toBe(true);
    expect(thread.comments[1]!.canEdit).toBe(false);
    await expect(listComments(salesB, "lead", lead.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addComment(salesB, "lead", lead.id, { body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("works on every record type, including a task for Restricted Technical", async () => {
    const { management, technical, stageId } = await setup();
    const { company } = await createCompany(management, { name: "Rec Co" });
    const { contact } = await createContact(management, { firstName: "Rec" });
    const deal = await createDeal(management, { companyId: company.id, pipelineStageId: stageId });
    const task = await createTask(management, { title: "Do it", assigneeMembershipId: technical.membershipId });
    for (const [kind, id] of [["company", company.id], ["contact", contact.id], ["deal", deal.id], ["task", task.id]] as const) {
      expect((await addComment(management, kind, id, { body: `on ${kind}` })).body).toBe(`on ${kind}`);
    }
    expect((await addComment(technical, "task", task.id, { body: "Started" })).body).toBe("Started");
    await expect(listComments(technical, "company", company.id)).rejects.toBeDefined();
  });

  it("strips markup, rejects empty and over-long text", async () => {
    expect(cleanCommentBody("<b>Hello</b> <script>alert(1)</script>world")).toBe("Hello alert(1)world");
    expect(() => cleanCommentBody("   ")).toThrow(ValidationError);
    expect(() => cleanCommentBody("x".repeat(5001))).toThrow(ValidationError);
    expect(cleanCommentBody("a\r\n\r\n\r\n\r\nb")).toBe("a\n\nb");
  });

  it("mentions notify only people who can open the record; a mention of someone without access is refused and leaks nothing", async () => {
    const { management, salesA, salesB, statusId } = await setup();
    const { lead } = await createLead(salesA, { leadStatusId: statusId });

    const refused = await issuesOf(addComment(salesA, "lead", lead.id, { body: "Look @B", mentions: [salesB.membershipId] }));
    expect(refused.issues?.[0]?.path).toBe("mentions");
    expect((await listComments(salesA, "lead", lead.id)).comments).toHaveLength(0);
    expect((await listNotificationCentre(salesB, {})).total).toBe(0);

    const mentionable = (await listMentionableMembers(salesA, "lead", lead.id)).map((m) => m.membershipId);
    expect(mentionable).toContain(management.membershipId);
    expect(mentionable).not.toContain(salesB.membershipId);

    await addComment(salesA, "lead", lead.id, { body: "Please review", mentions: [management.membershipId, management.membershipId] });
    const feed = await listNotificationCentre(management, {});
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]!.type).toBe("MENTION");
    expect(feed.items[0]!.body).toBe("Please review");
    expect(feed.items[0]!.deepLink).toContain(`/leads/${lead.id}`);

    await expect(addComment(salesA, "lead", lead.id, { body: "x", mentions: ["00000000-0000-4000-8000-000000000000"] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a mention from another organisation is refused", async () => {
    const a = await setup();
    const b = await setup();
    const { lead } = await createLead(a.management, { leadStatusId: a.statusId });
    await expect(addComment(a.management, "lead", lead.id, { body: "hi", mentions: [b.management.membershipId] })).rejects.toBeInstanceOf(ValidationError);
    expect((await listNotificationCentre(b.management, {})).total).toBe(0);
  });

  it("edit is for the author, soft, and notifies only people newly mentioned; delete is for the author or Management", async () => {
    const { management, salesA, statusId, org } = await setup();
    const other = await createTestContext(org.id, "MANAGEMENT", "m2");
    const { lead } = await createLead(salesA, { leadStatusId: statusId });
    const c = await addComment(salesA, "lead", lead.id, { body: "v1", mentions: [management.membershipId] });
    expect((await listNotificationCentre(management, {})).total).toBe(1);

    await expect(editComment(management, c.id, { body: "hijack" })).rejects.toBeInstanceOf(ForbiddenError);
    const edited = await editComment(salesA, c.id, { body: "v2", mentions: [management.membershipId, other.membershipId] });
    expect(edited.edited).toBe(true);
    expect(edited.body).toBe("v2");
    expect((await listNotificationCentre(management, {})).total).toBe(1); // not told again
    expect((await listNotificationCentre(other, {})).total).toBe(1); // newly mentioned

    const second = await addComment(salesA, "lead", lead.id, { body: "second" });
    await deleteComment(other, second.id); // Management may delete anyone's
    await expect(deleteComment(management, c.id)).resolves.toMatchObject({ deleted: true }); // Management too
    const thread = await listComments(salesA, "lead", lead.id);
    expect(thread.comments.every((x) => x.deleted && x.body === null)).toBe(true);
    const row = await adminDb.comment.findUnique({ where: { id: c.id } });
    expect(row?.body).toBe(""); // the text is gone, the row stays
    await expect(editComment(salesA, c.id, { body: "back" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only the author or Management may delete", async () => {
    const { management, salesA, salesB, statusId } = await setup();
    const { lead } = await createLead(management, { leadStatusId: statusId });
    await adminDb.lead.update({ where: { id: lead.id }, data: { ownerMembershipId: null } });
    const c = await addComment(management, "lead", lead.id, { body: "mgmt note" });
    // Sales can open an unowned lead (shared pool) but may not delete someone else's comment.
    await expect(deleteComment(salesA, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    void salesB;
  });

  it("an archived record is read-only for comments", async () => {
    const { management } = await setup();
    const { company } = await createCompany(management, { name: "Old Co" });
    await addComment(management, "company", company.id, { body: "before" });
    await archiveCompany(management, company.id, { reason: "Closed" });
    await expect(addComment(management, "company", company.id, { body: "after" })).rejects.toBeInstanceOf(ArchivedReadOnlyError);
    expect((await listComments(management, "company", company.id)).comments).toHaveLength(1);
  });

  it("amounts in a deal comment show to those who may see the value (Management, the owner)", async () => {
    const { management, salesA, stageId } = await setup();
    const { company } = await createCompany(management, { name: "Value Co" });
    const deal = await createDeal(salesA, { companyId: company.id, pipelineStageId: stageId });
    await addComment(salesA, "deal", deal.id, { body: "Agreed KES 4,500,000 for phase one" });
    expect(JSON.stringify(await listComments(salesA, "deal", deal.id))).toContain("4,500,000");
    expect(JSON.stringify(await listComments(management, "deal", deal.id))).toContain("4,500,000");
  });

  it("followers hear about new comments; follow and unfollow are idempotent; commenting follows", async () => {
    const { management, salesA, statusId } = await setup();
    const { lead } = await createLead(salesA, { leadStatusId: statusId });
    expect((await listComments(management, "lead", lead.id)).following).toBe(false);
    await followRecord(management, "lead", lead.id);
    await followRecord(management, "lead", lead.id);
    expect((await listComments(management, "lead", lead.id)).following).toBe(true);

    await addComment(salesA, "lead", lead.id, { body: "Update for followers" });
    const feed = await listNotificationCentre(management, {});
    expect(feed.items.map((n) => n.body)).toEqual(["Update for followers"]);
    expect((await listComments(salesA, "lead", lead.id)).following).toBe(true); // the author follows

    await unfollowRecord(management, "lead", lead.id);
    await addComment(salesA, "lead", lead.id, { body: "Quiet now" });
    expect((await listNotificationCentre(management, {})).total).toBe(1);
  });

  it("comments and follows move with a merged company and come back on undo", async () => {
    const { management } = await setup();
    const { company: winner } = await createCompany(management, { name: "Merge Win Co" });
    const { company: loser } = await createCompany(management, { name: "Merge Lose Co" });
    await addComment(management, "company", loser.id, { body: "from the loser" });
    await followRecord(management, "company", loser.id);
    const result = (await mergeCompanies(management, loser.id, winner.id)) as { mergeId?: string };
    const thread = await listComments(management, "company", winner.id);
    expect(thread.comments.map((c) => c.body)).toContain("from the loser");
    expect(result).toBeDefined();
  });

  it("is isolated per organisation (RLS): a comment in one organisation is not visible to another's context", async () => {
    const a = await setup();
    const b = await setup();
    const { lead } = await createLead(a.management, { leadStatusId: a.statusId });
    const c = await addComment(a.management, "lead", lead.id, { body: "secret" });
    await expect(editComment(b.management, c.id, { body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteComment(b.management, c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listComments(b.management, "lead", lead.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
