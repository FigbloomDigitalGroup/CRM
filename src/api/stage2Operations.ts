import { z } from "zod";
import { ListJobsQuerySchema, ListJobsResponseSchema } from "./dto/jobs";
import type { OperationDef } from "./openapi";

/**
 * Stage 2 (M2) endpoints in the OpenAPI document (FIG-1046, B2.17).
 *
 * These routes build their answers in services that already mask, scope and page
 * them, so the schemas here describe the shape clients rely on and stay deliberately
 * loose about fields that vary by role (a role without a section gets no key for it).
 */

const ORG = "/api/orgs/{orgSlug}";
const page = (item: z.ZodType) =>
  z.looseObject({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    pageCount: z.number().int(),
    nextCursor: z.string().nullable(),
  });

const pageQuery = {
  page: z.string().optional(),
  pageSize: z.string().optional(),
  cursor: z.string().optional(),
};

const NotificationSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  deepLink: z.string().nullable(),
  read: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
});

const SearchGroupSchema = page(z.looseObject({ id: z.string(), label: z.string(), sublabel: z.string().nullable(), archived: z.boolean().optional() })).extend({
  type: z.enum(["companies", "contacts", "leads", "deals", "tasks"]),
});

const DataRunSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(["IMPORT", "EXPORT"]),
  entity: z.string(),
  status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"]),
  done: z.boolean(),
  totalRows: z.number().int(),
  processedRows: z.number().int(),
  createdRows: z.number().int(),
  duplicateRows: z.number().int(),
  alreadyConvertedRows: z.number().int(),
  failedRows: z.number().int(),
  hasResultFile: z.boolean(),
  hasErrorReport: z.boolean(),
});

const CommentSchema = z.looseObject({
  id: z.string(),
  authorName: z.string().nullable(),
  body: z.string().nullable(),
  deleted: z.boolean(),
  edited: z.boolean(),
  mentions: z.array(z.string()),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  createdAt: z.string(),
});

const DashboardSectionSchema = z.looseObject({
  key: z.string(),
  title: z.string(),
  scope: z.string(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export const STAGE2_OPERATIONS: OperationDef[] = [
  {
    method: "get",
    path: `${ORG}/dashboard`,
    operationId: "getDashboard",
    summary: "Role home page: the sections this role has, each loaded independently (a section the role lacks is absent)",
    tags: ["Dashboard"],
    response: z.looseObject({
      available: z.array(z.looseObject({ key: z.string(), title: z.string(), scope: z.string() })),
      sections: z.array(DashboardSectionSchema).optional(),
    }),
    errors: [401, 403],
  },
  {
    method: "get",
    path: `${ORG}/dashboard/{section}`,
    operationId: "getDashboardSection",
    summary: "One dashboard section (sales_today, management, delivery, finance, technical, my_metrics)",
    tags: ["Dashboard"],
    response: DashboardSectionSchema,
    errors: [401, 403, 404],
  },
  {
    method: "get",
    path: `${ORG}/signals`,
    operationId: "getSignals",
    summary: "Adoption, stalled deals, deals past close date and overdue tasks (stored values; sections by role)",
    tags: ["Dashboard"],
    response: z.looseObject({ computedAt: z.string() }),
    errors: [401, 403],
  },
  {
    method: "get",
    path: `${ORG}/search`,
    operationId: "search",
    summary: "Global search: groups with totals, paged per group (`type` + `page`), archived only on request, phone numbers in any format",
    tags: ["Search"],
    query: z.object({
      q: z.string(),
      type: z.enum(["companies", "contacts", "leads", "deals", "tasks"]).optional(),
      archived: z.enum(["exclude", "include", "only"]).optional(),
      ...pageQuery,
    }),
    response: z.looseObject({
      query: z.string(),
      tooShort: z.boolean(),
      total: z.number().int(),
      groups: z.array(SearchGroupSchema),
      hidden: z.looseObject({ someResultsHidden: z.boolean() }),
    }),
    errors: [400, 401],
  },
  {
    method: "get",
    path: `${ORG}/notifications`,
    operationId: "listNotifications",
    summary: "Notification centre: paged, filter by type, unread and archived; never reveals a record the caller cannot open",
    tags: ["Notifications"],
    query: z.object({ unreadOnly: z.enum(["true", "false"]).optional(), archived: z.enum(["true", "false"]).optional(), type: z.string().optional(), ...pageQuery }),
    response: page(NotificationSchema).extend({ unreadCount: z.number().int() }),
    errors: [400, 401],
  },
  {
    method: "get",
    path: `${ORG}/notifications/unread-count`,
    operationId: "getUnreadNotificationCount",
    summary: "The bell badge: unread notifications this caller can open",
    tags: ["Notifications"],
    response: z.strictObject({ unreadCount: z.number().int() }),
    errors: [401],
  },
  {
    method: "post",
    path: `${ORG}/notifications/{notificationId}/archive`,
    operationId: "archiveNotification",
    summary: "Archive a notification (DELETE on the same path restores it)",
    tags: ["Notifications"],
    response: z.strictObject({ updated: z.number().int() }),
    errors: [401, 404],
  },
  {
    method: "get",
    path: `${ORG}/data-runs`,
    operationId: "listDataRuns",
    summary: "Imports and exports: your own, or everyone's for Management",
    tags: ["Import and export"],
    query: z.object({ kind: z.enum(["IMPORT", "EXPORT"]).optional(), ...pageQuery }),
    response: page(DataRunSchema),
    errors: [400, 401],
  },
  {
    method: "get",
    path: `${ORG}/data-runs/{runId}`,
    operationId: "getDataRun",
    summary: "Progress, counts and state of one import or export",
    tags: ["Import and export"],
    response: DataRunSchema,
    errors: [401, 404],
  },
  {
    method: "post",
    path: `${ORG}/data-runs/{runId}/cancel`,
    operationId: "cancelDataRun",
    summary: "Stop a running import or export at its next check; rows already imported stay",
    tags: ["Import and export"],
    response: DataRunSchema,
    errors: [401, 404],
  },
  {
    method: "get",
    path: `${ORG}/data-runs/{runId}/download`,
    operationId: "downloadDataRunFile",
    summary: "Short-lived signed link to the export (`which=result`) or the import error report (`which=errors`)",
    tags: ["Import and export"],
    query: z.object({ which: z.enum(["result", "errors"]).optional() }),
    response: z.looseObject({ fileName: z.string(), download: z.looseObject({ url: z.string(), expiresAt: z.string() }) }),
    errors: [401, 404],
  },
  {
    method: "post",
    path: `${ORG}/exports`,
    operationId: "startExport",
    summary: "Start a background export of the full filtered set (over 500 rows needs export.bulk)",
    tags: ["Import and export"],
    body: z.strictObject({ entity: z.enum(["LEAD", "CONTACT", "COMPANY", "DEAL"]), filters: z.record(z.string(), z.unknown()).optional() }),
    response: DataRunSchema,
    errors: [400, 401, 403],
  },
  {
    method: "get",
    path: `${ORG}/leads/{leadId}/comments`,
    operationId: "listLeadComments",
    summary: "Comments on a lead (the same endpoints exist for contacts, companies, deals and tasks)",
    tags: ["Comments"],
    response: z.looseObject({ comments: z.array(CommentSchema), following: z.boolean() }),
    errors: [401, 404],
  },
  {
    method: "post",
    path: `${ORG}/leads/{leadId}/comments`,
    operationId: "addLeadComment",
    summary: "Add a comment; `mentions` are member ids and only people who can open the record may be mentioned",
    tags: ["Comments"],
    body: z.strictObject({ body: z.string().max(5000), mentions: z.array(z.string()).max(20).optional() }),
    response: CommentSchema,
    errors: [400, 401, 404, 409],
    errorNotes: { 409: "The record is archived and read-only." },
  },
  {
    method: "patch",
    path: `${ORG}/comments/{commentId}`,
    operationId: "editComment",
    summary: "Edit your own comment (soft: marked edited; only newly mentioned people are notified)",
    tags: ["Comments"],
    body: z.strictObject({ body: z.string().max(5000), mentions: z.array(z.string()).max(20).optional() }),
    response: CommentSchema,
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: "get",
    path: `${ORG}/jobs`,
    operationId: "listJobs",
    summary: "Background jobs for this organisation with counts per status (Management)",
    tags: ["Jobs"],
    query: ListJobsQuerySchema,
    response: ListJobsResponseSchema,
    errors: [400, 401, 403],
  },
];
