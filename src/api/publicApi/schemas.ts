import { z } from "zod";
import { pageOf } from "../dto/common";
import { WEBHOOK_EVENT_TYPES } from "../../lib/webhookEvents";
import { API_SCOPES } from "../../auth/apiToken";

/**
 * Request and response schemas of the public REST API (FIG-805) and of the token and webhook management routes (FIG-805, FIG-804).
 * The OpenAPI document (`./openapi.ts`) is generated from these; the routes parse requests with the same objects.
 *
 * The public API answers with the same fields as the application's own API for the same record (the lead and deal DTOs are reused as
 * they are), so a response schema here only names the fields a script can rely on and allows the rest (`looseObject`).
 */

const flag = z.enum(["true", "false"]);

export const pageQuery = {
  limit: z.string().regex(/^\d+$/, "limit must be a whole number.").optional(),
  cursor: z.string().max(64).optional(),
  sort: z.string().max(64).optional(),
  page: z.string().regex(/^\d+$/, "page must be a whole number.").optional(),
  pageSize: z.string().regex(/^\d+$/, "pageSize must be a whole number.").optional(),
};

const requiredText = (message: string) => z.string({ error: message }).min(1, message);
const customFields = z.record(z.string(), z.any()).optional();

// --- Companies -----------------------------------------------------------------------------------------------------------------
export const ListCompaniesQuery = z.object({ q: z.string().optional(), ownerMembershipId: z.string().optional(), includeArchived: flag.optional(), ...pageQuery });
export const CreateCompanyBody = z.object({
  customFields,
  name: requiredText("name is required."),
  industry: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
  lifecycleStateId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
});
export const UpdateCompanyBody = z.object({
  customFields,
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
  lifecycleStateId: z.string().nullable().optional(),
  ownerMembershipId: z.string().nullable().optional(),
});

// --- Contacts ------------------------------------------------------------------------------------------------------------------
export const ListContactsQuery = z.object({ q: z.string().optional(), companyId: z.string().optional(), ownerMembershipId: z.string().optional(), includeArchived: flag.optional(), ...pageQuery });
export const CreateContactBody = z.object({
  customFields,
  firstName: requiredText("firstName is required."),
  lastName: z.string().optional(),
  companyId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
  ownerMembershipId: z.string().optional(),
});
export const UpdateContactBody = z.object({
  customFields,
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
  companyId: z.string().nullable().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  notes: z.string().optional(),
  ownerMembershipId: z.string().nullable().optional(),
});

// --- Leads (list query and create body are the application's own; see src/api/dto/leads.ts) -------------------------------------
export const UpdateLeadBody = z.object({
  customFields,
  leadStatusId: z.string().min(1).optional(),
  companyId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  leadSourceId: z.string().nullable().optional(),
  temperature: z.enum(["HOT", "WARM", "COLD"]).optional(),
  serviceInterestId: z.string().nullable().optional(),
  qualificationData: z.any().optional(),
  lostReasonId: z.string().nullable().optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// --- Deals ---------------------------------------------------------------------------------------------------------------------
export const ListDealsQuery = z.object({
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  outcome: z.enum(["OPEN", "WON", "LOST"]).optional(),
  companyId: z.string().optional(),
  includeArchived: flag.optional(),
  ...pageQuery,
});
export const CreateDealBody = z.object({
  customFields,
  companyId: requiredText("companyId is required."),
  primaryContactId: z.string().optional(),
  serviceId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: requiredText("pipelineStageId is required."),
  value: z.union([z.number(), z.string()]).optional(),
  currency: z.string().optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});
export const UpdateDealBody = z.object({
  customFields,
  primaryContactId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  pipelineStageId: z.string().optional(),
  lostReasonId: z.string().nullable().optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  handoff: z
    .object({
      deliveryOwnerMembershipId: z.string().optional(),
      ownerLater: z.boolean().optional(),
      templateOff: z.boolean().optional(),
      lifecycleOff: z.boolean().optional(),
      startDate: z.string().nullable().optional(),
      scope: z.string().nullable().optional(),
      requirements: z.string().nullable().optional(),
      deliverables: z.array(z.string()).optional(),
      teamMembershipIds: z.array(z.string()).optional(),
    })
    .optional(),
});

// --- Tasks ---------------------------------------------------------------------------------------------------------------------
const TaskStatus = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const TaskPriority = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const ListTasksQuery = z.object({
  status: TaskStatus.optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
  overdueOnly: flag.optional(),
  includeArchived: flag.optional(),
  ...pageQuery,
});
export const CreateTaskBody = z.object({
  title: requiredText("title is required."),
  description: z.string().optional(),
  requirements: z.string().max(5000).optional(),
  assigneeMembershipId: z.string().optional(),
  dueAt: z.string().optional(),
  priority: TaskPriority.optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});
export const UpdateTaskBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  requirements: z.string().max(5000).nullable().optional(),
  assigneeMembershipId: z.string().optional(),
  dueAt: z.string().nullable().optional(),
  priority: TaskPriority.optional(),
  status: TaskStatus.optional(),
});

// --- Activities ----------------------------------------------------------------------------------------------------------------
export const ListActivitiesQuery = z.object({
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
  ...pageQuery,
});
export const CreateActivityBody = z.object({
  type: z.enum(["CALL", "MEETING", "NOTE", "EMAIL", "WHATSAPP", "OTHER"]),
  subject: z.string().optional(),
  description: z.string().optional(),
  occurredAt: z.coerce.date().optional(),
  outcome: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

// --- Responses (the fields a script can rely on; the rest is allowed) ----------------------------------------------------------
export const RecordResponse = z.looseObject({ id: z.string(), organizationId: z.string() });
export const RecordPage = pageOf(RecordResponse);
export const ActivityPage = pageOf(z.looseObject({ id: z.string(), type: z.string() }));

// --- API tokens (management) ---------------------------------------------------------------------------------------------------
export const CreateApiTokenBody = z.object({
  name: z.string({ error: "name is required." }).min(1, "name is required.").max(80),
  scopes: z.array(z.enum(API_SCOPES as [string, ...string[]])).min(1, "Choose at least one scope.").max(20),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export const ApiTokenView = z.strictObject({
  id: z.string(),
  membershipId: z.string(),
  ownerName: z.string().nullable(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]),
});
export const CreatedApiToken = ApiTokenView.extend({ token: z.string().describe("The token. Shown once; store it now.") });
export const ApiTokenList = z.strictObject({ items: z.array(ApiTokenView), scope: z.enum(["own", "organisation"]) });

// --- Webhooks (management) -----------------------------------------------------------------------------------------------------
export const WebhookEventEnum = z.enum(WEBHOOK_EVENT_TYPES);
export const CreateWebhookBody = z.object({
  url: z.string({ error: "url is required." }).min(1, "url is required."),
  events: z.array(WebhookEventEnum).min(1, "Choose at least one event."),
  description: z.string().max(200).nullable().optional(),
});
export const UpdateWebhookBody = z.object({
  url: z.string().min(1).optional(),
  events: z.array(WebhookEventEnum).min(1).optional(),
  description: z.string().max(200).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});
export const WebhookView = z.strictObject({
  id: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  events: z.array(z.string()),
  secretHint: z.string(),
  secretRotatedAt: z.string().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
  consecutiveFailures: z.number().int(),
  lastDeliveryAt: z.string().nullable(),
  createdByMembershipId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const WebhookWithSecret = WebhookView.extend({ secret: z.string().describe("The signing secret. Shown once; store it now.") });
export const WebhookList = z.strictObject({ items: z.array(WebhookView), availableEvents: z.array(z.string()) });
export const WebhookDeliveryList = z.strictObject({
  items: z.array(
    z.strictObject({
      id: z.string(),
      eventId: z.string(),
      eventType: z.string(),
      status: z.enum(["PENDING", "DELIVERED", "DEAD"]),
      attempts: z.number().int(),
      nextAttemptAt: z.string().nullable(),
      lastAttemptAt: z.string().nullable(),
      lastStatusCode: z.number().int().nullable(),
      lastError: z.string().nullable(),
      durationMs: z.number().int().nullable(),
      createdAt: z.string(),
      deliveredAt: z.string().nullable(),
    }),
  ),
});
export const WebhookEventPayload = z.strictObject({
  id: z.string().describe("The event id; identical on every attempt, so a receiver can ignore repeats."),
  type: z.string(),
  createdAt: z.string(),
  organizationId: z.string(),
  data: z.record(z.string(), z.any()),
});
