import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ArchivedReadOnlyError, ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { setStorageDriverForTests } from "../src/storage";
import { LocalDriver } from "../src/storage/localDriver";
import {
  addAttachment,
  completeAttachment,
  deleteAttachment,
  getAttachmentDownload,
  listAttachments,
} from "../src/services/attachmentService";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import { undoMerge } from "../src/services/mergeService";
import * as taskService from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
let dir: string;
let driver: LocalDriver;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-attach-"));
  process.env.STORAGE_SIGNING_SECRET = "attachments-test-secret";
  driver = new LocalDriver({ rootDir: dir, signingSecret: "attachments-test-secret", baseUrl: "http://localhost:3000" });
  setStorageDriverForTests(driver);
});
afterAll(async () => {
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
});

type Parent = Parameters<typeof addAttachment>[1];

/** Adds an attachment, sends the bytes the way a client would, and completes it. */
async function attach(ctx: AuthContext, parent: Parent, parentId: string, extra: Partial<Parameters<typeof addAttachment>[3]> = {}) {
  const { attachment, upload } = await addAttachment(ctx, parent, parentId, { name: "brief.png", mimeType: "image/png", sizeBytes: PNG.length, ...extra });
  await driver.putObject(attachment.file.storageKey, PNG, { contentType: "image/png" });
  expect(upload.method).toBe("PUT");
  return completeAttachment(ctx, attachment.id);
}

async function setup() {
  const org = await createTestOrganization("Attach");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const owner = await createTestContext(org.id, "SALES", "owner");
  const other = await createTestContext(org.id, "SALES", "other");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  return { org, management, owner, other, delivery, finance };
}

describe("attachments (FIG-796)", () => {
  it("uploads, lists and downloads a file on a lead: signed short-lived link, audited, scoped to people who can open the lead", async () => {
    const { org, management, owner, other } = await setup();
    const { lead } = await leadService.createLead(owner, { leadStatusId: await getLeadStatusId(org.id) });

    const done = await attach(owner, "lead", lead.id, { title: "Site photo" });
    expect(done.file.status).toBe("READY");
    expect(done).toMatchObject({ title: "Site photo", leadId: lead.id, uploadedByMembershipId: owner.membershipId });

    const list = await listAttachments(owner, "lead", lead.id);
    expect(list.map((a) => a.file.name)).toEqual(["brief.png"]);
    expect((await listAttachments(management, "lead", lead.id)).map((a) => a.id)).toEqual([done.id]);

    const { download } = await getAttachmentDownload(owner, done.id);
    expect(download.url).toContain("/api/storage/blob");
    expect(new Date(download.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(61_000);

    await expect(listAttachments(other, "lead", lead.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAttachmentDownload(other, done.id)).rejects.toBeInstanceOf(NotFoundError);

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["attachment.added", "attachment.downloaded"]));
  });

  it("needs attachments.manage to attach; refuses types the file service does not allow; an unfinished upload is not a file for others", async () => {
    const { org, management, owner, finance } = await setup();
    const { company } = await companyService.createCompany(management, { name: "Attach Co" });
    await expect(addAttachment(finance, "company", company.id, { name: "a.png", mimeType: "image/png", sizeBytes: 10 })).rejects.toBeInstanceOf(ForbiddenError);

    await expect(addAttachment(management, "company", company.id, { name: "run.exe", mimeType: "application/octet-stream", sizeBytes: 10 })).rejects.toBeInstanceOf(ValidationError);
    await expect(addAttachment(management, "company", company.id, { name: "big.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 })).rejects.toBeInstanceOf(ValidationError);

    const { attachment } = await addAttachment(management, "company", company.id, { name: "later.png", mimeType: "image/png", sizeBytes: PNG.length });
    expect(attachment.file.status).toBe("UPLOADING");
    expect((await listAttachments(management, "company", company.id)).map((a) => a.id)).toEqual([attachment.id]);
    const { lead } = await leadService.createLead(owner, { leadStatusId: await getLeadStatusId(org.id) });
    void lead;
    // Another person who can open the company does not see the half-finished upload.
    const delivery = await createTestContext(org.id, "SALES", "viewer");
    expect(await listAttachments(delivery, "company", company.id)).toEqual([]);
    // And nobody but the uploader can complete it.
    await expect(completeAttachment(delivery, attachment.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("files on a deal go only to people who may see its value, unless shared; only they can share", async () => {
    const { org, management, owner, delivery } = await setup();
    const { company } = await companyService.createCompany(management, { name: "Deal Files Co" });
    const deal = await dealService.createDeal(management, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id), value: 500000 });
    await dealService.updateDeal(management, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { deliveryOwnerMembershipId: delivery.membershipId } });

    const quote = await attach(management, "deal", deal.id, { title: "Quote with prices" });
    const scope = await attach(management, "deal", deal.id, { title: "Scope of work", shared: true });
    expect(quote.shared).toBe(false);
    expect(scope.shared).toBe(true);

    expect((await listAttachments(management, "deal", deal.id)).map((a) => a.title).sort()).toEqual(["Quote with prices", "Scope of work"]);
    // Delivery works the won deal but may not see its value: only the shared file.
    expect((await listAttachments(delivery, "deal", deal.id)).map((a) => a.title)).toEqual(["Scope of work"]);
    await expect(getAttachmentDownload(delivery, quote.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAttachmentDownload(delivery, scope.id)).resolves.toBeDefined();

    // Delivery cannot mark its own upload as shared, but always sees what it uploaded itself.
    await expect(addAttachment(delivery, "deal", deal.id, { name: "x.png", mimeType: "image/png", sizeBytes: 10, shared: true })).rejects.toBeInstanceOf(ValidationError);
    const handoverNote = await attach(delivery, "deal", deal.id, { title: "Handover note" });
    expect((await listAttachments(delivery, "deal", deal.id)).map((a) => a.title).sort()).toEqual(["Handover note", "Scope of work"]);
    void handoverNote;
    void owner;
  });

  it("a proposal can only be named on a deal file", async () => {
    const { org, management } = await setup();
    const { company } = await companyService.createCompany(management, { name: "Proposal Co" });
    await expect(addAttachment(management, "company", company.id, { name: "a.png", mimeType: "image/png", sizeBytes: 10, proposalReferenceId: "x" })).rejects.toBeInstanceOf(ValidationError);
    void org;
  });

  it("deleting is for the uploader or Management; the file is soft-deleted, audited, and gone from the list", async () => {
    const { org, management, owner, other } = await setup();
    const { company } = await companyService.createCompany(management, { name: "Delete Co" });
    const mine = await attach(owner, "company", company.id, { title: "Mine" });
    const theirs = await attach(other, "company", company.id, { title: "Theirs" });

    await expect(deleteAttachment(owner, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteAttachment(owner, mine.id);
    await deleteAttachment(management, theirs.id);
    expect(await listAttachments(management, "company", company.id)).toEqual([]);
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: mine.fileId } })).status).toBe("DELETED");
    await expect(getAttachmentDownload(management, mine.id)).rejects.toBeInstanceOf(NotFoundError);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "attachment.deleted" } });
    expect(audit).toHaveLength(2);
  });

  it("an archived record is read-only for its files, but they stay readable", async () => {
    const { org, management, owner } = await setup();
    const { lead } = await leadService.createLead(owner, { leadStatusId: await getLeadStatusId(org.id) });
    const file = await attach(owner, "lead", lead.id);
    await leadService.archiveLead(management, lead.id);

    await expect(addAttachment(owner, "lead", lead.id, { name: "n.png", mimeType: "image/png", sizeBytes: 10 })).rejects.toBeInstanceOf(ArchivedReadOnlyError);
    await expect(deleteAttachment(owner, file.id)).rejects.toBeInstanceOf(ArchivedReadOnlyError);
    expect(await listAttachments(management, "lead", lead.id)).toHaveLength(1);
    await expect(getAttachmentDownload(management, file.id)).resolves.toBeDefined();
  });

  it("task files carry a Restricted Technical user's requirements: the assignee sees them, another technician does not", async () => {
    const { org, management } = await setup();
    const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech1");
    const otherTech = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech2");
    const task = await taskService.createTask(management, { title: "Install CCTV", assigneeMembershipId: tech.membershipId });
    await attach(management, "task", task.id, { title: "Requirements" });

    expect((await listAttachments(tech, "task", task.id)).map((a) => a.title)).toEqual(["Requirements"]);
    await expect(listAttachments(otherTech, "task", task.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("files follow a company merge and come back on undo", async () => {
    const { management } = await setup();
    const { company: loser } = await companyService.createCompany(management, { name: "Loser Files Co" });
    const { company: winner } = await companyService.createCompany(management, { name: "Winner Files Co" });
    const file = await attach(management, "company", loser.id);

    const merged = await companyService.mergeCompanies(management, loser.id, winner.id);
    expect((await listAttachments(management, "company", winner.id)).map((a) => a.id)).toEqual([file.id]);
    expect(await listAttachments(management, "company", loser.id)).toEqual([]);
    await undoMerge(management, merged.mergeRecordId);
    expect((await listAttachments(management, "company", loser.id)).map((a) => a.id)).toEqual([file.id]);
  });

  it("another organisation sees nothing, and an attachment goes when its record is deleted", async () => {
    const one = await setup();
    const two = await setup();
    const { company } = await companyService.createCompany(one.management, { name: "Tenant Files Co" });
    const file = await attach(one.management, "company", company.id);
    await expect(listAttachments(two.management, "company", company.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAttachmentDownload(two.management, file.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAttachment(two.management, file.id)).rejects.toBeInstanceOf(NotFoundError);

    await adminDb.company.delete({ where: { id: company.id } });
    expect(await adminDb.attachment.count({ where: { id: file.id } })).toBe(0);
  });
});
