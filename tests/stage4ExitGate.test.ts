/**
 * Stage 4 exit gate (FIG-1067, B4.10): admin, automation, data and sync verified by API, authorisation and RLS tests, with a demo.
 *
 *   1. the demo walk: the story in docs/demo/stage-4.http, through the real route handlers as each role;
 *   2. the permission matrix: who may call what, and what an explained refusal looks like;
 *   3. tenant isolation for every table Stage 4 added;
 *   4. the job framework: the new jobs are registered, safe to repeat, and fail the way the framework expects;
 *   5. every documented operation has a route that answers it.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";
import { createCompanyRow } from "./helpers/stage3";
import { csv, drain, emailOf } from "./helpers/migration";

// Route handlers resolve the caller from the session cookie; these tests drive the real handlers as whoever `current.ctx` says.
const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) {
      const { UnauthorizedError } = await import("../src/auth/errors");
      throw new UnauthorizedError();
    }
    return current.ctx;
  },
}));

import { buildOpenApiDocument } from "../src/api/openapi";
import { STAGE4_OPERATIONS } from "../src/api/stage4Operations";
import { listJobDefinitions } from "../src/jobs/registry";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { setPushTransport } from "../src/notifications/webPush";
import { notifyEvent } from "../src/services/notificationService";
import { updateMyNotificationPreferencesV2 } from "../src/services/notificationPreferenceService";
import { runRetentionSweep } from "../src/services/privacyService";
import * as automationRuns from "../src/app/api/orgs/[orgSlug]/automations/runs/route";
import * as automationsRoute from "../src/app/api/orgs/[orgSlug]/automations/route";
import * as automationOne from "../src/app/api/orgs/[orgSlug]/automations/[ruleKey]/route";
import * as auditEvents from "../src/app/api/orgs/[orgSlug]/audit/events/route";
import * as auditExport from "../src/app/api/orgs/[orgSlug]/audit/events/export/route";
import * as integrations from "../src/app/api/orgs/[orgSlug]/integrations/route";
import * as websiteKey from "../src/app/api/orgs/[orgSlug]/integrations/website-key/route";
import * as rejected from "../src/app/api/orgs/[orgSlug]/integrations/website-key/rejected/route";
import * as whatsapp from "../src/app/api/orgs/[orgSlug]/integrations/whatsapp/route";
import * as migrationHome from "../src/app/api/orgs/[orgSlug]/data-migration/route";
import * as migrationTemplate from "../src/app/api/orgs/[orgSlug]/data-migration/templates/[entity]/route";
import * as migrationSessions from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/route";
import * as migrationSession from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/route";
import * as migrationFile from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/file/route";
import * as migrationMapping from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/mapping/route";
import * as migrationValidate from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/validate/route";
import * as migrationDry from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/dry-run/route";
import * as migrationImport from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/import/route";
import * as migrationRollback from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/rollback/route";
import * as migrationIssues from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/issues/route";
import * as migrationErrors from "../src/app/api/orgs/[orgSlug]/data-migration/sessions/[sessionId]/errors/route";
import * as privacyHome from "../src/app/api/orgs/[orgSlug]/privacy/route";
import * as privacyLegalHold from "../src/app/api/orgs/[orgSlug]/privacy/legal-hold/route";
import * as privacyRequests from "../src/app/api/orgs/[orgSlug]/privacy/requests/route";
import * as privacyConfirm from "../src/app/api/orgs/[orgSlug]/privacy/requests/[requestId]/confirm-erasure/route";
import * as privacyAccess from "../src/app/api/orgs/[orgSlug]/privacy/requests/[requestId]/fulfil-access/route";
import * as referenceAdminList from "../src/app/api/orgs/[orgSlug]/reference-admin/[kind]/route";
import * as referenceAdminOne from "../src/app/api/orgs/[orgSlug]/reference-admin/[kind]/[valueId]/route";
import * as settingsOverview from "../src/app/api/orgs/[orgSlug]/settings/overview/route";
import * as syncBatch from "../src/app/api/orgs/[orgSlug]/sync/batch/route";
import * as syncStatus from "../src/app/api/orgs/[orgSlug]/sync/status/route";
import * as pushConfig from "../src/app/api/orgs/[orgSlug]/push/config/route";
import * as pushSubscriptions from "../src/app/api/orgs/[orgSlug]/push/subscriptions/route";
import * as pwaManifest from "../src/app/api/orgs/[orgSlug]/pwa/manifest/route";
import * as pwaVersion from "../src/app/api/orgs/[orgSlug]/pwa/version/route";
import * as quickCaptureRoute from "../src/app/api/orgs/[orgSlug]/quick-capture/route";

const BASE = "http://localhost/api/orgs/x";
type Handler = (request: Request, context: { params: Promise<any> }) => Promise<Response>;

async function call(ctx: AuthContext | null, handler: Handler, path: string, options: { method?: string; body?: unknown; raw?: BodyInit; key?: string; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  current.ctx = ctx;
  const method = options.method ?? (options.body !== undefined || options.raw !== undefined ? "POST" : "GET");
  const res = await handler(
    new Request(`${BASE}${path}`, {
      method,
      headers: { ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...(options.key ? { "idempotency-key": options.key } : {}), ...(options.headers ?? {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : options.raw !== undefined ? { body: options.raw } : {}),
    }),
    { params: Promise.resolve({ orgSlug: "x", ...(options.params ?? {}) }) },
  );
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

async function world() {
  const org = await createTestOrganization("Stage4Gate");
  const management = await createTestContext(org.id, "MANAGEMENT", "g4.mgmt");
  const management2 = await createTestContext(org.id, "MANAGEMENT", "g4.mgmt2");
  const sales = await createTestContext(org.id, "SALES", "g4.sales");
  const delivery = await createTestContext(org.id, "DELIVERY", "g4.delivery");
  const finance = await createTestContext(org.id, "FINANCE", "g4.finance");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "g4.tech");
  return { org, management, management2, sales, delivery, finance, technical, salesEmail: await emailOf(sales) };
}

beforeEach(() => {
  current.ctx = null;
  setPushTransport(null);
});

describe("the demo walk (docs/demo/stage-4.http)", () => {
  it("settings, automations, reference data, a migration with a bad row, a data-subject erasure, an offline replay and a push", async () => {
    const w = await world();
    const { management, management2, sales } = w;

    // 1. Settings: the overview, then rotate the website key with a grace window; the old key keeps working for it.
    const overview = await call(management, settingsOverview.GET as Handler, "/settings/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.integrations.counts).toMatchObject({ PLANNED: 4 });
    const first = await call(management, websiteKey.POST as Handler, "/integrations/website-key", { method: "POST" });
    const second = await call(management, websiteKey.POST as Handler, "/integrations/website-key", { body: { graceHours: 6 } });
    expect(second.status).toBe(200);
    expect(second.body.previousKeyValidUntil).toBeTruthy();
    const status = await call(management, websiteKey.GET as Handler, "/integrations/website-key");
    expect(status.body.previousKey.keyPrefix).toBe(first.body.keyPrefix);

    // 2. Click-to-chat and the rejected list.
    expect((await call(management, whatsapp.PUT as Handler, "/integrations/whatsapp", { method: "PUT", body: { number: "0700 123 456", defaultMessage: "Hello {{name}}" } })).body.number).toBe("254700123456");
    expect((await call(management, rejected.GET as Handler, "/integrations/website-key/rejected")).body.total).toBe(0);

    // 3. Automations: switch the follow-up task off; a website lead is then assigned but gets no task.
    expect((await call(management, automationsRoute.GET as Handler, "/automations")).body.items).toHaveLength(8);
    const toggled = await call(management, automationOne.PATCH as Handler, "/automations/NEW_LEAD_FOLLOW_UP_TASK", { method: "PATCH", body: { enabled: false }, params: { ruleKey: "NEW_LEAD_FOLLOW_UP_TASK" } });
    expect(toggled.body.enabled).toBe(false);
    const lead = await (await import("../src/repositories/leadIngestion")).ingestWebsiteLead(w.org.id, { name: "Gate Lead", email: "gate@example.test" });
    expect(lead.ownerMembershipId).not.toBeNull();
    expect(await adminDb.task.count({ where: { organizationId: w.org.id, leadId: lead.leadId } })).toBe(0);
    const runs = await call(management, automationRuns.GET as Handler, "/automations/runs?ruleKey=WEBSITE_LEAD_ASSIGNMENT");
    expect(runs.body.total).toBe(1);

    // 4. Reference data: hide a service that is in use; delete is refused with the usage; it is gone from the picker.
    const services = await call(management, referenceAdminList.GET as Handler, "/reference-admin/services", { params: { kind: "services" } });
    const cctv = services.body.items.find((s: { key: string }) => s.key === "CCTV");
    await adminDb.lead.create({ data: { organizationId: w.org.id, leadStatusId: await getLeadStatusId(w.org.id), serviceInterestId: cctv.id } });
    const refused = await call(management, referenceAdminOne.DELETE as Handler, `/reference-admin/services/${cctv.id}`, { method: "DELETE", params: { kind: "services", valueId: cctv.id } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/in use \(1 leads/);
    const hidden = await call(management, referenceAdminOne.PATCH as Handler, `/reference-admin/services/${cctv.id}`, { method: "PATCH", body: { hidden: true }, params: { kind: "services", valueId: cctv.id } });
    expect(hidden.body).toMatchObject({ hidden: true, usageCount: 4 });

    // 5. Data migration with a bad row: upload, map, validate, dry run, import, then roll back.
    const created = await call(management, migrationSessions.POST as Handler, "/data-migration/sessions", { body: { entity: "COMPANY" } });
    const sessionId = created.body.id as string;
    const sp = { sessionId };
    const upload = await call(management, migrationFile.POST as Handler, `/data-migration/sessions/${sessionId}/file?fileName=companies.csv`, { raw: new Uint8Array(csv([{ name: "Gate One", email: "one@x.test" }, { name: "Gate Bad", email: "nope" }, { name: "Gate Two", email: "two@x.test" }])), headers: { "content-type": "text/csv" }, params: sp });
    expect(upload.body.session.file.rows).toBe(3);
    await call(management, migrationMapping.PUT as Handler, `/data-migration/sessions/${sessionId}/mapping`, { method: "PUT", body: { mapping: upload.body.suggestedMapping }, params: sp });
    await call(management, migrationValidate.POST as Handler, `/data-migration/sessions/${sessionId}/validate`, { method: "POST", params: sp });
    await drain(w.org.id);
    expect((await call(management, migrationSession.GET as Handler, `/data-migration/sessions/${sessionId}`, { params: sp })).body.counts).toMatchObject({ valid: 2, errors: 1 });
    await call(management, migrationDry.POST as Handler, `/data-migration/sessions/${sessionId}/dry-run`, { method: "POST", params: sp });
    await drain(w.org.id);
    expect((await call(management, migrationImport.POST as Handler, `/data-migration/sessions/${sessionId}/import`, { body: {}, params: sp })).status).toBe(400);
    expect((await call(management, migrationImport.POST as Handler, `/data-migration/sessions/${sessionId}/import`, { body: { confirm: true }, params: sp })).status).toBe(200);
    await drain(w.org.id);
    const imported = (await call(management, migrationSession.GET as Handler, `/data-migration/sessions/${sessionId}`, { params: sp })).body;
    expect(imported).toMatchObject({ status: "COMPLETED_WITH_ERRORS", counts: { created: 2, errors: 1 } });
    const errorsCsv = await call(management, migrationErrors.GET as Handler, `/data-migration/sessions/${sessionId}/errors`, { params: sp });
    expect(errorsCsv.text).toContain("Gate Bad,nope");
    expect((await call(management, migrationIssues.GET as Handler, `/data-migration/sessions/${sessionId}/issues?severity=ERROR`, { params: sp })).body.total).toBeGreaterThan(0);
    await call(management, migrationRollback.POST as Handler, `/data-migration/sessions/${sessionId}/rollback`, { method: "POST", params: sp });
    await drain(w.org.id);
    expect((await call(management, migrationSession.GET as Handler, `/data-migration/sessions/${sessionId}`, { params: sp })).body.status).toBe("ROLLED_BACK");
    expect(await adminDb.company.count({ where: { organizationId: w.org.id, name: { startsWith: "Gate " } } })).toBe(0);

    // 6. Data and privacy: file an erasure, two Management members confirm, the person is gone.
    const company = await createCompanyRow(w.org.id, { name: "Gate Employer" });
    const contact = await adminDb.contact.create({ data: { organizationId: w.org.id, companyId: company.id, firstName: "Gate", lastName: "Person", email: "gate.person@example.test" } });
    const filed = await call(management, privacyRequests.POST as Handler, "/privacy/requests", { body: { kind: "ERASURE", contactId: contact.id } });
    expect(filed.status).toBe(200);
    const rid = { requestId: filed.body.id as string };
    expect((await call(management, privacyConfirm.POST as Handler, "/x", { method: "POST", params: rid })).body.status).toBe("AWAITING_SECOND_CONFIRMATION");
    expect((await call(management, privacyConfirm.POST as Handler, "/x", { method: "POST", params: rid })).status).toBe(400);
    expect((await call(management2, privacyConfirm.POST as Handler, "/x", { method: "POST", params: rid })).body).toMatchObject({ status: "COMPLETED", subject: { label: "[erased]" } });
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(0);
    expect((await call(management, privacyHome.GET as Handler, "/privacy")).body.requests.open).toBe(0);

    // 7. Offline sync: the same batch twice changes nothing; a quick capture duplicate becomes a conflict.
    const batch = { mutations: [{ clientId: `gate-${randomUUID()}`, kind: "QUICK_CAPTURE", payload: { name: "Offline Person", phone: "0712 345 678" } }, { clientId: `gate-${randomUUID()}`, kind: "TASK_CREATE", payload: { title: "Offline task" } }] };
    const one = await call(sales, syncBatch.POST as Handler, "/sync/batch", { body: batch });
    expect(one.body.counts).toEqual({ applied: 2, duplicate: 0, conflict: 0, rejected: 0 });
    const two = await call(sales, syncBatch.POST as Handler, "/sync/batch", { body: batch });
    expect(two.body.counts).toEqual({ applied: 0, duplicate: 2, conflict: 0, rejected: 0 });
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id, contact: { firstName: "Offline" } } })).toBe(1);
    const dup = await call(sales, quickCaptureRoute.POST as Handler, "/quick-capture", { body: { name: "Offline Person", phone: "0712 345 678" } });
    expect(dup.body.status).toBe("DUPLICATE_WARNING");
    expect((await call(sales, syncStatus.GET as Handler, "/sync/status")).body.lastSevenDays.applied).toBe(2);

    // 8. Push: register a device, switch push on for a type, and a notification goes out.
    const sent: string[] = [];
    setPushTransport({ async send(sub) { sent.push(sub.endpoint); return { statusCode: 201 }; } });
    expect((await call(sales, pushConfig.GET as Handler, "/push/config")).body.configured).toBe(true);
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
    expect((await call(sales, pushSubscriptions.POST as Handler, "/push/subscriptions", { body: { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys } })).status).toBe(200);
    await updateMyNotificationPreferencesV2(sales, { types: { MENTION: { push: true } } });
    await notifyEvent({ organizationId: w.org.id, membershipId: sales.membershipId, type: "MENTION", title: "Gate", body: "Hello", entityType: "Comment", entityId: "c1", path: "/o/x" });
    expect(sent).toHaveLength(1);
    expect((await call(sales, pwaManifest.GET as Handler, "/pwa/manifest")).body.display).toBe("standalone");
    expect((await call(sales, pwaVersion.GET as Handler, "/pwa/version")).body.cacheVersion).toMatch(/^[0-9a-f]{16}$/);

    // 9. The audit log shows it all, to Management only.
    const audit = await call(management, auditEvents.GET as Handler, "/audit/events?pageSize=100");
    const actions = new Set(audit.body.items.map((e: { action: string }) => e.action));
    for (const expected of ["website_api_key.regenerated", "integration.whatsapp_updated", "automation_rule.updated", "reference_value.hidden".replace("reference_value.hidden", "reference_catalog.deactivated"), "data_migration.imported", "data_migration.rolled_back", "data_subject.erased"]) expect(actions, expected).toContain(expected);
    expect((await call(management, auditExport.GET as Handler, "/audit/events/export")).text).toContain("data_migration.imported");
    expect((await call(sales, auditEvents.GET as Handler, "/audit/events")).status).toBe(403);
  }, 300_000);
});

describe("the permission matrix", () => {
  it("Management-only routes refuse every other role with an explained 403, and the signed-out with 401", async () => {
    const w = await world();
    const managementOnly: [string, Handler, string, Record<string, string>?][] = [
      ["settings overview", settingsOverview.GET as Handler, "/settings/overview"],
      ["integrations", integrations.GET as Handler, "/integrations"],
      ["website key", websiteKey.GET as Handler, "/integrations/website-key"],
      ["whatsapp", whatsapp.GET as Handler, "/integrations/whatsapp"],
      ["audit log", auditEvents.GET as Handler, "/audit/events"],
      ["automations", automationsRoute.GET as Handler, "/automations"],
      ["automation runs", automationRuns.GET as Handler, "/automations/runs"],
      ["reference list", referenceAdminList.GET as Handler, "/reference-admin/services", { kind: "services" }],
      ["migration home", migrationHome.GET as Handler, "/data-migration"],
      ["migration sessions", migrationSessions.GET as Handler, "/data-migration/sessions"],
      ["migration template", migrationTemplate.GET as Handler, "/data-migration/templates/company", { entity: "company" }],
      ["privacy", privacyHome.GET as Handler, "/privacy"],
      ["privacy requests", privacyRequests.GET as Handler, "/privacy/requests"],
    ];
    for (const ctx of [w.sales, w.delivery, w.finance, w.technical]) {
      for (const [label, handler, path, params] of managementOnly) {
        const res = await call(ctx, handler, path, { params });
        expect(res.status, `${ctx.roleKey} ${label}`).toBe(403);
        expect(res.body.error ?? res.body.message, `${ctx.roleKey} ${label}`).toBeTruthy();
      }
    }
    for (const [label, handler, path, params] of managementOnly) {
      const res = await call(w.management, handler, path, { params });
      expect(res.status, `management ${label}`).toBe(200);
      expect((await call(null, handler, path, { params })).status, `signed out ${label}`).toBe(401);
    }
    // Writes: a mapping, a legal hold, a rule.
    expect((await call(w.sales, privacyLegalHold.PUT as Handler, "/privacy/legal-hold", { method: "PUT", body: { active: true, reason: "x" } })).status).toBe(403);
    expect((await call(w.sales, automationOne.PATCH as Handler, "/automations/STALLED_DEAL_ALERT", { method: "PATCH", body: { enabled: false }, params: { ruleKey: "STALLED_DEAL_ALERT" } })).status).toBe(403);
    expect((await call(w.sales, migrationSessions.POST as Handler, "/data-migration/sessions", { body: { entity: "COMPANY" } })).status).toBe(403);
    expect((await call(w.finance, auditExport.GET as Handler, "/audit/events/export")).status).toBe(403);
    expect((await call(w.sales, privacyAccess.POST as Handler, "/x", { method: "POST", params: { requestId: "nope" } })).status).toBe(403);
  });

  it("every signed-in member may use the phone features, each limited by their own permissions", async () => {
    const w = await world();
    for (const ctx of [w.management, w.sales, w.delivery, w.finance, w.technical]) {
      for (const [handler, path] of [[syncStatus.GET, "/sync/status"], [pushConfig.GET, "/push/config"], [pushSubscriptions.GET, "/push/subscriptions"], [pwaManifest.GET, "/pwa/manifest"], [pwaVersion.GET, "/pwa/version"]] as [Handler, string][]) {
        expect((await call(ctx, handler, path)).status, `${ctx.roleKey} ${path}`).toBe(200);
      }
    }
    expect((await call(null, syncStatus.GET as Handler, "/sync/status")).status).toBe(401);
    // The queue applies the caller's own permissions item by item: Delivery cannot capture leads, Sales can.
    const batch = (id: string) => ({ mutations: [{ clientId: `matrix-${id}-${randomUUID()}`, kind: "QUICK_CAPTURE", payload: { name: "Matrix Person", phone: "0700 111 222" } }] });
    expect((await call(w.delivery, syncBatch.POST as Handler, "/sync/batch", { body: batch("d") })).body.results[0]).toMatchObject({ status: "REJECTED", reason: { code: "FORBIDDEN" } });
    expect((await call(w.sales, syncBatch.POST as Handler, "/sync/batch", { body: batch("s") })).body.results[0].status).toBe("APPLIED");
    expect((await call(w.delivery, quickCaptureRoute.POST as Handler, "/quick-capture", { body: { name: "Nope", phone: "0700" } })).status).toBe(403);
    expect((await call(w.finance, quickCaptureRoute.POST as Handler, "/quick-capture", { body: { name: "Nope", phone: "0700" } })).status).toBe(403);
  });

  it("quick capture honours an Idempotency-Key: the same key creates once, a different body under it is refused", async () => {
    const w = await world();
    const body = { name: "Idem Person", phone: "0733 444 555", note: "Met at the expo" };
    const first = await call(w.sales, quickCaptureRoute.POST as Handler, "/quick-capture", { body, key: "capture-key-0001" });
    const replay = await call(w.sales, quickCaptureRoute.POST as Handler, "/quick-capture", { body, key: "capture-key-0001" });
    expect(first.body.status).toBe("CREATED");
    expect(replay.body.lead.id).toBe(first.body.lead.id);
    expect(await adminDb.lead.count({ where: { organizationId: w.org.id } })).toBe(1);
    const reused = await call(w.sales, quickCaptureRoute.POST as Handler, "/quick-capture", { body: { ...body, name: "Someone Else" }, key: "capture-key-0001" });
    expect(reused.status).toBe(422);
    // Bad bodies use the one envelope.
    const bad = await call(w.sales, quickCaptureRoute.POST as Handler, "/quick-capture", { body: { phone: "0700" } });
    expect(bad.status).toBe(400);
    expect(bad.body.issues[0].path).toBe("name");
  });
});

describe("tenant isolation for every Stage 4 table", () => {
  it("rows written for one organisation are invisible to another, and cannot be written into it", async () => {
    const a = await world();
    const b = await world();
    const membership = a.sales.membershipId;
    const seeds: [string, (tx: Parameters<Parameters<typeof withOrgContext>[1]>[0]) => Promise<unknown>][] = [
      ["automation_rules", (tx) => tx.automationRule.create({ data: { organizationId: a.org.id, ruleKey: "STALLED_DEAL_ALERT", enabled: false } })],
      ["automation_runs", (tx) => tx.automationRun.create({ data: { organizationId: a.org.id, ruleKey: "STALLED_DEAL_ALERT", triggerKey: "t", status: "APPLIED", result: "x" } })],
      ["import_sessions", (tx) => tx.importSession.create({ data: { organizationId: a.org.id, entity: "COMPANY" } })],
      ["import_mapping_presets", (tx) => tx.importMappingPreset.create({ data: { organizationId: a.org.id, name: "p", entity: "COMPANY" } })],
      ["data_subject_requests", (tx) => tx.dataSubjectRequest.create({ data: { organizationId: a.org.id, kind: "ACCESS", subjectLabel: "x", dueOn: new Date() } })],
      ["export_approvals", (tx) => tx.exportApproval.create({ data: { organizationId: a.org.id, entity: "LEAD", rowCount: 9, requestedByMembershipId: membership } })],
      ["sync_mutations", (tx) => tx.syncMutation.create({ data: { organizationId: a.org.id, membershipId: membership, clientId: "isolation-0001", kind: "TASK_CREATE", status: "APPLIED", requestHash: "x" } })],
      ["push_subscriptions", (tx) => tx.pushSubscription.create({ data: { organizationId: a.org.id, membershipId: membership, endpoint: "https://fcm.googleapis.com/fcm/send/iso", p256dh: "p".repeat(40), auth: "a".repeat(10) } })],
    ];
    for (const [table, seed] of seeds) {
      await withOrgContext(a.org.id, seed);
      expect(await withOrgContext(a.org.id, (tx) => (tx as any)[modelOf(table)].count()), `${table} visible to its own organisation`).toBe(1);
      expect(await withOrgContext(b.org.id, (tx) => (tx as any)[modelOf(table)].count()), `${table} hidden from another`).toBe(0);
      await expect(withOrgContext(b.org.id, seed), `${table} cannot be written across`).rejects.toThrow();
    }
    const [sessionRowSeen] = await Promise.all([withOrgContext(b.org.id, (tx) => tx.importSessionIssue.count())]);
    expect(sessionRowSeen).toBe(0);
  });

  it("jobs, retention and the routes keep to their own organisation", async () => {
    const a = await world();
    const b = await world();
    await adminDb.syncMutation.create({ data: { organizationId: b.org.id, membershipId: b.sales.membershipId, clientId: "old-0000000001", kind: "TASK_CREATE", status: "APPLIED", requestHash: "x", createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    await runRetentionSweep(a.org.id);
    expect(await adminDb.syncMutation.count({ where: { organizationId: b.org.id } })).toBe(1);
    // A signed-in member of B cannot reach A's migration session or request through the routes.
    const session = await call(a.management, migrationSessions.POST as Handler, "/data-migration/sessions", { body: { entity: "COMPANY" } });
    expect((await call(b.management, migrationSession.GET as Handler, "/x", { params: { sessionId: session.body.id } })).status).toBe(404);
    const contact = await adminDb.contact.create({ data: { organizationId: a.org.id, firstName: "Iso", email: "iso@example.test" } });
    const filed = await call(a.management, privacyRequests.POST as Handler, "/privacy/requests", { body: { kind: "ACCESS", contactId: contact.id } });
    expect((await call(b.management, privacyAccess.POST as Handler, "/x", { method: "POST", params: { requestId: filed.body.id } })).status).toBe(404);
    expect((await call(b.management, privacyRequests.GET as Handler, "/privacy/requests")).body.total).toBe(0);
    expect((await call(b.management, auditEvents.GET as Handler, "/audit/events?entityId=" + contact.id)).body.total).toBe(0);
  });
});

function modelOf(table: string): string {
  return table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/ies$/, "y").replace(/s$/, "");
}

describe("the job framework (fault injection lives in jobs.test.ts; here, the Stage 4 jobs)", () => {
  it("the new jobs are registered with a schedule where they should have one, and a conservative attempt count where they must not repeat", () => {
    const byType = Object.fromEntries(listJobDefinitions().map((d) => [d.type, d]));
    expect(byType["automations.sweep"]?.schedule?.everyMs).toBe(24 * 3_600_000);
    expect(byType["privacy.retention"]?.schedule?.everyMs).toBe(24 * 3_600_000);
    expect(byType["data.migration"]?.schedule).toBeUndefined();
    expect(byType["data.migration"]?.maxAttempts).toBe(1);
  });

  it("the sweeps are safe to repeat and succeed through the framework", async () => {
    const w = await world();
    for (const type of ["automations.sweep", "privacy.retention"]) {
      for (let i = 0; i < 2; i += 1) expect((await enqueueAndRunNow({ organizationId: w.org.id, type })).outcome, type).toBe("succeeded");
    }
  });

  it("a migration job for a session that does not exist, or belongs to someone else, does nothing and does not fail", async () => {
    const a = await world();
    const b = await world();
    const run = await enqueueAndRunNow({ organizationId: a.org.id, type: "data.migration", payload: { sessionId: randomUUID(), phase: "VALIDATE" } });
    expect(run.outcome).toBe("succeeded");
    const session = await call(b.management, migrationSessions.POST as Handler, "/data-migration/sessions", { body: { entity: "COMPANY" } });
    const cross = await enqueueAndRunNow({ organizationId: a.org.id, type: "data.migration", payload: { sessionId: session.body.id, phase: "IMPORT" } });
    expect(cross.outcome).toBe("succeeded");
    expect((await adminDb.importSession.findUniqueOrThrow({ where: { id: session.body.id } })).status).toBe("DRAFT");
  });
});

describe("the contract", () => {
  it("every documented Stage 4 operation has a route that exports its method, and the document lists them all", async () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, { operationId: string }>> };
    const missing: string[] = [];
    for (const op of STAGE4_OPERATIONS) {
      const relative = op.path.replace("/api/orgs/{orgSlug}", "/api/orgs/[orgSlug]").replace(/\{(\w+)\}/g, "[$1]");
      const file = join(process.cwd(), "src/app", relative, "route.ts");
      if (!existsSync(file)) {
        missing.push(`${op.method} ${op.path}: no route file`);
        continue;
      }
      const mod = (await import(file)) as Record<string, unknown>;
      if (typeof mod[op.method.toUpperCase()] !== "function") missing.push(`${op.method} ${op.path}: route does not export ${op.method.toUpperCase()}`);
      expect(doc.paths[op.path]?.[op.method]?.operationId).toBe(op.operationId);
    }
    expect(missing).toEqual([]);
    expect(new Set(STAGE4_OPERATIONS.map((o) => o.operationId)).size).toBe(STAGE4_OPERATIONS.length);
    expect(STAGE4_OPERATIONS.length).toBeGreaterThan(60);
  });
});
