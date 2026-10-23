import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import * as leadService from "../src/services/leadService";
import * as taskService from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
} from "./helpers/fixtures";

describe("taskService", () => {
  it("defaults a newly created task's assignee to its creator when only tasks.assign.own is held", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    const task = await taskService.createTask(ctx, { title: "Call back" });
    expect(task.assigneeMembershipId).toBe(ctx.membershipId);
  });

  it("ignores a client-supplied assignee override when the caller only has tasks.assign.own", async () => {
    const org = await createTestOrganization();
    const ownCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");

    const task = await taskService.createTask(ownCtx, {
      title: "Sneaky reassignment attempt",
      assigneeMembershipId: otherCtx.membershipId,
    });
    expect(task.assigneeMembershipId).toBe(ownCtx.membershipId);
  });

  it("Management (tasks.assign.any) can assign a task to another active member", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES");

    const task = await taskService.createTask(managementCtx, {
      title: "Follow up",
      assigneeMembershipId: salesCtx.membershipId,
    });
    expect(task.assigneeMembershipId).toBe(salesCtx.membershipId);
  });

  it("Finance (no tasks.* permission) cannot create a task", async () => {
    const org = await createTestOrganization();
    const financeCtx = await createTestContext(org.id, "FINANCE");

    await expect(
      taskService.createTask(financeCtx, { title: "Should fail" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("Sales (tasks.view.own only) does not see a colleague's task in listTasks", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    await taskService.createTask(ownerCtx, { title: "Owner's task" });

    const results = await taskService.listTasks(otherCtx, {
      assigneeMembershipId: ownerCtx.membershipId,
    });
    expect(results).toHaveLength(0);
  });

  it("Management (tasks.view.all) sees every task in the organization", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES");
    await taskService.createTask(managementCtx, { title: "Mgmt task" });
    await taskService.createTask(salesCtx, { title: "Sales task" });

    const results = await taskService.listTasks(managementCtx);
    expect(results).toHaveLength(2);
  });

  it("marking a task COMPLETED stamps completedAt, and reopening clears it", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const task = await taskService.createTask(ctx, { title: "Do the thing" });

    const completed = await taskService.updateTask(ctx, task.id, {
      status: "COMPLETED",
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();

    const reopened = await taskService.updateTask(ctx, task.id, {
      status: "IN_PROGRESS",
    });
    expect(reopened.completedAt).toBeNull();
  });

  it("a colleague who is neither assignee nor creator cannot update the task", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const task = await taskService.createTask(ownerCtx, { title: "Private" });

    await expect(
      taskService.updateTask(otherCtx, task.id, { status: "COMPLETED" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("Sales cannot reassign a task to someone else even if they are its creator", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const task = await taskService.createTask(ownerCtx, { title: "Mine" });

    await expect(
      taskService.updateTask(ownerCtx, task.id, {
        assigneeMembershipId: otherCtx.membershipId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("overdueOnly only returns tasks with a past dueAt that are still open", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const overdueTask = await taskService.createTask(ctx, {
      title: "Overdue",
      dueAt: past,
    });
    await taskService.createTask(ctx, { title: "Not due yet", dueAt: future });
    const completedButPastDue = await taskService.createTask(ctx, {
      title: "Completed, past due",
      dueAt: past,
    });
    await taskService.updateTask(ctx, completedButPastDue.id, {
      status: "COMPLETED",
    });

    const overdue = await taskService.listTasks(ctx, { overdueOnly: true });
    expect(overdue.map((t) => t.id)).toEqual([overdueTask.id]);
  });

  it("requires a real target when reassigning, rejecting a bogus membership id", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const task = await taskService.createTask(managementCtx, { title: "X" });

    await expect(
      taskService.updateTask(managementCtx, task.id, {
        assigneeMembershipId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("taskService: who can see and change what (roles & task states)", () => {
  async function setup() {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const sales = await createTestContext(org.id, "SALES", "sales");
    const salesTwo = await createTestContext(org.id, "SALES", "sales2");
    const delivery = await createTestContext(org.id, "DELIVERY", "deliv");
    const finance = await createTestContext(org.id, "FINANCE", "fin");
    const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");
    return { org, management, sales, salesTwo, delivery, finance, tech };
  }

  describe("visibility", () => {
    it("everyone except Finance sees their own tasks; Management sees all", async () => {
      const { management, sales, salesTwo, delivery, tech } = await setup();
      await taskService.createTask(sales, { title: "Sales task" });
      await taskService.createTask(salesTwo, { title: "Sales two task" });
      await taskService.createTask(delivery, { title: "Delivery task" });
      await taskService.createTask(tech, { title: "Tech task" });

      expect(await taskService.listTasks(management)).toHaveLength(4);
      for (const ctx of [sales, salesTwo, delivery, tech]) {
        const mine = await taskService.listTasks(ctx);
        expect(mine).toHaveLength(1);
        expect(mine[0]!.assigneeMembershipId).toBe(ctx.membershipId);
      }
    });

    it("Finance has no access to tasks at all", async () => {
      const { finance, management, sales } = await setup();
      const task = await taskService.createTask(sales, { title: "Not for finance" });
      await expect(taskService.listTasks(finance)).rejects.toThrow(ForbiddenError);
      await expect(taskService.createTask(finance, { title: "x" })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(taskService.getTask(finance, task.id)).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        taskService.listAssignableTaskAssignees(finance),
      ).rejects.toThrow(ForbiddenError);
      expect(await taskService.listTasks(management)).toHaveLength(1);
    });

    it("every task row carries the assignee's name, for roles that cannot list members", async () => {
      const { sales } = await setup();
      await taskService.createTask(sales, { title: "Named" });
      const [row] = await taskService.listTasks(sales);
      expect(row!.assigneeName).toBeTruthy();
      expect(row).not.toHaveProperty("assignee");
    });
  });

  describe("assigning", () => {
    it("Management can assign to Sales, Delivery and Restricted Technical but not to Finance", async () => {
      const { management, sales, delivery, tech, finance } = await setup();
      for (const target of [sales, delivery, tech]) {
        const task = await taskService.createTask(management, {
          title: "Handed over",
          assigneeMembershipId: target.membershipId,
        });
        expect(task.assigneeMembershipId).toBe(target.membershipId);
      }
      await expect(
        taskService.createTask(management, {
          title: "To finance",
          assigneeMembershipId: finance.membershipId,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("reassigning an existing task also rejects people who cannot open tasks", async () => {
      const { management, sales, finance } = await setup();
      const task = await taskService.createTask(management, {
        title: "Move me",
        assigneeMembershipId: sales.membershipId,
      });
      await expect(
        taskService.updateTask(management, task.id, {
          assigneeMembershipId: finance.membershipId,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("lists only people who can open tasks as assignable, and only for Management", async () => {
      const { management, sales, delivery, tech, finance } = await setup();
      const ids = (await taskService.listAssignableTaskAssignees(management)).map(
        (a) => a.membershipId,
      );
      expect(ids).toEqual(
        expect.arrayContaining([
          management.membershipId,
          sales.membershipId,
          delivery.membershipId,
          tech.membershipId,
        ]),
      );
      expect(ids).not.toContain(finance.membershipId);
      await expect(taskService.listAssignableTaskAssignees(sales)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("task states", () => {
    it("a completed task keeps its completion time when saved again", async () => {
      const { sales } = await setup();
      const task = await taskService.createTask(sales, { title: "Done once" });
      const first = await taskService.updateTask(sales, task.id, {
        status: "COMPLETED",
      });
      const again = await taskService.updateTask(sales, task.id, {
        status: "COMPLETED",
      });
      expect(again.completedAt?.getTime()).toBe(first.completedAt?.getTime());
    });

    it("a closed task must be reopened before its details change", async () => {
      const { sales } = await setup();
      const task = await taskService.createTask(sales, { title: "Closed" });
      await taskService.updateTask(sales, task.id, { status: "COMPLETED" });

      await expect(
        taskService.updateTask(sales, task.id, { title: "Renamed while closed" }),
      ).rejects.toThrow(ValidationError);

      const reopened = await taskService.updateTask(sales, task.id, {
        status: "PENDING",
        title: "Renamed after reopening",
      });
      expect(reopened.title).toBe("Renamed after reopening");
      expect(reopened.completedAt).toBeNull();

      await taskService.updateTask(sales, task.id, { status: "CANCELLED" });
      await expect(
        taskService.updateTask(sales, task.id, { priority: "HIGH" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a blank title and an invalid due date", async () => {
      const { sales } = await setup();
      await expect(
        taskService.createTask(sales, { title: "   " }),
      ).rejects.toThrow(ValidationError);
      await expect(
        taskService.createTask(sales, { title: "Bad date", dueAt: "not-a-date" }),
      ).rejects.toThrow(ValidationError);

      const task = await taskService.createTask(sales, { title: "Fine" });
      await expect(
        taskService.updateTask(sales, task.id, { title: "  " }),
      ).rejects.toThrow(ValidationError);
      await expect(
        taskService.updateTask(sales, task.id, { dueAt: "garbage" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("capabilities and linked records", () => {
    it("the assignee, the creator and Management can manage a task; a colleague cannot", async () => {
      const { management, sales, salesTwo } = await setup();
      const task = await taskService.createTask(sales, { title: "Mine" });
      expect(taskService.taskCapabilities(sales, task).canManage).toBe(true);
      expect(taskService.taskCapabilities(management, task).canManage).toBe(true);
      expect(taskService.taskCapabilities(management, task).canReassign).toBe(true);
      expect(taskService.taskCapabilities(sales, task).canReassign).toBe(false);
      expect(taskService.taskCapabilities(salesTwo, task).canManage).toBe(false);
    });

    it("only names a linked record the viewer is allowed to open", async () => {
      const { management, sales, delivery, tech } = await setup();
      const leadStatusId = await getLeadStatusId(management.organizationId);
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      const task = await taskService.createTask(management, {
        title: "Chase this lead",
        leadId: lead.id,
        assigneeMembershipId: delivery.membershipId,
      });

      const forOwner = await taskService.describeTaskLinks(sales, [task]);
      expect(forOwner[task.id]).toMatchObject({ type: "Lead", id: lead.id });
      expect(forOwner[task.id]!.label).toBeTruthy();

      const forManagement = await taskService.describeTaskLinks(management, [task]);
      expect(forManagement[task.id]!.label).toBeTruthy();

      // Delivery and Restricted Technical hold no lead permissions -- they get
      // the type ("Lead") but never the lead's name.
      for (const ctx of [delivery, tech]) {
        const hidden = await taskService.describeTaskLinks(ctx, [task]);
        expect(hidden[task.id]).toMatchObject({ type: "Lead", label: null });
      }
    });
  });
});
