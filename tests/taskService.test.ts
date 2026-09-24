import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import * as taskService from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
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
    ).rejects.toThrow(ForbiddenError);
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
