import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { createActivity } from "../repositories/activities";
import { recordAuditEvent } from "../repositories/auditEvents";
import { updateCompany as updateCompanyRecord } from "../repositories/companies";
import {
  createCompanyServiceLink,
  updateCompanyServiceLink,
} from "../repositories/companyServiceLinks";
import {
  createDealHandoff,
  deleteDealHandoff,
} from "../repositories/dealHandoffs";
import { createTask, deleteTasksByIds } from "../repositories/tasks";
import { notifyDealWonHandoff } from "./notificationService";
import { assertEligibleTaskAssignee } from "./ownerEligibility";

/**
 * Sales-to-delivery handoff when a deal is won (FIG-792).
 *
 * This reacts to a stage move a person made; it never moves a stage, sets a
 * discount or approves anything itself (CLAUDE.md rule 9). The handoff
 * dialog and the Delivery Handoffs view are built in F2.06, and B2.08
 * extends this with Awaiting owner / Onboarding / Delivered states.
 */

const HANDOFF_SETTING_KEY = "delivery_handoff";

const MAX_TEMPLATE_TASKS = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_DUE_IN_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OnboardingTaskTemplate {
  title: string;
  description?: string;
  /** Days after the deal is won that the task falls due; 0 means due the same day. */
  dueInDays: number;
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export interface HandoffSettings {
  tasks: OnboardingTaskTemplate[];
  /**
   * The lifecycle state a company moves to when its deal is won. When null
   * the organization's own "CUSTOMER" state is used if it still has one.
   */
  customerLifecycleStateId: string | null;
}

export const DEFAULT_ONBOARDING_TASKS: OnboardingTaskTemplate[] = [
  { title: "Kick-off call with the client", dueInDays: 2, priority: "HIGH" },
  {
    title: "Confirm scope, requirements and access",
    dueInDays: 5,
    priority: "MEDIUM",
  },
  {
    title: "Set up the service and confirm the go-live date",
    dueInDays: 7,
    priority: "MEDIUM",
  },
];

function defaultSettings(): HandoffSettings {
  return {
    tasks: DEFAULT_ONBOARDING_TASKS.map((t) => ({ ...t })),
    customerLifecycleStateId: null,
  };
}

async function loadSettings(organizationId: string): Promise<HandoffSettings> {
  const row = await adminDb.organizationSetting.findUnique({
    where: {
      organizationId_key: { organizationId, key: HANDOFF_SETTING_KEY },
    },
  });
  if (!row) return defaultSettings();
  const value = row.value as Partial<HandoffSettings> | null;
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks : defaultSettings().tasks,
    customerLifecycleStateId: value?.customerLifecycleStateId ?? null,
  };
}

/** The organization's handoff template and customer state (defaults until it saves its own). */
export async function getHandoffSettings(ctx: AuthContext) {
  requirePermission(ctx, "organization.manage_settings");
  return loadSettings(ctx.organizationId);
}

function validateTemplate(tasks: OnboardingTaskTemplate[]): OnboardingTaskTemplate[] {
  if (!Array.isArray(tasks)) {
    throw new ValidationError("tasks must be a list.");
  }
  if (tasks.length > MAX_TEMPLATE_TASKS) {
    throw new ValidationError(
      `An onboarding template can have at most ${MAX_TEMPLATE_TASKS} tasks.`,
    );
  }
  return tasks.map((task, i) => {
    const title = typeof task.title === "string" ? task.title.trim() : "";
    if (!title) {
      throw new ValidationError(`Onboarding task ${i + 1} needs a title.`);
    }
    if (title.length > MAX_TITLE_LENGTH) {
      throw new ValidationError(
        `Onboarding task ${i + 1}'s title is longer than ${MAX_TITLE_LENGTH} characters.`,
      );
    }
    const description = task.description?.trim() || undefined;
    if (description && description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `Onboarding task ${i + 1}'s description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }
    if (
      !Number.isInteger(task.dueInDays) ||
      task.dueInDays < 0 ||
      task.dueInDays > MAX_DUE_IN_DAYS
    ) {
      throw new ValidationError(
        `Onboarding task ${i + 1}'s due date must be a whole number of days from 0 to ${MAX_DUE_IN_DAYS}.`,
      );
    }
    if (!["LOW", "MEDIUM", "HIGH"].includes(task.priority)) {
      throw new ValidationError(
        `Onboarding task ${i + 1}'s priority must be LOW, MEDIUM or HIGH.`,
      );
    }
    return {
      title,
      ...(description ? { description } : {}),
      dueInDays: task.dueInDays,
      priority: task.priority,
    };
  });
}

/**
 * Saves the organization's onboarding task template and customer state
 * (Management only). An empty task list is allowed: it turns the
 * onboarding tasks off while leaving the rest of the handoff on.
 */
export async function updateHandoffSettings(
  ctx: AuthContext,
  input: HandoffSettings,
) {
  requirePermission(ctx, "organization.manage_settings");
  const tasks = validateTemplate(input.tasks);

  if (input.customerLifecycleStateId) {
    const state = await adminDb.customerLifecycleState.findFirst({
      where: {
        id: input.customerLifecycleStateId,
        organizationId: ctx.organizationId,
        isActive: true,
      },
    });
    if (!state) {
      throw new ValidationError(
        "The selected customer lifecycle state was not found in this organization or is inactive.",
      );
    }
  }

  const value: HandoffSettings = {
    tasks,
    customerLifecycleStateId: input.customerLifecycleStateId ?? null,
  };
  await adminDb.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: ctx.organizationId,
        key: HANDOFF_SETTING_KEY,
      },
    },
    update: { value: value as unknown as Prisma.InputJsonValue },
    create: {
      organizationId: ctx.organizationId,
      key: HANDOFF_SETTING_KEY,
      value: value as unknown as Prisma.InputJsonValue,
    },
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "handoff_settings.updated",
    entityType: "Organization",
    entityId: ctx.organizationId,
    newValue: { taskCount: tasks.length, customerLifecycleStateId: value.customerLifecycleStateId },
  });

  return value;
}

/**
 * Called before the deal is changed, so a bad Delivery owner fails the
 * request cleanly instead of leaving a won deal with no handoff.
 */
export async function assertValidHandoffOwner(
  organizationId: string,
  deliveryOwnerMembershipId: string | undefined,
): Promise<void> {
  if (deliveryOwnerMembershipId) {
    await assertEligibleTaskAssignee(organizationId, deliveryOwnerMembershipId);
  }
}

export interface DealForHandoff {
  id: string;
  companyId: string;
  serviceId: string | null;
  ownerMembershipId: string;
}

export interface HandoffResult {
  handoffId: string;
  deliveryOwnerMembershipId: string;
  taskIds: string[];
  companyService: "created" | "reactivated" | "already_active" | "none";
  lifecycleStateChanged: boolean;
}

/**
 * Runs the handoff for a deal that has just been won:
 *
 *  1. links the deal's service to the company (created, or reactivated if it
 *     had ended; already-active links are left alone);
 *  2. moves the company to the configured customer lifecycle state;
 *  3. creates the organization's onboarding tasks, assigned to the Delivery
 *     owner chosen when the deal was won (the deal's owner if none was);
 *  4. records a note on the deal and company timelines and an audit event;
 *  5. notifies the assignee (DEAL_WON_HANDOFF).
 *
 * Idempotent per deal: the handoff row is claimed first, and a deal that is
 * re-opened and won again returns `null` without creating anything twice.
 * If a later step fails the claim is released so a retry starts clean.
 */
export async function startDealWonHandoff(
  ctx: AuthContext,
  deal: DealForHandoff,
  options: { deliveryOwnerMembershipId?: string } = {},
): Promise<HandoffResult | null> {
  const organizationId = ctx.organizationId;
  const deliveryOwnerMembershipId =
    options.deliveryOwnerMembershipId ?? deal.ownerMembershipId;

  const claim = await createDealHandoff({
    organizationId,
    dealId: deal.id,
    deliveryOwnerMembershipId,
    createdByMembershipId: ctx.membershipId,
  });
  if (!claim) return null;

  const taskIds: string[] = [];
  try {
    const settings = await loadSettings(organizationId);
    const company = await adminDb.company.findFirstOrThrow({
      where: { id: deal.companyId, organizationId },
      select: { id: true, name: true, lifecycleStateId: true },
    });

    // 1. CompanyService link for the deal's service.
    let companyService: HandoffResult["companyService"] = "none";
    if (deal.serviceId) {
      const existing = await adminDb.companyService.findMany({
        where: { organizationId, companyId: company.id, serviceId: deal.serviceId },
        orderBy: { createdAt: "desc" },
      });
      if (existing.some((l) => l.status === "ACTIVE")) {
        companyService = "already_active";
      } else if (existing.length > 0) {
        await updateCompanyServiceLink(organizationId, existing[0]!.id, {
          status: "ACTIVE",
          endDate: null,
        });
        companyService = "reactivated";
      } else {
        await createCompanyServiceLink({
          organizationId,
          companyId: company.id,
          serviceId: deal.serviceId,
          status: "ACTIVE",
          startDate: new Date(),
          notes: "Started from a won deal (sales-to-delivery handoff).",
        });
        companyService = "created";
      }
    }

    // 2. Company lifecycle state -> the configured customer state.
    let lifecycleStateChanged = false;
    const customerState = settings.customerLifecycleStateId
      ? await adminDb.customerLifecycleState.findFirst({
          where: {
            id: settings.customerLifecycleStateId,
            organizationId,
            isActive: true,
          },
        })
      : await adminDb.customerLifecycleState.findFirst({
          where: { organizationId, key: "CUSTOMER", isActive: true },
        });
    if (customerState && company.lifecycleStateId !== customerState.id) {
      await updateCompanyRecord(organizationId, company.id, {
        lifecycleStateId: customerState.id,
      });
      lifecycleStateChanged = true;
      await recordAuditEvent({
        organizationId,
        actorMembershipId: ctx.membershipId,
        action: "company.lifecycle_state_changed",
        entityType: "Company",
        entityId: company.id,
        previousValue: { lifecycleStateId: company.lifecycleStateId },
        newValue: { lifecycleStateId: customerState.id },
        metadata: { reason: "deal_won_handoff", dealId: deal.id },
      });
    } else if (!customerState) {
      logger.warn(
        { organizationId, dealId: deal.id },
        "Won-deal handoff found no customer lifecycle state to move the company to",
      );
    }

    // 3. Onboarding tasks from the organization's template.
    const now = Date.now();
    for (const template of settings.tasks) {
      const task = await createTask({
        organizationId,
        title: template.title,
        description: template.description,
        assigneeMembershipId: deliveryOwnerMembershipId,
        createdByMembershipId: ctx.membershipId,
        dueAt: new Date(now + template.dueInDays * DAY_MS),
        priority: template.priority,
        companyId: company.id,
        dealId: deal.id,
      });
      taskIds.push(task.id);
    }

    // 4. Timeline note (shows on the deal and on the company) and audit.
    const owner = await adminDb.membership.findFirst({
      where: { id: deliveryOwnerMembershipId, organizationId },
      include: { user: true },
    });
    const ownerName = owner?.user.name ?? "the Delivery owner";
    await createActivity({
      organizationId,
      type: "NOTE",
      subject: "Handed off to Delivery",
      description:
        `This deal was won and handed off to ${ownerName}. ` +
        `${taskIds.length} onboarding task${taskIds.length === 1 ? "" : "s"} created.`,
      authorMembershipId: ctx.membershipId,
      companyId: company.id,
      dealId: deal.id,
    });

    await recordAuditEvent({
      organizationId,
      actorMembershipId: ctx.membershipId,
      action: "deal.handoff_created",
      entityType: "Deal",
      entityId: deal.id,
      newValue: { deliveryOwnerMembershipId },
      metadata: {
        handoffId: claim.id,
        companyId: company.id,
        taskIds,
        companyService,
        lifecycleStateChanged,
      },
    });

    // 5. Tell the assignee (best-effort; never fails the handoff).
    await notifyDealWonHandoff(organizationId, deliveryOwnerMembershipId, {
      id: deal.id,
      label: company.name,
      taskCount: taskIds.length,
    });

    return {
      handoffId: claim.id,
      deliveryOwnerMembershipId,
      taskIds,
      companyService,
      lifecycleStateChanged,
    };
  } catch (err) {
    // Undo what this attempt created and release the claim, so winning the
    // deal again can retry without duplicating tasks.
    await deleteTasksByIds(organizationId, taskIds).catch((cleanupErr) =>
      logger.error(
        { err: cleanupErr, organizationId, dealId: deal.id },
        "Failed to remove onboarding tasks after the handoff failed",
      ),
    );
    await deleteDealHandoff(organizationId, claim.id).catch((cleanupErr) =>
      logger.error(
        { err: cleanupErr, organizationId, dealId: deal.id },
        "Failed to release a handoff claim after the handoff failed",
      ),
    );
    throw err;
  }
}
