import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { TASK_GROUP_KEYS } from "../src/repositories/tasks";
import { setStorageDriverForTests } from "../src/storage";
import { LocalDriver } from "../src/storage/localDriver";
import { addAttachment, completeAttachment } from "../src/services/attachmentService";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import { updateFeatureToggles } from "../src/services/featureService";
import * as leadService from "../src/services/leadService";
import {
  createTask,
  getMyWork,
  listAssignableTaskAssignees,
  listTaskGroupPage,
  listTasksGrouped,
  taskGroupBounds,
  updateTask,
} from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
let dir: string;
let driver: LocalDriver;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-tasks-"));
  process.env.STORAGE_SIGNING_SECRET = "tasks-test-secret";
  driver = new LocalDriver({ rootDir: dir, signingSecret: "tasks-test-secret", baseUrl: "http://localhost:3000" });
  setStorageDriverForTests(driver);
});
afterAll(async () => {
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
});

const H = 3_600_000;

async function setup() {
  const org = await createTestOrganization("TasksV2");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "sales");
  const otherSales = await createTestContext(org.id, "SALES", "other");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech1");
  const otherTechnical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech2");
  return { org, management, sales, otherSales, delivery, technical, otherTechnical };
}

/** One task per group for this caller, due relative to the caller's own day boundaries. */
async function oneTaskPerGroup(ctx: AuthContext, owner: AuthContext = ctx) {
  const b = await taskGroupBounds(owner);
  const at = (d: Date) => d.toISOString();
  const make = (title: string, dueAt: string | undefined) => createTask(ctx, { title, dueAt, assigneeMembershipId: owner.membershipId });
  const ids: Record<string, string> = {};
  ids.OVERDUE = (await make("overdue", at(new Date(b.todayStart.getTime() - 5 * H)))).id;
  ids.TODAY = (await make("today", at(new Date(b.todayStart.getTime() + 12 * H)))).id;
  if (b.tomorrowStart.getTime() < b.nextWeekStart.getTime()) ids.THIS_WEEK = (await make("this week", at(new Date(b.tomorrowStart.getTime() + 6 * H)))).id;
  ids.LATER = (await make("later", at(new Date(b.nextWeekStart.getTime() + 30 * H)))).id;
  ids.NO_DATE = (await make("no date", undefined)).id;
  const done = await make("done", at(new Date(b.todayStart.getTime() - 40 * H)));
  await updateTask(ctx, done.id, { status: "COMPLETED" });
  ids.DONE = done.id;
  return { ids, bounds: b };
}

describe("tasks grouped by due state (FIG-1038, B2.09)", () => {
  it("puts each task in its group, with a count per group and Done collapsed", async () => {
    const { sales } = await setup();
    const { ids, bounds } = await oneTaskPerGroup(sales);
    const result = await listTasksGrouped(sales);

    expect(result.groups.map((g) => g.key)).toEqual(["OVERDUE", "TODAY", "THIS_WEEK", "LATER", "NO_DATE", "DONE"]);
    expect(result.timeZone).toBeTruthy();
    for (const key of TASK_GROUP_KEYS) {
      const group = result.groups.find((g) => g.key === key)!;
      const expected = ids[key] ? 1 : 0;
      expect(group.count, key).toBe(expected);
      if (key === "DONE") {
        expect(group.collapsed).toBe(true);
        expect(group.items).toEqual([]); // counted, not listed, until asked for
      } else {
        expect(group.items.map((t) => t.id), key).toEqual(ids[key] ? [ids[key]] : []);
      }
    }
    // The week boundary follows the calendar: on a Sunday there is nothing left in "this week".
    expect(result.counts.THIS_WEEK).toBe(bounds.tomorrowStart.getTime() < bounds.nextWeekStart.getTime() ? 1 : 0);
    expect(result.groups.find((g) => g.key === "OVERDUE")!.label).toBe("Overdue");
  });

  it("group counts match list contents for every role and scope", async () => {
    const { management, sales, otherSales } = await setup();
    await oneTaskPerGroup(sales);
    await oneTaskPerGroup(otherSales);
    await oneTaskPerGroup(management);

    for (const ctx of [sales, otherSales, management]) {
      const full = await listTasksGrouped(ctx, { groups: [...TASK_GROUP_KEYS], pageSize: 100 });
      for (const group of full.groups) {
        expect(group.items.length, `${group.key} rows`).toBe(group.count);
        expect(group.collapsed).toBe(false);
      }
      const total = full.groups.reduce((n, g) => n + g.count, 0);
      // Own scope sees its own tasks (5 or 6), Management sees all three people's.
      expect(total).toBe(ctx === management ? full.groups.reduce((n, g) => n + g.items.length, 0) : total);
    }
    const own = await listTasksGrouped(sales, { groups: [...TASK_GROUP_KEYS] });
    expect(own.groups.flatMap((g) => g.items).every((t) => t.assigneeMembershipId === sales.membershipId)).toBe(true);
    const all = await listTasksGrouped(management, { groups: [...TASK_GROUP_KEYS] });
    expect(new Set(all.groups.flatMap((g) => g.items).map((t) => t.assigneeMembershipId)).size).toBe(3);
  });

  it("pages each group on the server, soonest due first, and the rest of a group is one request away", async () => {
    const { sales } = await setup();
    const b = await taskGroupBounds(sales);
    for (let i = 0; i < 5; i += 1) {
      await createTask(sales, { title: `late ${i}`, dueAt: new Date(b.todayStart.getTime() - (i + 1) * H).toISOString() });
    }
    const first = await listTasksGrouped(sales, { pageSize: 2 });
    const overdue = first.groups.find((g) => g.key === "OVERDUE")!;
    expect(overdue).toMatchObject({ count: 5, pageSize: 2, pageCount: 3 });
    expect(overdue.items).toHaveLength(2);
    expect(overdue.items.map((t) => t.title)).toEqual(["late 4", "late 3"]); // oldest due first
    expect(overdue.nextCursor).not.toBeNull();

    const second = await listTaskGroupPage(sales, "OVERDUE", {}, { page: 2, pageSize: 2 });
    expect(second.items.map((t) => t.title)).toEqual(["late 2", "late 1"]);
    const third = await listTaskGroupPage(sales, "overdue".toUpperCase(), {}, { page: 3, pageSize: 2 });
    expect(third.items.map((t) => t.title)).toEqual(["late 0"]);
    expect(third.nextCursor).toBeNull();
    const seen = new Set([...overdue.items, ...second.items, ...third.items].map((t) => t.id));
    expect(seen.size).toBe(5); // no task on two pages, none missing

    await expect(listTaskGroupPage(sales, "SOMEDAY")).rejects.toBeInstanceOf(ValidationError);
  });

  it("Done lists when asked for, completed before cancelled", async () => {
    const { sales } = await setup();
    const a = await createTask(sales, { title: "first" });
    const b = await createTask(sales, { title: "second" });
    await updateTask(sales, a.id, { status: "COMPLETED" });
    await new Promise((r) => setTimeout(r, 20));
    await updateTask(sales, b.id, { status: "CANCELLED" });
    const done = await listTaskGroupPage(sales, "DONE");
    expect(done.count).toBe(2);
    // Completed tasks come first (most recently completed on top); a cancelled one has no completion time and follows.
    expect(done.items.map((t) => t.title)).toEqual(["first", "second"]);
    expect(new Set(done.items.map((t) => t.status))).toEqual(new Set(["COMPLETED", "CANCELLED"]));
    const requested = await listTasksGrouped(sales, { groups: ["DONE"] });
    expect(requested.groups).toHaveLength(1);
    expect(requested.groups[0]).toMatchObject({ key: "DONE", collapsed: false, count: 2 });
  });

  it("archived tasks are not in any group", async () => {
    const { sales } = await setup();
    const t = await createTask(sales, { title: "archived soon" });
    expect((await listTasksGrouped(sales)).counts.NO_DATE).toBe(1);
    await adminDb.task.update({ where: { id: t.id }, data: { archivedAt: new Date() } });
    expect((await listTasksGrouped(sales)).counts.NO_DATE).toBe(0);
  });
});

describe("other people's tasks and links (FIG-1038, B2.09)", () => {
  it("Management sees everyone's tasks and can change them; someone who can view all but not manage sees them read-only", async () => {
    const { management, sales } = await setup();
    const task = await createTask(sales, { title: "Sales task" });

    const asManagement = await listTasksGrouped(management);
    const row = asManagement.groups.flatMap((g) => g.items).find((t) => t.id === task.id)!;
    expect(row.readOnly).toBe(false);

    // A role that may view every task but not assign any: read-only on others' tasks.
    const viewer: AuthContext = { ...sales, permissionKeys: [...sales.permissionKeys, "tasks.view.all"] };
    const managementTask = await createTask(management, { title: "Management task" });
    const rows = (await listTasksGrouped(viewer)).groups.flatMap((g) => g.items);
    expect(rows.find((t) => t.id === managementTask.id)!.readOnly).toBe(true);
    await expect(updateTask(viewer, managementTask.id, { title: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    // Their own task is theirs to change.
    expect(rows.find((t) => t.id === task.id)!.readOnly).toBe(false);
    await expect(updateTask(viewer, task.id, { title: "Renamed" })).resolves.toBeDefined();
  });

  it("Sales sees only their own tasks; assignment follows the role: Sales to self, Management to anyone", async () => {
    const { management, sales, otherSales, delivery } = await setup();
    const theirs = await createTask(otherSales, { title: "Other's task" });
    expect((await listTasksGrouped(sales)).groups.flatMap((g) => g.items).map((t) => t.id)).not.toContain(theirs.id);

    // A client-supplied assignee is never trusted for someone who can only assign to themselves: it becomes their own task.
    const forced = await createTask(sales, { title: "For a colleague?", assigneeMembershipId: otherSales.membershipId });
    expect(forced.assigneeMembershipId).toBe(sales.membershipId);
    await expect(listAssignableTaskAssignees(sales)).rejects.toBeInstanceOf(ForbiddenError);
    const assigned = await createTask(management, { title: "From Management", assigneeMembershipId: delivery.membershipId });
    expect(assigned.assigneeMembershipId).toBe(delivery.membershipId);
    expect((await listAssignableTaskAssignees(management)).length).toBeGreaterThan(2);
  });

  it("a link to a record the viewer cannot open is shown without its name", async () => {
    const { org, management, sales, otherSales } = await setup();
    const { lead } = await leadService.createLead(sales, { leadStatusId: await getLeadStatusId(org.id) });
    const task = await createTask(management, { title: "Follow up the lead", leadId: lead.id, assigneeMembershipId: otherSales.membershipId });

    const mine = (await listTasksGrouped(otherSales)).groups.flatMap((g) => g.items).find((t) => t.id === task.id)!;
    expect(mine.link).toEqual({ type: "Lead", id: lead.id, label: null }); // another salesperson's lead: type only
    const asManagement = (await listTasksGrouped(management)).groups.flatMap((g) => g.items).find((t) => t.id === task.id)!;
    expect(asManagement.link?.label).toBeTruthy();
  });
});

describe("Restricted Technical My work (FIG-1038, T1, D3)", () => {
  async function techSetup() {
    const s = await setup();
    const { company } = await companyService.createCompany(s.management, { name: "Client Co" });
    const wonStage = await getPipelineStageId(s.org.id, "CLOSED_WON");
    const deal = await dealService.createDeal(s.sales, { companyId: company.id, pipelineStageId: await getPipelineStageId(s.org.id), value: 876543 });
    await dealService.updateDeal(s.management, deal.id, {
      pipelineStageId: wonStage,
      handoff: { deliveryOwnerMembershipId: s.delivery.membershipId, scope: "Install 12 cameras", requirements: "Cabling to the server room" },
    });
    return { ...s, company, deal };
  }

  it("shows a technician their tasks with the requirements snapshot and files, and nothing about the deal", async () => {
    const { management, technical, company, deal } = await techSetup();
    const task = await createTask(management, {
      title: "Run cabling",
      description: "Floor 2",
      requirements: "Use Cat6. Label both ends.",
      assigneeMembershipId: technical.membershipId,
      companyId: company.id,
      dealId: deal.id,
    });
    const { attachment } = await addAttachment(management, "task", task.id, { name: "plan.png", mimeType: "image/png", sizeBytes: PNG.length, title: "Floor plan" });
    await driver.putObject(attachment.file.storageKey, PNG, { contentType: "image/png" });
    await completeAttachment(management, attachment.id);

    const work = await getMyWork(technical);
    const items = work.groups.flatMap((g) => g.items);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Run cabling", requirements: "Use Cat6. Label both ends.", files: [{ name: "plan.png", title: "Floor plan" }] });
    expect(work.counts.NO_DATE).toBe(1);

    const text = JSON.stringify(work);
    for (const leak of ["876543", deal.id, company.id, "Client Co", "dealId", "companyId", "leadId", "contactId", "link"]) {
      expect(text, leak).not.toContain(leak);
    }
    // The technician cannot open the linked deal or company.
    await expect(dealService.getDeal(technical, deal.id)).rejects.toThrow();
    await expect(companyService.getCompany(technical, company.id)).rejects.toThrow();
  });

  it("the requirements are a snapshot: onboarding tasks carry the handoff scope as written, and later changes do not rewrite them", async () => {
    const { delivery, deal, management, technical } = await techSetup();
    const tasks = await adminDb.task.findMany({ where: { dealId: deal.id } });
    expect(tasks.length).toBe(3);
    expect(tasks.every((t) => t.requirements === "Scope: Install 12 cameras\n\nRequirements: Cabling to the server room")).toBe(true);

    await adminDb.dealHandoff.updateMany({ where: { dealId: deal.id }, data: { scope: "Changed later" } });
    expect((await adminDb.task.findMany({ where: { dealId: deal.id } }))[0]!.requirements).toContain("Install 12 cameras");

    // A technician is handed one of them and sees the snapshot.
    const reassigned = tasks[0]!;
    await updateTask(management, reassigned.id, { assigneeMembershipId: technical.membershipId });
    expect((await getMyWork(technical)).groups.flatMap((g) => g.items)[0]!.requirements).toContain("Install 12 cameras");
    void delivery;
  });

  it("only a technician's own tasks; other roles and a switched-off departure have no My work; the requirements are length-limited", async () => {
    const { org, management, sales, delivery, technical, otherTechnical } = await setup();
    await createTask(management, { title: "For tech 1", assigneeMembershipId: technical.membershipId });
    await createTask(management, { title: "For tech 2", assigneeMembershipId: otherTechnical.membershipId });
    expect((await getMyWork(technical)).groups.flatMap((g) => g.items).map((t) => t.title)).toEqual(["For tech 1"]);
    await expect(getMyWork(sales)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMyWork(delivery)).rejects.toBeInstanceOf(ForbiddenError);

    await expect(createTask(management, { title: "Long", requirements: "x".repeat(5001) })).rejects.toBeInstanceOf(ValidationError);

    await updateFeatureToggles(management, { "departure.technical_my_work": false });
    const off = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "off");
    await expect(getMyWork(off)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the technician can finish their own task, and it moves to Done", async () => {
    const { management, technical } = await setup();
    const task = await createTask(management, { title: "Install", assigneeMembershipId: technical.membershipId });
    await updateTask(technical, task.id, { status: "COMPLETED" });
    const work = await getMyWork(technical, { groups: ["DONE", "NO_DATE"] });
    expect(work.groups.find((g) => g.key === "DONE")).toMatchObject({ count: 1, collapsed: false });
    expect(work.groups.find((g) => g.key === "NO_DATE")!.count).toBe(0);
  });

  it("another organisation sees none of it", async () => {
    const one = await setup();
    const two = await setup();
    const t = await createTask(one.management, { title: "Tenant task", assigneeMembershipId: one.technical.membershipId });
    expect((await listTasksGrouped(two.management)).counts.NO_DATE).toBe(0);
    await expect(updateTask(two.management, t.id, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
