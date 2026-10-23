import type { HandoffStatus, Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
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
  countHandoffsByStatus,
  createDealHandoff,
  deleteDealHandoff,
  findDealHandoff,
  listDealHandoffs,
  markTasksCreated,
  takeOwnerlessHandoff,
  updateDealHandoffRecord,
} from "../repositories/dealHandoffs";
import { createTask, deleteTasksByIds } from "../repositories/tasks";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { getDeal } from "./dealService";
import { notifyDealWonHandoff, notifyHandoffEvent } from "./notificationService";
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
  /** Whether Management may mark a handoff Delivered, or only the Delivery owner (an open question, so configurable). Default: yes. */
  managementCanMarkDelivered: boolean;
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
    managementCanMarkDelivered: true,
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
    managementCanMarkDelivered: value?.managementCanMarkDelivered !== false,
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
  input: Omit<HandoffSettings, "managementCanMarkDelivered"> & { managementCanMarkDelivered?: boolean },
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
    managementCanMarkDelivered: input.managementCanMarkDelivered !== false,
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
    newValue: { taskCount: tasks.length, customerLifecycleStateId: value.customerLifecycleStateId, managementCanMarkDelivered: value.managementCanMarkDelivered },
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

/** The handoff dialog (P3): who receives it and what to set up. Every field is optional. */
export interface HandoffOptions {
  /** The Delivery owner. Defaults to the deal's owner unless `ownerLater` is set. */
  deliveryOwnerMembershipId?: string;
  /** "Owner later": nobody yet; the handoff waits as Awaiting owner until someone in Delivery takes it. */
  ownerLater?: boolean;
  /** "Template off": do not create the onboarding tasks. */
  templateOff?: boolean;
  /** "Lifecycle off": do not change the company's lifecycle state. */
  lifecycleOff?: boolean;
  startDate?: string | null;
  scope?: string | null;
  requirements?: string | null;
  deliverables?: string[];
  teamMembershipIds?: string[];
}

export interface HandoffResult {
  handoffId: string;
  deliveryOwnerMembershipId: string | null;
  status: "AWAITING_OWNER" | "ONBOARDING";
  taskIds: string[];
  companyService: "created" | "reactivated" | "already_active" | "none";
  lifecycleStateChanged: boolean;
}

const MAX_TEXT = 5000;
const MAX_DELIVERABLES = 30;
const MAX_DELIVERABLE_LENGTH = 200;
const MAX_TEAM = 20;

function cleanText(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_TEXT) {
    throw new ValidationError(`The ${field} is too long.`, [{ path: field, message: `At most ${MAX_TEXT} characters.` }]);
  }
  return trimmed;
}

function cleanDeliverableTitles(titles: string[] | undefined): { title: string; done: boolean }[] {
  const list = titles ?? [];
  if (list.length > MAX_DELIVERABLES) {
    throw new ValidationError(`At most ${MAX_DELIVERABLES} deliverables.`, [{ path: "deliverables", message: `At most ${MAX_DELIVERABLES}.` }]);
  }
  return list.map((title, i) => {
    const t = typeof title === "string" ? title.trim() : "";
    if (!t || t.length > MAX_DELIVERABLE_LENGTH) {
      throw new ValidationError("A deliverable needs a title.", [{ path: `deliverables.${i}`, message: `1 to ${MAX_DELIVERABLE_LENGTH} characters.` }]);
    }
    return { title: t, done: false };
  });
}

function cleanStartDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new ValidationError("The start date is not a valid date.", [{ path: "startDate", message: "Use a date such as 2026-11-30." }]);
  }
  return date;
}

async function cleanTeam(organizationId: string, ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > MAX_TEAM) {
    throw new ValidationError(`At most ${MAX_TEAM} team members.`, [{ path: "teamMembershipIds", message: `At most ${MAX_TEAM}.` }]);
  }
  if (unique.length === 0) return [];
  const found = await adminDb.membership.findMany({ where: { id: { in: unique }, organizationId, status: "ACTIVE" }, select: { id: true } });
  if (found.length !== unique.length) {
    throw new ValidationError("Some team members are not active members of this organization.", [{ path: "teamMembershipIds", message: "Unknown or inactive member." }]);
  }
  return unique;
}

/** Members who can receive a handoff (the Delivery side), for "Awaiting owner" notices. */
async function deliveryRecipients(organizationId: string, exceptMembershipId?: string) {
  const members = await adminDb.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { rolePermissions: { some: { permission: { key: "handoff.manage" } } } } },
    select: { id: true },
  });
  return members.map((m) => m.id).filter((id) => id !== exceptMembershipId);
}

/** Management side: the people who may change any deal, told so the handoff is not a surprise. */
async function managementRecipients(organizationId: string, exceptMembershipId?: string) {
  const members = await adminDb.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { rolePermissions: { some: { permission: { key: "deals.edit.all" } } } } },
    select: { id: true },
  });
  return members.map((m) => m.id).filter((id) => id !== exceptMembershipId);
}

/** The scope and requirements as written at handoff, copied onto each onboarding task so a technician sees them without opening the deal (FIG-1038). */
function requirementsSnapshot(source: { scope?: string | null; requirements?: string | null }): string | undefined {
  const parts = [source.scope ? `Scope: ${source.scope}` : null, source.requirements ? `Requirements: ${source.requirements}` : null].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Creates the organisation's onboarding tasks for a handoff, once, assigned to the owner. Returns the task ids. */
async function createOnboardingTasks(
  organizationId: string,
  actorMembershipId: string,
  handoffId: string,
  dealId: string,
  companyId: string,
  assigneeMembershipId: string,
  settings: HandoffSettings,
  snapshot: { scope?: string | null; requirements?: string | null } = {},
): Promise<string[]> {
  // Claimed first, so a repeated call (two people taking at once, a retry) never creates a second set.
  if (!(await markTasksCreated(organizationId, handoffId))) return [];
  const ids: string[] = [];
  const now = Date.now();
  try {
    for (const template of settings.tasks) {
      const task = await createTask({
        organizationId,
        title: template.title,
        description: template.description,
        requirements: requirementsSnapshot(snapshot),
        assigneeMembershipId,
        createdByMembershipId: actorMembershipId,
        dueAt: new Date(now + template.dueInDays * DAY_MS),
        priority: template.priority,
        companyId,
        dealId,
      });
      ids.push(task.id);
    }
  } catch (err) {
    await deleteTasksByIds(organizationId, ids).catch(() => undefined);
    await updateDealHandoffRecord(organizationId, handoffId, { tasksCreatedAt: null }).catch(() => undefined);
    throw err;
  }
  return ids;
}

/**
 * Runs the handoff for a deal that has just been won:
 *
 *  1. links the deal's service to the company (created, or reactivated if it
 *     had ended; already-active links are left alone);
 *  2. moves the company to the configured customer lifecycle state (unless the
 *     dialog turned that off, or the organisation has no such state);
 *  3. creates the organization's onboarding tasks, assigned to the Delivery
 *     owner (unless the dialog turned the template off). With "owner later" the
 *     tasks wait until someone takes the handoff;
 *  4. records a note on the deal and company timelines and an audit event;
 *  5. tells the owner (DEAL_WON_HANDOFF), or every Delivery member when it is
 *     awaiting an owner, and Management.
 *
 * Idempotent per deal: the handoff row is claimed first, and a deal that is
 * re-opened and won again returns `null` without creating anything twice.
 * If a later step fails the claim is released so a retry starts clean.
 */
export async function startDealWonHandoff(
  ctx: AuthContext,
  deal: DealForHandoff,
  options: HandoffOptions = {},
): Promise<HandoffResult | null> {
  const organizationId = ctx.organizationId;
  const ownerLater = options.ownerLater === true && !options.deliveryOwnerMembershipId;
  const deliveryOwnerMembershipId = ownerLater ? null : (options.deliveryOwnerMembershipId ?? deal.ownerMembershipId);

  const startDate = cleanStartDate(options.startDate);
  const scope = cleanText(options.scope, "scope");
  const requirements = cleanText(options.requirements, "requirements");
  const deliverables = cleanDeliverableTitles(options.deliverables);
  const teamMembershipIds = await cleanTeam(organizationId, options.teamMembershipIds);

  const claim = await createDealHandoff({
    organizationId,
    dealId: deal.id,
    deliveryOwnerMembershipId,
    createdByMembershipId: ctx.membershipId,
    startDate,
    scope,
    requirements,
    deliverables,
    teamMembershipIds,
  });
  if (!claim) return null;

  let taskIds: string[] = [];
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
    if (options.lifecycleOff !== true) {
      const customerState = settings.customerLifecycleStateId
        ? await adminDb.customerLifecycleState.findFirst({
            where: { id: settings.customerLifecycleStateId, organizationId, isActive: true },
          })
        : await adminDb.customerLifecycleState.findFirst({
            where: { organizationId, key: "CUSTOMER", isActive: true },
          });
      if (customerState && company.lifecycleStateId !== customerState.id) {
        await updateCompanyRecord(organizationId, company.id, { lifecycleStateId: customerState.id });
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
        logger.warn({ organizationId, dealId: deal.id }, "Won-deal handoff found no customer lifecycle state to move the company to");
      }
    }

    // 3. Onboarding tasks from the organization's template.
    if (deliveryOwnerMembershipId && options.templateOff !== true) {
      taskIds = await createOnboardingTasks(organizationId, ctx.membershipId, claim.id, deal.id, company.id, deliveryOwnerMembershipId, settings, { scope, requirements });
    } else if (options.templateOff === true) {
      // Switched off for this handoff: nothing will be created now or when someone takes it.
      await updateDealHandoffRecord(organizationId, claim.id, { tasksCreatedAt: new Date() });
    }

    // 4. Timeline note (shows on the deal and on the company) and audit.
    const owner = deliveryOwnerMembershipId
      ? await adminDb.membership.findFirst({ where: { id: deliveryOwnerMembershipId, organizationId }, include: { user: true } })
      : null;
    await createActivity({
      organizationId,
      type: "NOTE",
      subject: "Handed off to Delivery",
      description: owner
        ? `This deal was won and handed off to ${owner.user.name}. ${taskIds.length} onboarding task${taskIds.length === 1 ? "" : "s"} created.`
        : "This deal was won and is waiting for someone in Delivery to take it.",
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
      newValue: { deliveryOwnerMembershipId, status: claim.status },
      metadata: {
        handoffId: claim.id,
        companyId: company.id,
        taskIds,
        companyService,
        lifecycleStateChanged,
        templateOff: options.templateOff === true,
        lifecycleOff: options.lifecycleOff === true,
      },
    });

    // 5. Tell the people concerned (best-effort; never fails the handoff).
    if (deliveryOwnerMembershipId) {
      await notifyDealWonHandoff(organizationId, deliveryOwnerMembershipId, { id: deal.id, label: company.name, taskCount: taskIds.length });
    } else {
      for (const membershipId of await deliveryRecipients(organizationId, ctx.membershipId)) {
        await notifyHandoffEvent(organizationId, membershipId, {
          key: `${claim.id}:awaiting`,
          dealId: deal.id,
          title: `A won deal needs a Delivery owner: ${company.name}`,
          body: "Open the handoff to take it.",
        });
      }
    }
    for (const membershipId of await managementRecipients(organizationId, ctx.membershipId)) {
      if (membershipId === deliveryOwnerMembershipId) continue;
      await notifyHandoffEvent(organizationId, membershipId, {
        key: `${claim.id}:created`,
        dealId: deal.id,
        title: `Deal won and handed off: ${company.name}`,
        body: owner ? `Delivery owner: ${owner.user.name}.` : "No Delivery owner yet.",
      });
    }

    return {
      handoffId: claim.id,
      deliveryOwnerMembershipId,
      status: claim.status as "AWAITING_OWNER" | "ONBOARDING",
      taskIds,
      companyService,
      lifecycleStateChanged,
    };
  } catch (err) {
    // Undo what this attempt created and release the claim, so winning the
    // deal again can retry without duplicating tasks.
    await deleteTasksByIds(organizationId, taskIds).catch((cleanupErr) =>
      logger.error({ err: cleanupErr, organizationId, dealId: deal.id }, "Failed to remove onboarding tasks after the handoff failed"),
    );
    await deleteDealHandoff(organizationId, claim.id).catch((cleanupErr) =>
      logger.error({ err: cleanupErr, organizationId, dealId: deal.id }, "Failed to release a handoff claim after the handoff failed"),
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Delivery receiving (P4)
// ---------------------------------------------------------------------------

async function timelineNote(ctx: AuthContext, dealId: string, companyId: string, subject: string, description: string) {
  await createActivity({
    organizationId: ctx.organizationId,
    type: "NOTE",
    subject,
    description,
    authorMembershipId: ctx.membershipId,
    companyId,
    dealId,
  });
}

/** The handoff for a deal as the Delivery receiving view shows it: status, owner, scope, deliverables, and the client profile. */
export async function getHandoffView(ctx: AuthContext, dealId: string) {
  // Anyone who cannot open the deal gets the refusal the deal route gives; a Delivery user can open a deal only once it is Won.
  const deal = await getDeal(ctx, dealId);
  const handoff = await findDealHandoff(ctx.organizationId, dealId);
  if (!handoff) return { handoff: null };
  const [company, names, tasks] = await Promise.all([
    adminDb.company.findFirst({
      where: { id: deal.companyId, organizationId: ctx.organizationId },
      select: { id: true, name: true, industry: true, website: true, location: true, phone: true, email: true },
    }),
    adminDb.membership.findMany({
      where: { organizationId: ctx.organizationId, id: { in: [handoff.deliveryOwnerMembershipId, handoff.deliveredByMembershipId, ...asIds(handoff.teamMembershipIds)].filter((x): x is string => !!x) } },
      select: { id: true, user: { select: { name: true } } },
    }),
    adminDb.task.findMany({
      where: { organizationId: ctx.organizationId, dealId, archivedAt: null },
      select: { id: true, title: true, status: true, dueAt: true, assigneeMembershipId: true },
      orderBy: { dueAt: "asc" },
    }),
  ]);
  const name = new Map(names.map((n) => [n.id, n.user.name]));
  return {
    handoff: {
      id: handoff.id,
      dealId,
      status: handoff.status,
      deliveryOwner: handoff.deliveryOwnerMembershipId ? { membershipId: handoff.deliveryOwnerMembershipId, name: name.get(handoff.deliveryOwnerMembershipId) ?? null } : null,
      team: asIds(handoff.teamMembershipIds).map((id) => ({ membershipId: id, name: name.get(id) ?? null })),
      startDate: handoff.startDate,
      scope: handoff.scope,
      requirements: handoff.requirements,
      deliverables: asDeliverables(handoff.deliverables),
      createdAt: handoff.createdAt,
      ownerTakenAt: handoff.ownerTakenAt,
      deliveredAt: handoff.deliveredAt,
      deliveredBy: handoff.deliveredByMembershipId ? { membershipId: handoff.deliveredByMembershipId, name: name.get(handoff.deliveredByMembershipId) ?? null } : null,
      company,
      tasks,
      /** What the caller may do now, so the screen shows only buttons that work. */
      can: await capabilities(ctx, handoff),
    },
  };
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function asDeliverables(value: unknown): { title: string; done: boolean }[] {
  return Array.isArray(value)
    ? value.filter((v): v is { title: string; done: boolean } => !!v && typeof (v as { title?: unknown }).title === "string").map((v) => ({ title: v.title, done: v.done === true }))
    : [];
}

async function capabilities(ctx: AuthContext, handoff: { status: string; deliveryOwnerMembershipId: string | null }) {
  const settings = await loadSettings(ctx.organizationId);
  const manager = hasPermission(ctx, "deals.edit.all");
  const isOwner = handoff.deliveryOwnerMembershipId === ctx.membershipId;
  const receives = hasPermission(ctx, "handoff.manage");
  return {
    take: receives && handoff.status === "AWAITING_OWNER",
    edit: handoff.status !== "DELIVERED" && (isOwner || manager),
    markDelivered: handoff.status === "ONBOARDING" && (isOwner || (manager && settings.managementCanMarkDelivered)),
    reopen: handoff.status === "DELIVERED" && manager,
  };
}

/**
 * Someone in Delivery takes an ownerless handoff: they become its owner, the
 * onboarding tasks are created for them (once), and the timeline and Management
 * are told. Two people taking it at once: exactly one succeeds.
 */
export async function takeHandoff(ctx: AuthContext, dealId: string) {
  requirePermission(ctx, "handoff.manage");
  const deal = await getDeal(ctx, dealId);
  const handoff = await findDealHandoff(ctx.organizationId, dealId);
  if (!handoff) throw new NotFoundError("DealHandoff", dealId);
  if (handoff.status !== "AWAITING_OWNER") {
    throw new ValidationError("This handoff already has an owner.", [{ path: "status", message: "Already taken.", code: "HANDOFF_ALREADY_TAKEN" }]);
  }
  await assertEligibleTaskAssignee(ctx.organizationId, ctx.membershipId);
  const won = await takeOwnerlessHandoff(ctx.organizationId, handoff.id, ctx.membershipId);
  if (!won) {
    throw new ValidationError("Someone else took this handoff a moment ago.", [{ path: "status", message: "Already taken.", code: "HANDOFF_ALREADY_TAKEN" }]);
  }
  const settings = await loadSettings(ctx.organizationId);
  const taskIds = await createOnboardingTasks(ctx.organizationId, ctx.membershipId, handoff.id, dealId, deal.companyId, ctx.membershipId, settings, { scope: handoff.scope, requirements: handoff.requirements });

  const company = await adminDb.company.findFirst({ where: { id: deal.companyId, organizationId: ctx.organizationId }, select: { name: true } });
  const me = await adminDb.membership.findFirst({ where: { id: ctx.membershipId }, select: { user: { select: { name: true } } } });
  await timelineNote(ctx, dealId, deal.companyId, "Delivery owner took the handoff", `${me?.user.name ?? "Someone in Delivery"} took this handoff. ${taskIds.length} onboarding task${taskIds.length === 1 ? "" : "s"} created.`);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deal.handoff_taken",
    entityType: "Deal",
    entityId: dealId,
    previousValue: { deliveryOwnerMembershipId: null, status: "AWAITING_OWNER" },
    newValue: { deliveryOwnerMembershipId: ctx.membershipId, status: "ONBOARDING" },
    metadata: { handoffId: handoff.id, taskIds },
  });
  for (const membershipId of await managementRecipients(ctx.organizationId, ctx.membershipId)) {
    await notifyHandoffEvent(ctx.organizationId, membershipId, {
      key: `${handoff.id}:taken`,
      dealId,
      title: `Handoff taken: ${company?.name ?? "a customer"}`,
      body: `${me?.user.name ?? "Someone"} is now the Delivery owner.`,
    });
  }
  return getHandoffView(ctx, dealId);
}

export interface UpdateHandoffInput {
  scope?: string | null;
  requirements?: string | null;
  startDate?: string | null;
  /** The full list of deliverables with their done flags. */
  deliverables?: { title: string; done?: boolean }[];
  teamMembershipIds?: string[];
  /** ONBOARDING (back from Delivered, Management only) or DELIVERED. */
  status?: "ONBOARDING" | "DELIVERED";
}

/**
 * Updates a handoff: the owner (or Management) edits scope, requirements,
 * start date, deliverables and team; the owner marks it Delivered (Management
 * too, when the organisation allows it). Delivered moves the company to Active
 * Customer. Management can reopen a delivered handoff.
 */
export async function updateHandoff(ctx: AuthContext, dealId: string, input: UpdateHandoffInput) {
  const deal = await getDeal(ctx, dealId);
  const handoff = await findDealHandoff(ctx.organizationId, dealId);
  if (!handoff) throw new NotFoundError("DealHandoff", dealId);
  const caps = await capabilities(ctx, handoff);

  const touchesDetails = ["scope", "requirements", "startDate", "deliverables", "teamMembershipIds"].some((k) => (input as Record<string, unknown>)[k] !== undefined);
  if (touchesDetails && !caps.edit) {
    if (handoff.status === "DELIVERED") throw new ValidationError("This handoff is delivered. Management can reopen it to make changes.", [{ path: "status", message: "Delivered." }]);
    requirePermission(ctx, "handoff.manage");
    throw deny(ctx, "being the Delivery owner of this handoff, or deals.edit.all", ["handoff.manage"]);
  }

  const data: Prisma.DealHandoffUncheckedUpdateInput = {};
  if (input.scope !== undefined) data.scope = cleanText(input.scope, "scope");
  if (input.requirements !== undefined) data.requirements = cleanText(input.requirements, "requirements");
  if (input.startDate !== undefined) data.startDate = cleanStartDate(input.startDate);
  if (input.teamMembershipIds !== undefined) data.teamMembershipIds = await cleanTeam(ctx.organizationId, input.teamMembershipIds);
  if (input.deliverables !== undefined) {
    const cleaned = cleanDeliverableTitles(input.deliverables.map((d) => d.title));
    data.deliverables = cleaned.map((d, i) => ({ title: d.title, done: input.deliverables![i]!.done === true }));
  }

  let delivered = false;
  if (input.status === "DELIVERED") {
    if (handoff.status === "DELIVERED") throw new ValidationError("This handoff is already delivered.");
    if (handoff.status === "AWAITING_OWNER") {
      throw new ValidationError("Take the handoff before marking it delivered.", [{ path: "status", message: "No owner yet.", code: "HANDOFF_NEEDS_OWNER" }]);
    }
    if (!caps.markDelivered) {
      throw new ValidationError("Only the Delivery owner can mark this delivered.", [{ path: "status", message: "Not allowed.", code: "HANDOFF_DELIVER_NOT_ALLOWED" }]);
    }
    data.status = "DELIVERED";
    data.deliveredAt = new Date();
    data.deliveredByMembershipId = ctx.membershipId;
    delivered = true;
  } else if (input.status === "ONBOARDING") {
    if (handoff.status !== "DELIVERED") throw new ValidationError("Only a delivered handoff can be reopened.");
    if (!caps.reopen) throw deny(ctx, "deals.edit.all", ["deals.edit.all"]);
    data.status = "ONBOARDING";
    data.deliveredAt = null;
    data.deliveredByMembershipId = null;
  }

  if (Object.keys(data).length === 0) return getHandoffView(ctx, dealId);
  await updateDealHandoffRecord(ctx.organizationId, handoff.id, data);

  let lifecycleStateChanged = false;
  if (delivered) lifecycleStateChanged = await moveCompanyToActiveCustomer(ctx, deal.companyId, dealId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: delivered ? "deal.handoff_delivered" : input.status === "ONBOARDING" ? "deal.handoff_reopened" : "deal.handoff_updated",
    entityType: "Deal",
    entityId: dealId,
    metadata: { handoffId: handoff.id, fields: Object.keys(data), lifecycleStateChanged },
  });
  if (delivered) {
    await timelineNote(ctx, dealId, deal.companyId, "Delivered", "Delivery marked this handoff as delivered.");
    const company = await adminDb.company.findFirst({ where: { id: deal.companyId, organizationId: ctx.organizationId }, select: { name: true } });
    for (const membershipId of await managementRecipients(ctx.organizationId, ctx.membershipId)) {
      await notifyHandoffEvent(ctx.organizationId, membershipId, {
        key: `${handoff.id}:delivered`,
        dealId,
        title: `Delivered: ${company?.name ?? "a customer"}`,
        body: "Delivery marked the handoff as delivered.",
      });
    }
  }
  return getHandoffView(ctx, dealId);
}

/** Delivered customers become Active Customers (B3.02 later turns this into the full lifecycle engine). */
async function moveCompanyToActiveCustomer(ctx: AuthContext, companyId: string, dealId: string): Promise<boolean> {
  const [company, state] = await Promise.all([
    adminDb.company.findFirst({ where: { id: companyId, organizationId: ctx.organizationId }, select: { lifecycleStateId: true } }),
    adminDb.customerLifecycleState.findFirst({ where: { organizationId: ctx.organizationId, key: "ACTIVE_CUSTOMER", isActive: true } }),
  ]);
  if (!company || !state || company.lifecycleStateId === state.id) return false;
  await updateCompanyRecord(ctx.organizationId, companyId, { lifecycleStateId: state.id });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "company.lifecycle_state_changed",
    entityType: "Company",
    entityId: companyId,
    previousValue: { lifecycleStateId: company.lifecycleStateId },
    newValue: { lifecycleStateId: state.id },
    metadata: { reason: "handoff_delivered", dealId },
  });
  return true;
}

export interface HandoffListQuery extends PageRequest {
  status?: string;
  /** Only handoffs this person owns. */
  mine?: boolean;
}

/**
 * The Delivery Handoffs view: Delivery and Management see every handoff (the
 * Awaiting owner ones are the pool to take from); a salesperson sees the
 * handoffs of their own deals, read-only.
 */
export async function listHandoffs(ctx: AuthContext, query: HandoffListQuery = {}) {
  const wide = hasPermission(ctx, "handoff.manage") || hasPermission(ctx, "deals.view.all");
  if (!wide && !hasPermission(ctx, "deals.view.own")) requirePermission(ctx, "handoff.manage");
  const status = query.status as HandoffStatus | undefined;
  if (status && !["AWAITING_OWNER", "ONBOARDING", "DELIVERED"].includes(status)) {
    throw new ValidationError("Unknown status.", [{ path: "status", message: "Use AWAITING_OWNER, ONBOARDING or DELIVERED." }]);
  }
  const paging = resolvePaging(query);
  const scope = {
    ownerMembershipId: query.mine ? ctx.membershipId : undefined,
    dealOwnerMembershipId: wide ? undefined : ctx.membershipId,
  };
  const [{ items, total }, counts] = await Promise.all([
    listDealHandoffs(ctx.organizationId, { status, ...scope }, paging),
    countHandoffsByStatus(ctx.organizationId, scope),
  ]);
  const ownerIds = items.map((h) => h.deliveryOwnerMembershipId).filter((x): x is string => !!x);
  const owners = ownerIds.length
    ? await adminDb.membership.findMany({ where: { organizationId: ctx.organizationId, id: { in: ownerIds } }, select: { id: true, user: { select: { name: true } } } })
    : [];
  const ownerName = new Map(owners.map((o) => [o.id, o.user.name]));
  return {
    ...buildPage(
      items.map((h) => ({
        id: h.id,
        dealId: h.dealId,
        status: h.status,
        company: h.deal.company,
        service: h.deal.service,
        deliveryOwner: h.deliveryOwnerMembershipId ? { membershipId: h.deliveryOwnerMembershipId, name: ownerName.get(h.deliveryOwnerMembershipId) ?? null } : null,
        startDate: h.startDate,
        createdAt: h.createdAt,
        deliveredAt: h.deliveredAt,
        deliverables: asDeliverables(h.deliverables),
      })),
      total,
      paging,
    ),
    counts,
  };
}
