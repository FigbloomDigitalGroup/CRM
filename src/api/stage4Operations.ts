import { z } from "zod";
import type { OperationDef } from "./openapi";

/**
 * Stage 4 (M4) endpoints in the OpenAPI document (FIG-1067, B4.10): settings and integrations, the audit log, automations, reference
 * data admin, data migration, data and privacy, offline sync, push and the PWA, and quick capture.
 *
 * Almost all of these are Management only; the response schemas describe the shape clients rely on and stay loose about fields that
 * vary by role or by kind of record. Errors use the one envelope. Lists use the standard page shape.
 */

const ORG = "/api/orgs/{orgSlug}";
const pageQuery = { page: z.string().optional(), pageSize: z.string().optional(), cursor: z.string().optional() };
const page = (item: z.ZodType = z.looseObject({})) =>
  z.looseObject({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), pageCount: z.number().int(), nextCursor: z.string().nullable() });
const obj = z.looseObject({});
const items = z.looseObject({ items: z.array(obj) });
const csv = z.string().describe("text/csv");

type Errors = OperationDef["errors"];
const base: Errors = [401, 403];

function op(
  method: OperationDef["method"],
  path: string,
  operationId: string,
  summary: string,
  tag: string,
  extra: { query?: z.ZodObject; body?: z.ZodType; response?: z.ZodType; errors?: Errors; idempotent?: boolean; successStatus?: number } = {},
): OperationDef {
  return {
    method,
    path: `${ORG}${path}`,
    operationId,
    summary,
    tags: [tag],
    query: extra.query,
    body: extra.body,
    response: extra.response ?? obj,
    errors: extra.errors ?? (extra.body ? [400, 401, 403, 404] : [401, 403, 404]),
    idempotent: extra.idempotent,
    successStatus: extra.successStatus,
  };
}

const sessionResponse = z.looseObject({ id: z.string(), entity: z.string(), status: z.string(), step: z.string(), counts: obj, rollback: obj });

export const STAGE4_OPERATIONS: OperationDef[] = [
  // --- Settings backend and integrations (FIG-1058, FIG-1060)
  op("get", "/settings/overview", "getSettingsOverview", "Settings landing page: profile, member counts by state, integration states (Management)", "Settings", { response: z.looseObject({ profile: obj, members: obj, integrations: obj }), errors: base }),
  op("get", "/integrations", "listIntegrations", "Integrations registry: Connected, Not connected or Planned, each derived from real signals (Management)", "Integrations", { response: z.looseObject({ integrations: z.array(obj), counts: obj }), errors: base }),
  op("get", "/integrations/whatsapp", "getWhatsAppConfig", "Click-to-chat configuration: organisation number, default message, templates (Management)", "Integrations", { errors: base }),
  op("put", "/integrations/whatsapp", "updateWhatsAppConfig", "Set the WhatsApp number (any local form) and the message templates used by wa.me links", "Integrations", { body: z.strictObject({ number: z.string().nullable().optional(), defaultMessage: z.string().optional(), templates: z.array(z.strictObject({ key: z.string().optional(), label: z.string(), body: z.string() })).optional() }), errors: [400, 401, 403] }),
  op("get", "/integrations/website-key/rejected", "listRejectedWebsiteSubmissions", "Website submissions that were turned away, with the reason in plain words (Management)", "Integrations", { query: z.object({ outcome: z.string().optional(), ...pageQuery }), response: page(), errors: [400, 401, 403] }),

  // --- Audit log (FIG-799)
  op("get", "/audit/events", "listAuditLog", "Organisation-wide audit log: filter by actor, entity type, action (prefix with *) and dates; each row links to its record; payment entities only for readers who may see payments (audit.view)", "Audit", { query: z.object({ actorMembershipId: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), action: z.string().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional(), ...pageQuery }), response: page(), errors: [400, 401, 403] }),
  op("get", "/audit/events/export", "exportAuditLog", "The audit events the filters show, as CSV. Exporting the log is itself audited.", "Audit", { query: z.object({ actorMembershipId: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), action: z.string().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional() }), response: csv, errors: [400, 401, 403] }),
  op("get", "/audit/filters", "getAuditLogFilters", "What the filter controls offer: entity types, actions, the people who acted", "Audit", { errors: base }),

  // --- Automations (FIG-1059)
  op("get", "/automations", "listAutomationRules", "The automation rules with switch, thresholds, audience and the last seven days of runs. Rules assign, remind and notify; they never decide. (Management)", "Automations", { response: z.looseObject({ items: z.array(obj), boundary: z.string() }), errors: base }),
  op("get", "/automations/runs", "listAutomationRuns", "The run log: each run with its rule, record and result", "Automations", { query: z.object({ ruleKey: z.string().optional(), status: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional(), dateFrom: z.string().optional(), dateTo: z.string().optional(), ...pageQuery }), response: page(), errors: [400, 401, 403] }),
  op("get", "/automations/{ruleKey}", "getAutomationRule", "One rule", "Automations", { errors: base.concat(404) as Errors }),
  op("patch", "/automations/{ruleKey}", "updateAutomationRule", "Switch a rule on or off, change its thresholds or audience. Audited with before and after.", "Automations", { body: z.strictObject({ enabled: z.boolean().optional(), params: z.record(z.string(), z.union([z.number(), z.string()])).optional(), audience: z.enum(["OWNER", "OWNER_AND_MANAGEMENT"]).optional() }) }),

  // --- Reference data admin (FIG-1063)
  op("get", "/reference-admin", "listReferenceKinds", "The reference lists the caller may manage and what each allows", "Reference data", { response: items, errors: base }),
  op("get", "/reference-admin/{kind}", "listReferenceValues", "Every value of one list, hidden ones included, with its usage count", "Reference data", { response: items }),
  op("post", "/reference-admin/{kind}", "createReferenceValue", "Add a value. Extras depend on the list (category, colour, subject and body, entityType and key).", "Reference data", { body: z.looseObject({ name: z.string() }), idempotent: true }),
  op("get", "/reference-admin/{kind}/{valueId}", "getReferenceValueUsage", "How many records use a value and what holds them", "Reference data", {}),
  op("patch", "/reference-admin/{kind}/{valueId}", "updateReferenceValue", "Rename and/or hide or unhide. A hidden value stays on its records and leaves the pickers.", "Reference data", { body: z.strictObject({ name: z.string().optional(), hidden: z.boolean().optional() }) }),
  op("delete", "/reference-admin/{kind}/{valueId}", "deleteReferenceValue", "Delete an unused value. A used one is refused with the usage and the advice to hide it.", "Reference data", {}),
  op("post", "/reference-admin/{kind}/{valueId}/reorder", "reorderReferenceValue", "Move a value up or down", "Reference data", { body: z.strictObject({ direction: z.enum(["up", "down"]) }), response: items }),
  op("post", "/reference-admin/{kind}/{valueId}/merge", "mergeReferenceValues", "Merge this value into another: everything re-points, this one is removed, audited", "Reference data", { body: z.strictObject({ intoId: z.string() }), idempotent: true }),

  // --- Data migration (FIG-1061, FIG-800)
  op("get", "/data-migration", "listMigrationEntities", "What can be migrated, each kind's fields, the seven steps", "Data migration", { errors: base }),
  op("get", "/data-migration/templates/{entity}", "getMigrationTemplate", "The fixed CSV template for one kind of record", "Data migration", { response: csv, errors: [400, 401, 403] }),
  op("get", "/data-migration/sessions", "listMigrationSessions", "Migration sessions, newest first", "Data migration", { query: z.object({ entity: z.string().optional(), status: z.string().optional(), ...pageQuery }), response: page(sessionResponse), errors: base }),
  op("post", "/data-migration/sessions", "createMigrationSession", "Step 1: start a session for one kind of record", "Data migration", { body: z.strictObject({ entity: z.string(), sourceKind: z.enum(["TEMPLATE", "GENERIC"]).optional(), presetId: z.string().optional(), duplicatePolicy: z.enum(["SKIP", "UPDATE", "CREATE"]).optional(), createMissingCompanies: z.boolean().optional() }), response: sessionResponse, idempotent: true }),
  op("get", "/data-migration/sessions/{sessionId}", "getMigrationSession", "One session: status, step, counts, progress, dry run, rollback window", "Data migration", { response: sessionResponse }),
  op("post", "/data-migration/sessions/{sessionId}/file", "uploadMigrationFile", "Step 2: upload a CSV or .xlsx (multipart `file`, or the raw body with ?fileName=). Answers with headers, row count, suggested mapping.", "Data migration", { response: z.looseObject({ session: sessionResponse, suggestedMapping: obj }), errors: [400, 401, 403, 404] }),
  op("put", "/data-migration/sessions/{sessionId}/mapping", "setMigrationMapping", "Step 3: map fields to columns, map values (statuses, sources, services, owners by email), choose the duplicate policy", "Data migration", { body: z.strictObject({ mapping: z.record(z.string(), z.string()).optional(), valueMappings: z.record(z.string(), z.record(z.string(), z.string())).optional(), duplicatePolicy: z.enum(["SKIP", "UPDATE", "CREATE"]).optional(), createMissingCompanies: z.boolean().optional(), savePresetAs: z.string().optional(), presetId: z.string().nullable().optional() }), response: sessionResponse }),
  op("post", "/data-migration/sessions/{sessionId}/validate", "validateMigration", "Step 4: read every row and record per-row errors and warnings (background job)", "Data migration", { response: sessionResponse, errors: [400, 401, 403, 404] }),
  op("post", "/data-migration/sessions/{sessionId}/dry-run", "dryRunMigration", "Step 5: decide what the import would create, update and skip, with a sample. Writes nothing.", "Data migration", { response: sessionResponse, errors: [400, 401, 403, 404] }),
  op("post", "/data-migration/sessions/{sessionId}/import", "startMigrationImport", "Step 6: import (needs a finished dry run and confirm: true). Every row created carries the session id.", "Data migration", { body: z.strictObject({ confirm: z.boolean().optional() }), response: sessionResponse, idempotent: true, errors: [400, 401, 403, 404] }),
  op("post", "/data-migration/sessions/{sessionId}/cancel", "cancelMigration", "Stop at the next chunk. Rows already written stay and can be rolled back.", "Data migration", { response: sessionResponse }),
  op("post", "/data-migration/sessions/{sessionId}/rollback", "rollbackMigration", "Step 7: undo the whole session within its window; records changed or relied on since are kept, with the reason", "Data migration", { response: sessionResponse, errors: [400, 401, 403, 404] }),
  op("get", "/data-migration/sessions/{sessionId}/issues", "listMigrationIssues", "Per-row errors, warnings and duplicates, paged", "Data migration", { query: z.object({ phase: z.string().optional(), severity: z.string().optional(), ...pageQuery }), response: page(), errors: [400, 401, 403, 404] }),
  op("get", "/data-migration/sessions/{sessionId}/errors", "getMigrationErrorReport", "The error report as CSV: problem rows beside their original values", "Data migration", { query: z.object({ phase: z.string().optional() }), response: csv }),
  op("get", "/data-migration/presets", "listMigrationPresets", "Saved mappings", "Data migration", { query: z.object({ entity: z.string().optional() }), response: items, errors: [400, 401, 403] }),
  op("post", "/data-migration/presets", "saveMigrationPreset", "Save a mapping under a name (same name updates it)", "Data migration", { body: z.strictObject({ name: z.string(), entity: z.string(), mapping: z.record(z.string(), z.string()), valueMappings: z.record(z.string(), z.record(z.string(), z.string())).optional() }), errors: [400, 401, 403] }),
  op("delete", "/data-migration/presets/{presetId}", "deleteMigrationPreset", "Delete a saved mapping", "Data migration", {}),

  // --- Data and privacy (FIG-1062)
  op("get", "/privacy", "getPrivacyOverview", "Export rights, retention with documented defaults, legal hold, open requests (Management)", "Data and privacy", { errors: base }),
  op("put", "/privacy/export-rights", "updateExportRights", "Who may bulk export, the row threshold that needs approval (default 500), how long an approval lasts", "Data and privacy", { body: z.strictObject({ allowedRoleKeys: z.array(z.string()).optional(), approvalThreshold: z.number().optional(), approvalExpiryHours: z.number().optional() }), errors: [400, 401, 403] }),
  op("put", "/privacy/retention", "updateRetention", "A retention period per kind of data: a number, null to keep, or \"DEFAULT\"", "Data and privacy", { body: z.record(z.string(), z.union([z.number(), z.null(), z.literal("DEFAULT")])), errors: [400, 401, 403] }),
  op("put", "/privacy/legal-hold", "setLegalHold", "Place (with a reason) or release the legal hold. While on, nothing is purged and nobody can be erased.", "Data and privacy", { body: z.strictObject({ active: z.boolean(), reason: z.string().optional() }), errors: [400, 401, 403] }),
  op("get", "/privacy/export-approvals", "listExportApprovals", "Export approval requests (Management sees all; others their own)", "Data and privacy", { query: z.object({ status: z.string().optional(), ...pageQuery }), response: page(), errors: [401, 403] }),
  op("post", "/privacy/export-approvals", "requestExportApproval", "Ask Management to approve one bulk export above the threshold", "Data and privacy", { body: z.strictObject({ entity: z.string(), filters: z.record(z.string(), z.unknown()).optional(), reason: z.string().optional() }), idempotent: true, errors: [400, 401, 403] }),
  op("post", "/privacy/export-approvals/{approvalId}/decision", "decideExportApproval", "Approve or reject (someone other than the requester)", "Data and privacy", { body: z.strictObject({ approve: z.boolean(), note: z.string().optional() }) }),
  op("get", "/privacy/requests", "listDataSubjectRequests", "Data-subject requests with status, due date and overdue flag", "Data and privacy", { query: z.object({ status: z.string().optional(), kind: z.string().optional(), overdue: z.enum(["true", "false"]).optional(), ...pageQuery }), response: page(), errors: [401, 403] }),
  op("post", "/privacy/requests", "createDataSubjectRequest", "File an access, rectification or erasure request for a contact (due in 30 days by default)", "Data and privacy", { body: z.strictObject({ kind: z.enum(["ACCESS", "RECTIFICATION", "ERASURE"]), contactId: z.string(), evidenceNotes: z.string().optional(), dueOn: z.string().optional() }), idempotent: true }),
  op("get", "/privacy/requests/{requestId}", "getDataSubjectRequest", "One request", "Data and privacy", {}),
  op("post", "/privacy/requests/{requestId}/evidence", "addEvidenceNote", "Add a timestamped evidence note", "Data and privacy", { body: z.strictObject({ note: z.string() }) }),
  op("post", "/privacy/requests/{requestId}/reject", "rejectDataSubjectRequest", "Reject a request, with the reason", "Data and privacy", { body: z.strictObject({ reason: z.string() }) }),
  op("post", "/privacy/requests/{requestId}/rectify", "rectifyDataSubject", "Apply corrections to the person's record and complete the request", "Data and privacy", { body: z.looseObject({}) }),
  op("post", "/privacy/requests/{requestId}/fulfil-access", "fulfilAccessRequest", "Collect everything held about the person into one CSV and answer with a short-lived download link", "Data and privacy", { errors: [400, 401, 403, 404] }),
  op("post", "/privacy/requests/{requestId}/confirm-erasure", "confirmErasure", "Two different Management members confirm; the second erases. Stopped by a legal hold.", "Data and privacy", { errors: [400, 401, 403, 404] }),
  op("get", "/privacy/requests/{requestId}/download", "getAccessDownload", "A fresh download link for a completed access request (audited)", "Data and privacy", {}),
  op("get", "/privacy/organisation-requests", "listOrganisationDataRequests", "Requests to export or delete the whole organisation, with the platform team", "Data and privacy", { response: items, errors: base }),
  op("post", "/privacy/organisation-requests", "submitOrganisationDataRequest", "Ask for the whole organisation's data to be exported or the organisation deleted (handed to the platform queue)", "Data and privacy", { body: z.strictObject({ kind: z.enum(["EXPORT", "DELETE"]), note: z.string().optional() }), errors: [400, 401, 403] }),

  // --- Offline sync, push, PWA (FIG-1064) and quick capture (FIG-1065)
  op("post", "/sync/batch", "applySyncBatch", "The offline queue: up to 100 actions, each with a client id; answered APPLIED, DUPLICATE, CONFLICT or REJECTED per item. Replaying a batch changes nothing. Stage and ownership are server-wins.", "Sync", { body: z.strictObject({ mutations: z.array(z.looseObject({ clientId: z.string(), kind: z.string(), payload: obj.optional(), clientCreatedAt: z.string().optional() })) }), response: z.looseObject({ results: z.array(obj), counts: obj, processedOrder: z.array(z.number().int()) }), errors: [400, 401, 403] }),
  op("get", "/sync/status", "getSyncStatus", "The caller's queue as the server sees it: last sync, last seven days, what needs attention", "Sync", { errors: [401] }),
  op("get", "/push/config", "getPushConfig", "Whether Web Push is on for this server, and the public key to subscribe with", "Push", { errors: [401] }),
  op("get", "/push/subscriptions", "listMyPushSubscriptions", "The caller's registered devices", "Push", { errors: [401] }),
  op("post", "/push/subscriptions", "registerPushSubscription", "Register this browser or phone for push (endpoint must be on a real push service, over https)", "Push", { body: z.strictObject({ endpoint: z.string(), keys: z.strictObject({ p256dh: z.string(), auth: z.string() }), userAgent: z.string().optional() }), errors: [400, 401] }),
  op("delete", "/push/subscriptions/{subscriptionId}", "removeMyPushSubscription", "Stop sending push to one of the caller's own devices", "Push", { errors: [401, 404] }),
  op("get", "/pwa/manifest", "getPwaManifest", "The web app manifest for this organisation (its name and colours)", "PWA", { errors: [401] }),
  op("get", "/pwa/version", "getPwaVersion", "The cache version an installed app compares with its own, and what may be queued offline", "PWA", { errors: [401] }),
  op("post", "/quick-capture", "quickCapture", "Capture a lead in seconds. A likely duplicate answers 200 DUPLICATE_WARNING and creates nothing; resend with duplicateDecision to open the existing record, create anyway or merge.", "Quick capture", { body: z.strictObject({ name: z.string(), phone: z.string().optional(), email: z.string().optional(), company: z.string().optional(), serviceId: z.string().optional(), sourceId: z.string().optional(), note: z.string().optional(), followUp: z.strictObject({ title: z.string(), dueOn: z.string().optional() }).optional(), duplicateDecision: z.enum(["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"]).optional(), duplicateId: z.string().optional() }), idempotent: true, errors: [400, 401, 403, 404] }),
];
