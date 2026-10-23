import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ArchivedReadOnlyError } from "../src/auth/errors";
import { buildErrorResponse } from "../src/lib/apiErrors";
import { archiveBanner, canRestoreRecord } from "../src/lib/archive";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import * as taskService from "../src/services/taskService";
import * as activityService from "../src/services/activityService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

type Ctx = Awaited<ReturnType<typeof createTestContext>>;

interface Subject {
  type: "lead" | "deal" | "company" | "contact" | "task";
  create: (ctx: Ctx, orgId: string) => Promise<{ id: string }>;
  archive: (ctx: Ctx, id: string, input?: { reason?: string }) => Promise<{ archivedAt: Date | null; archivedByMembershipId: string | null; archiveReason: string | null }>;
  restore: (ctx: Ctx, id: string) => Promise<{ archivedAt: Date | null; archivedByMembershipId: string | null; archiveReason: string | null }>;
  edit: (ctx: Ctx, id: string) => Promise<unknown>;
  list: (ctx: Ctx, filter: { includeArchived?: boolean; archivedOnly?: boolean }) => Promise<{ id: string }[]>;
  auditEntity: string;
}

const SUBJECTS: Subject[] = [
  {
    type: "lead",
    create: async (ctx, orgId) => (await leadService.createLead(ctx, { leadStatusId: await getLeadStatusId(orgId) })).lead,
    archive: (ctx, id, input) => leadService.archiveLead(ctx, id, input),
    restore: (ctx, id) => leadService.restoreLead(ctx, id),
    edit: (ctx, id) => leadService.updateLead(ctx, id, { notes: "changed" }),
    list: (ctx, filter) => leadService.listLeads(ctx, filter),
    auditEntity: "Lead",
  },
  {
    type: "deal",
    create: async (ctx, orgId) => {
      const { company } = await companyService.createCompany(ctx, { name: `Deal Co ${Math.random()}` });
      return dealService.createDeal(ctx, { companyId: company.id, pipelineStageId: await getPipelineStageId(orgId) });
    },
    archive: (ctx, id, input) => dealService.archiveDeal(ctx, id, input),
    restore: (ctx, id) => dealService.restoreDeal(ctx, id),
    edit: (ctx, id) => dealService.updateDeal(ctx, id, { notes: "changed" }),
    list: (ctx, filter) => dealService.listDeals(ctx, filter),
    auditEntity: "Deal",
  },
  {
    type: "company",
    create: async (ctx) => (await companyService.createCompany(ctx, { name: `Co ${Math.random()}` })).company,
    archive: (ctx, id, input) => companyService.archiveCompany(ctx, id, input),
    restore: (ctx, id) => companyService.restoreCompany(ctx, id),
    edit: (ctx, id) => companyService.updateCompany(ctx, id, { name: "Renamed" }),
    list: (ctx, filter) => companyService.listCompanies(ctx, filter),
    auditEntity: "Company",
  },
  {
    type: "contact",
    create: async (ctx) => (await contactService.createContact(ctx, { firstName: "Archie" })).contact,
    archive: (ctx, id, input) => contactService.archiveContact(ctx, id, input),
    restore: (ctx, id) => contactService.restoreContact(ctx, id),
    edit: (ctx, id) => contactService.updateContact(ctx, id, { firstName: "Changed" }),
    list: (ctx, filter) => contactService.listContacts(ctx, filter),
    auditEntity: "Contact",
  },
  {
    type: "task",
    create: (ctx) => taskService.createTask(ctx, { title: "Archivable task" }),
    archive: (ctx, id, input) => taskService.archiveTask(ctx, id, input),
    restore: (ctx, id) => taskService.restoreTask(ctx, id),
    edit: (ctx, id) => taskService.updateTask(ctx, id, { title: "Changed" }),
    list: (ctx, filter) => taskService.listTasks(ctx, filter),
    auditEntity: "Task",
  },
];

describe.each(SUBJECTS)("archive semantics: $type (FIG-1045, B2.16)", (subject) => {
  it("records who and why, hides it from the default list, shows it on the archived tab, and restoring clears all of it", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const record = await subject.create(ctx, org.id);

    const archived = await subject.archive(ctx, record.id, { reason: "  Duplicate of another record  " });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.archivedByMembershipId).toBe(ctx.membershipId);
    expect(archived.archiveReason).toBe("Duplicate of another record");

    expect((await subject.list(ctx, {})).map((r) => r.id)).not.toContain(record.id);
    expect((await subject.list(ctx, { includeArchived: true })).map((r) => r.id)).toContain(record.id);
    expect((await subject.list(ctx, { archivedOnly: true })).map((r) => r.id)).toEqual([record.id]);

    const restored = await subject.restore(ctx, record.id);
    expect(restored.archivedAt).toBeNull();
    expect(restored.archivedByMembershipId).toBeNull();
    expect(restored.archiveReason).toBeNull();
    expect((await subject.list(ctx, {})).map((r) => r.id)).toContain(record.id);

    const audit = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, entityType: subject.auditEntity, entityId: record.id },
      orderBy: { createdAt: "asc" },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain(`${subject.type}.archived`);
    expect(actions).toContain(`${subject.type}.restored`);
    expect(audit.find((a) => a.action === `${subject.type}.archived`)?.metadata).toEqual({ reason: "Duplicate of another record" });
  });

  it("refuses an edit with ARCHIVED_READ_ONLY (409) and a restore hint, until it is restored", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const record = await subject.create(ctx, org.id);
    await subject.archive(ctx, record.id);

    let thrown: unknown;
    try {
      await subject.edit(ctx, record.id);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ArchivedReadOnlyError);
    expect((thrown as ArchivedReadOnlyError).restore).toEqual({ entityType: subject.type, entityId: record.id, canRestore: true });

    const { status, body } = await buildErrorResponse(thrown, "req-test-0001");
    expect(status).toBe(409);
    expect(body.code).toBe("ARCHIVED_READ_ONLY");
    expect(body.restore).toEqual({ entityType: subject.type, entityId: record.id, canRestore: true });
    expect(body.message).toMatch(/archived/i);

    await subject.restore(ctx, record.id);
    await expect(subject.edit(ctx, record.id)).resolves.toBeDefined();
  });

  it("rejects a second archive and a restore of something not archived", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const record = await subject.create(ctx, org.id);
    await expect(subject.restore(ctx, record.id)).rejects.toThrow(/not archived/);
    await subject.archive(ctx, record.id);
    await expect(subject.archive(ctx, record.id)).rejects.toThrow(/already archived/);
  });

  it("rejects an over-long reason", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const record = await subject.create(ctx, org.id);
    await expect(subject.archive(ctx, record.id, { reason: "x".repeat(501) })).rejects.toThrow(/at most 500/);
  });
});

describe("archive guards beyond the record itself (FIG-1045, B2.16)", () => {
  it("refuses to add a task, activity or follow-up under an archived lead", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { lead } = await leadService.createLead(ctx, { leadStatusId: await getLeadStatusId(org.id) });
    await leadService.archiveLead(ctx, lead.id);

    await expect(taskService.createTask(ctx, { title: "Follow up", leadId: lead.id })).rejects.toBeInstanceOf(ArchivedReadOnlyError);
    await expect(
      activityService.createActivity(ctx, { type: "NOTE", subject: "Called", leadId: lead.id }),
    ).rejects.toBeInstanceOf(ArchivedReadOnlyError);

    await leadService.restoreLead(ctx, lead.id);
    await expect(taskService.createTask(ctx, { title: "Follow up", leadId: lead.id })).resolves.toBeDefined();
  });

  it("says whether the caller can restore: the owner can, a role without the archive permission cannot", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const sales = await createTestContext(org.id, "SALES");
    const { lead } = await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });
    const archived = await leadService.archiveLead(management, lead.id, { reason: "Not a fit" });

    expect(canRestoreRecord(sales, "lead", archived)).toBe(true);
    expect(canRestoreRecord(management, "lead", archived)).toBe(true);
    expect(canRestoreRecord(delivery, "lead", archived)).toBe(false);
    expect(archiveBanner(delivery, "lead", archived)).toMatchObject({
      archivedByMembershipId: management.membershipId,
      reason: "Not a fit",
      canRestore: false,
    });
    expect(archiveBanner(sales, "lead", { ...archived, archivedAt: null })).toBeNull();
  });

  it("only the assignee, the creator or Management can archive a task", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const other = await createTestContext(org.id, "SALES", "other.sales");
    const task = await taskService.createTask(sales, { title: "Mine" });

    await expect(taskService.archiveTask(other, task.id)).rejects.toThrow();
    await expect(taskService.archiveTask(sales, task.id)).resolves.toMatchObject({ archivedByMembershipId: sales.membershipId });
    await expect(taskService.restoreTask(management, task.id)).resolves.toMatchObject({ archivedAt: null });
  });
});
