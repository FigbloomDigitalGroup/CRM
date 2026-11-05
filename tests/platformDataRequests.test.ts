import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { SESSION_COOKIE_NAME, createSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import { ORG_EXPORT_JOB } from "../src/jobs/offboardingJobs";
import { runDueJobs } from "../src/jobs/runner";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { createCompany } from "../src/repositories/companies";
import { getStorageDriver } from "../src/storage";
import { buildStorageKey } from "../src/storage/keys";
import { transitionOrganization } from "../src/services/organizationLifecycleService";
import { listAuditEvents } from "../src/services/platformAuditService";
import {
  APPROVALS_REQUIRED,
  cancelDataRequest,
  checkDeletionGate,
  decideDataRequest,
  executeDeletion,
  getDataRequest,
  getDeletionCertificate,
  getOrganisationExportDownload,
  listDataRequests,
  purgeExpiredExports,
  retryExport,
  submitOrganisationRequest,
} from "../src/services/platformDataRequestService";
import * as chatPrivacy from "../src/services/chatPrivacyService";
import { listOrganisationDataRequests, submitOrganisationDataRequest } from "../src/services/privacyService";
import { checkSlug } from "../src/services/platformOrganizationService";
import { createTestContext, createTestMembership, createTestOrganization, createTestUser } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";
import { discoverRoutes, fillParams, invoke } from "./helpers/routeHarness";

/**
 * FIG-1141 (B6.09): data requests and offboarding. Intake, two-person approval, export packaging with an expiring download,
 * the waiting period, the irreversible deletion, and the certificate.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));

const DAY = 86_400_000;
let admin1: TestPlatformAdmin;
let admin2: TestPlatformAdmin;
let admin3: TestPlatformAdmin;
beforeEach(async () => {
  admin1 ??= await makePlatformAdmin("approver-one");
  admin2 ??= await makePlatformAdmin("approver-two");
  admin3 ??= await makePlatformAdmin("approver-three");
});
afterEach(() => {
  holder.jar = cookieJar({});
});
afterAll(async () => {
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});

async function setup(options: { withData?: boolean } = {}) {
  const org = await createTestOrganization("Data request org");
  const management = await createTestContext(org.id, "MANAGEMENT", "dr.mgr");
  const sales = await createTestContext(org.id, "SALES", "dr.sales");
  if (options.withData) {
    await createCompany({ organizationId: org.id, name: `Acme Export Co ${org.slug}` });
  }
  return { org, management, sales };
}

const runExportJob = async (organizationId: string) => runDueJobs({ organizationIds: [organizationId], types: [ORG_EXPORT_JOB], maxJobs: 5 });
const row = (id: string) => adminDb.platformDataRequest.findUniqueOrThrow({ where: { id } });
const statusOf = async (id: string) => (await adminDb.organization.findUniqueOrThrow({ where: { id } })).status;

/** Submit a DELETE and take it to APPROVED with the export packaged, approved at `at`. */
async function approvedDeletion(at = new Date()) {
  const world = await setup({ withData: true });
  const request = await submitOrganisationRequest(world.management, { kind: "DELETE", note: "We are closing" });
  await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" }, { now: at });
  await decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" }, { now: at });
  await runExportJob(world.org.id);
  return { ...world, request };
}

describe("intake from the organisation (OS6)", () => {
  it("records an EXPORT or DELETE request once per kind, audits it, and changes no data", async () => {
    const { org, management } = await setup();
    const exportRequest = await submitOrganisationDataRequest(management, { kind: "EXPORT", note: "We are changing systems" });
    expect(exportRequest).toMatchObject({ kind: "EXPORT", status: "SUBMITTED_TO_PLATFORM", requestedByMembershipId: management.membershipId });
    await expect(submitOrganisationDataRequest(management, { kind: "EXPORT" })).rejects.toThrow(/already with the platform team/);
    await expect(submitOrganisationDataRequest(management, { kind: "BURN" })).rejects.toThrow(ValidationError);
    await submitOrganisationDataRequest(management, { kind: "DELETE" });
    expect((await listOrganisationDataRequests(management)).items.map((r) => r.kind)).toEqual(["EXPORT", "DELETE"]);

    const stored = await adminDb.platformDataRequest.findMany({ where: { organizationId: org.id }, orderBy: { kind: "asc" } });
    expect(stored.map((r) => [r.kind, r.approvalsRequired, r.status])).toEqual([["DELETE", 2, "SUBMITTED"], ["EXPORT", 1, "SUBMITTED"]]);
    expect(stored[0]).toMatchObject({ organizationSlug: org.slug, organizationName: org.name, retentionDays: 30 });
    expect(await statusOf(org.id)).toBe("ACTIVE");
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "organization.data_request_submitted" } })).toBe(2);
    const platformLog = (await listAuditEvents({ organizationId: org.id })).items.filter((e) => e.action === "data_request.submitted");
    expect(platformLog).toHaveLength(2);
    expect(platformLog[0]).toMatchObject({ actorIdentityId: null, targetType: "DataRequest" });
  });

  it("is Management only, and each organisation has its own queue", async () => {
    const a = await setup();
    const b = await setup();
    await expect(submitOrganisationRequest(a.sales, { kind: "EXPORT" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOrganisationDataRequests(a.sales)).rejects.toBeInstanceOf(ForbiddenError);
    await submitOrganisationRequest(a.management, { kind: "EXPORT" });
    expect((await listOrganisationDataRequests(b.management)).items).toHaveLength(0);
    expect((await listOrganisationDataRequests(a.management)).items).toHaveLength(1);
  });

  it("two requests at the same moment make one", async () => {
    const { management, org } = await setup();
    const results = await Promise.allSettled([submitOrganisationRequest(management, { kind: "DELETE" }), submitOrganisationRequest(management, { kind: "DELETE" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await adminDb.platformDataRequest.count({ where: { organizationId: org.id, kind: "DELETE" } })).toBe(1);
  });

  it("the platform queue lists them with filters", async () => {
    const { org, management } = await setup();
    const exp = await submitOrganisationRequest(management, { kind: "EXPORT" });
    await submitOrganisationRequest(management, { kind: "DELETE" });
    expect((await listDataRequests({ organizationId: org.id })).total).toBe(2);
    expect((await listDataRequests({ organizationId: org.id, kind: "EXPORT" })).items.map((r) => r.id)).toEqual([exp.id]);
    expect((await listDataRequests({ organizationId: org.id, status: "APPROVED" })).total).toBe(0);
    await expect(listDataRequests({ status: "BOGUS" })).rejects.toThrow(ValidationError);
    await expect(listDataRequests({ kind: "BOGUS" })).rejects.toThrow(ValidationError);
    expect((await getDataRequest(exp.id)).requestedBy).toBeTruthy();
    await expect(getDataRequest(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("approval", () => {
  it("an export needs one approver and starts packaging; the organisation stays active", async () => {
    const { org, management } = await setup({ withData: true });
    const request = await submitOrganisationRequest(management, { kind: "EXPORT" });
    const done = await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE", comment: "Verified with the owner" });
    expect(done).toMatchObject({ status: "APPROVED", export: { status: "PACKAGING" }, deleteAfter: null });
    expect(done.approvals).toHaveLength(1);
    expect(await statusOf(org.id)).toBe("ACTIVE");
    expect(await adminDb.backgroundJob.count({ where: { organizationId: org.id, type: ORG_EXPORT_JOB, status: "QUEUED" } })).toBe(1);
  });

  it("a deletion needs two different people: one is not enough, and the same person cannot count twice", async () => {
    const { org, management } = await setup({ withData: true });
    const request = await submitOrganisationRequest(management, { kind: "DELETE" });
    expect(APPROVALS_REQUIRED.DELETE).toBe(2);

    const first = await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    expect(first).toMatchObject({ status: "SUBMITTED", deleteAfter: null, export: { status: "NONE" } });
    expect(await statusOf(org.id)).toBe("ACTIVE");
    expect(await adminDb.backgroundJob.count({ where: { organizationId: org.id, type: ORG_EXPORT_JOB } })).toBe(0);

    await expect(decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" })).rejects.toMatchObject({ issues: [{ code: "ALREADY_DECIDED" }] });
    expect((await getDataRequest(request.id)).status).toBe("SUBMITTED");

    const at = new Date("2026-12-01T09:00:00Z");
    const second = await decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" }, { now: at });
    expect(second).toMatchObject({ status: "APPROVED", export: { status: "PACKAGING" } });
    expect(second.approvals.map((a) => a.approverIdentityId).sort()).toEqual([admin1.id, admin2.id].sort());
    expect(second.deleteAfter).toBe(new Date(at.getTime() + 30 * DAY).toISOString());
    // Approving starts the offboarding: the organisation is now blocked from the app.
    expect(await statusOf(org.id)).toBe("OFFBOARDING");
    await expect(decideDataRequest(admin3.actor, request.id, { decision: "APPROVE" })).rejects.toMatchObject({ issues: [{ code: "NOT_PENDING" }] });
  });

  it("the database itself allows one decision per person, and never lets a decision change", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationRequest(management, { kind: "DELETE" });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    await expect(
      adminDb.platformDataRequestApproval.create({ data: { requestId: request.id, approverIdentityId: admin1.id, approverLabel: "again", decision: "APPROVE" } }),
    ).rejects.toThrow(/Unique constraint/);
    const approval = await adminDb.platformDataRequestApproval.findFirstOrThrow({ where: { requestId: request.id } });
    await expect(adminDb.platformDataRequestApproval.update({ where: { id: approval.id }, data: { decision: "REJECT" } })).rejects.toThrow(/append-only/);
    await expect(adminDb.platformDataRequestApproval.delete({ where: { id: approval.id } })).rejects.toThrow(/append-only/);
    expect(org.id).toBeTruthy();
  });

  it("a rejection needs a reason, closes the request, and leaves the organisation alone", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationRequest(management, { kind: "DELETE" });
    await expect(decideDataRequest(admin1.actor, request.id, { decision: "REJECT" })).rejects.toThrow(/at least 5/);
    await expect(decideDataRequest(admin1.actor, request.id, { decision: "MAYBE" })).rejects.toThrow(/APPROVE or REJECT/);
    const done = await decideDataRequest(admin1.actor, request.id, { decision: "REJECT", comment: "Owner did not confirm by phone" });
    expect(done).toMatchObject({ status: "REJECTED", closedReason: "Owner did not confirm by phone" });
    expect(await statusOf(org.id)).toBe("ACTIVE");
    await expect(decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" })).rejects.toMatchObject({ issues: [{ code: "NOT_PENDING" }] });
    // A closed request frees the slot: the organisation may ask again.
    expect((await submitOrganisationRequest(management, { kind: "DELETE" })).status).toBe("SUBMITTED_TO_PLATFORM");
  });

  it("every decision is audited with who decided and why", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationRequest(management, { kind: "DELETE" });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE", comment: "Looks right" }, { requestId: "req-approve-1" });
    await decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" });
    const log = (await listAuditEvents({ organizationId: org.id })).items.map((e) => e.action);
    expect(log).toEqual(expect.arrayContaining(["data_request.submitted", "data_request.approval_recorded", "data_request.approved", "organization.offboarding_started"]));
    const first = (await listAuditEvents({ action: "data_request.approval_recorded" })).items.find((e) => e.targetId === request.id)!;
    expect(first).toMatchObject({ actorIdentityId: admin1.id, reason: "Looks right", requestId: "req-approve-1", metadata: { approvals: 1, required: 2 } });
  });
});

describe("export packaging and the expiring download", () => {
  it("packages the organisation's own data once approved, and only its Management can fetch it, for a limited time", async () => {
    const { org, management, sales } = await setup({ withData: true });
    const other = await setup({ withData: true });
    // Material that must never be in the file: a pending invite's token hash, and a session.
    const inviteUser = await createTestUser("dr.invitee");
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({ data: { organizationId: org.id, userId: inviteUser.id, roleId: role.id, status: "PENDING", inviteTokenHash: `hash-${randomUUID()}` } });

    const request = await submitOrganisationRequest(management, { kind: "EXPORT" });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    expect((await runExportJob(org.id)).results.map((r) => r.outcome)).toEqual(["succeeded"]);

    const ready = await row(request.id);
    expect(ready).toMatchObject({ exportStatus: "READY", status: "APPROVED" });
    expect(ready.exportExpiresAt!.getTime() - ready.exportReadyAt!.getTime()).toBe(14 * DAY);
    expect(ready.exportStorageKey).toMatch(new RegExp(`^orgs/${org.id}/orgexport/`));

    // The bytes: this organisation's rows, not another's, and no sign-in material.
    const bytes = await getStorageDriver().getObject(ready.exportStorageKey!, 50_000_000);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ready.exportChecksumSha256);
    const text = gunzipSync(bytes).toString("utf8");
    const parsed = JSON.parse(text) as { manifest: { organization: { slug: string }; tableCounts: Record<string, number> }; tables: Record<string, Record<string, unknown>[]> };
    expect(parsed.manifest.organization.slug).toBe(org.slug);
    expect(parsed.tables.companies!.map((c) => c.name)).toEqual([`Acme Export Co ${org.slug}`]);
    expect(text).not.toContain(other.org.slug);
    expect(text).not.toContain("hash-");
    expect(Object.keys(parsed.tables)).not.toContain("sessions");
    expect(parsed.tables.members!.length).toBe(3);
    expect(parsed.tables.members!.every((m) => "email" in m && !("password_hash" in m))).toBe(true);
    expect(Object.keys(parsed.tables.memberships![0]!)).not.toContain("invite_token_hash");

    // The download: Management of this organisation, a short signed link.
    const link = await getOrganisationExportDownload(management, request.id);
    expect(link.download.url).toContain("/api/storage/blob");
    expect(link.checksumSha256).toBe(ready.exportChecksumSha256);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "organization.export_downloaded" } })).toBe(1);
    await expect(getOrganisationExportDownload(sales, request.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getOrganisationExportDownload(other.management, request.id)).rejects.toBeInstanceOf(NotFoundError);

    // After the window: refused; then the file is purged and cannot be fetched.
    const late = new Date(ready.exportExpiresAt!.getTime() + 1000);
    await expect(getOrganisationExportDownload(management, request.id, late)).rejects.toMatchObject({ issues: [{ code: "EXPORT_EXPIRED" }] });
    expect(await purgeExpiredExports(late)).toEqual({ purged: expect.any(Number) });
    expect(await row(request.id)).toMatchObject({ exportStatus: "EXPIRED", exportStorageKey: null });
    expect(await getStorageDriver().headObject(ready.exportStorageKey!)).toBeNull();
    await expect(getOrganisationExportDownload(management, request.id)).rejects.toMatchObject({ issues: [{ code: "EXPORT_UNAVAILABLE" }] });

    // Packaging again after expiry.
    const again = await retryExport(admin1.actor, request.id);
    expect(again.export.status).toBe("PACKAGING");
    await runExportJob(org.id);
    expect((await row(request.id)).exportStatus).toBe("READY");
  });

  it("no download before the export is ready, and the job is safe to run twice", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationRequest(management, { kind: "EXPORT" });
    await expect(getOrganisationExportDownload(management, request.id)).rejects.toMatchObject({ issues: [{ code: "EXPORT_UNAVAILABLE" }] });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    await expect(getOrganisationExportDownload(management, request.id)).rejects.toThrow(/still being prepared/);
    await runExportJob(org.id);
    const first = await row(request.id);
    const { runOrganisationExportJob } = await import("../src/services/platformDataRequestService");
    expect(await runOrganisationExportJob(org.id, request.id)).toEqual({ skipped: "already packaged" });
    expect((await row(request.id)).exportStorageKey).toBe(first.exportStorageKey);
    expect(await runOrganisationExportJob(randomUUID(), request.id)).toEqual({ skipped: "no such request for this organisation" });
  });

  it("a failed packaging is recorded, can be retried by an admin, and nothing else is changed", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationRequest(management, { kind: "EXPORT" });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    const driver = getStorageDriver();
    const spy = vi.spyOn(driver, "putObject").mockRejectedValueOnce(new Error("object store unavailable"));
    const attempt = await runExportJob(org.id);
    spy.mockRestore();
    expect(attempt.results[0]!.outcome).not.toBe("succeeded");
    expect(await row(request.id)).toMatchObject({ exportStatus: "FAILED", exportError: "object store unavailable" });
    await expect(retryExport(admin1.actor, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    const retried = await retryExport(admin1.actor, request.id);
    expect(retried.export).toMatchObject({ status: "PACKAGING", error: null });
    // The failed first job may be waiting out its back-off; the retry queued a fresh one, which runs now.
    await runExportJob(org.id);
    expect((await row(request.id)).exportStatus).toBe("READY");
    await expect(retryExport(admin1.actor, request.id)).rejects.toMatchObject({ issues: [{ code: "NOTHING_TO_RETRY" }] });
  });
});

describe("deletion: the gate", () => {
  it("is shut until every condition holds, and says what is missing", async () => {
    const world = await setup({ withData: true });
    const request = await submitOrganisationRequest(world.management, { kind: "DELETE" });
    let gate = await checkDeletionGate(request.id);
    expect(gate.ok).toBe(false);
    expect(gate.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/not approved/), expect.stringMatching(/Two different approvers/), expect.stringMatching(/waiting period/), expect.stringMatching(/export/), expect.stringMatching(/not offboarding/)]));

    const at = new Date("2026-12-01T09:00:00Z");
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" }, { now: at });
    await decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" }, { now: at });
    gate = await checkDeletionGate(request.id, new Date(at.getTime() + 31 * DAY));
    expect(gate.blockers).toEqual([expect.stringMatching(/export has not been packaged/)]);
    await runExportJob(world.org.id);
    expect((await checkDeletionGate(request.id, new Date(at.getTime() + 29 * DAY))).blockers).toEqual([expect.stringMatching(/waiting period runs until 2026-12-31/)]);
    expect(await checkDeletionGate(request.id, new Date(at.getTime() + 31 * DAY))).toMatchObject({ ok: true, blockers: [] });
  });

  it("refuses to delete before the waiting period is over, with the wrong slug, or for an export request, and deletes nothing", async () => {
    const at = new Date("2026-12-01T09:00:00Z");
    const { org, request, management } = await approvedDeletion(at);
    await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now: new Date(at.getTime() + 5 * DAY) })).rejects.toThrow(/waiting period runs until/);
    await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: "wrong-slug" }, { now: new Date(at.getTime() + 31 * DAY) })).rejects.toMatchObject({ issues: [{ code: "CONFIRMATION_MISMATCH" }] });
    await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: "" }, { now: new Date(at.getTime() + 31 * DAY) })).rejects.toThrow(/slug/);
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await statusOf(org.id)).toBe("OFFBOARDING");

    const exportOnly = await submitOrganisationRequest(management, { kind: "EXPORT" });
    await expect(executeDeletion(admin1.actor, exportOnly.id, { confirmSlug: org.slug }, { now: new Date(at.getTime() + 40 * DAY) })).rejects.toThrow(/Only a deletion request/);
  });

  it("one approval is never enough, even if the request is forced to APPROVED underneath", async () => {
    const world = await setup({ withData: true });
    await adminDb.organization.update({ where: { id: world.org.id }, data: { status: "OFFBOARDING" } });
    const forced = await adminDb.platformDataRequest.create({
      data: {
        organizationId: world.org.id, organizationSlug: world.org.slug, organizationName: world.org.name, kind: "DELETE", status: "APPROVED", approvalsRequired: 2,
        approvedAt: new Date(Date.now() - 60 * DAY), deleteAfter: new Date(Date.now() - 30 * DAY), exportStatus: "READY", exportReadyAt: new Date(Date.now() - 59 * DAY),
      },
    });
    await adminDb.platformDataRequestApproval.create({ data: { requestId: forced.id, approverIdentityId: admin1.id, approverLabel: admin1.email, decision: "APPROVE" } });
    await expect(executeDeletion(admin1.actor, forced.id, { confirmSlug: world.org.slug })).rejects.toThrow(/Two different approvers are needed; there is 1/);
    expect(await adminDb.company.count({ where: { organizationId: world.org.id } })).toBe(1);
    expect(await adminDb.platformDeletionCertificate.count({ where: { requestId: forced.id } })).toBe(0);
  });

  it("no deletion path exists without a request: the organisation must be offboarding, and active ones are refused", async () => {
    const world = await setup({ withData: true });
    const request = await submitOrganisationRequest(world.management, { kind: "DELETE" });
    await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: world.org.slug })).rejects.toThrow(ValidationError);
    await expect(executeDeletion(admin1.actor, randomUUID(), { confirmSlug: "x" })).rejects.toThrow(/no such request/);
    expect(await adminDb.company.count({ where: { organizationId: world.org.id } })).toBe(1);
  });
});

describe("deletion: the irreversible step and the certificate", () => {
  it("deletes everything of the organisation in one go, keeps a tombstone, and stores a certificate", async () => {
    const at = new Date("2026-12-01T09:00:00Z");
    const { org, request, management } = await approvedDeletion(at);
    const other = await setup({ withData: true });

    // A stored file, an account only this organisation used, and a person who also belongs elsewhere.
    const fileId = randomUUID();
    const storageKey = buildStorageKey(org.id, "attachment", fileId);
    await getStorageDriver().putObject(storageKey, Buffer.from("secret attachment"), { contentType: "text/plain" });
    await adminDb.file.create({ data: { id: fileId, organizationId: org.id, purpose: "ATTACHMENT", name: "a.txt", sizeBytes: 17, mimeType: "text/plain", storageKey, status: "READY" } });
    const soleUserId = management.userId;
    const shared = await createTestMembership(org.id, "SALES", "dr.shared");
    const sharedRole = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({ data: { organizationId: other.org.id, userId: shared.user.id, roleId: sharedRole.id, joinedAt: new Date() } });
    const ownCompany = await adminDb.company.count({ where: { organizationId: org.id } });
    expect(ownCompany).toBe(1);

    const result = await executeDeletion(admin2.actor, request.id, { confirmSlug: org.slug.toUpperCase() }, { now: new Date(at.getTime() + 31 * DAY), requestId: "req-delete-1" });

    // Gone: the organisation's rows, its stored file, and the account only it used.
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.membership.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.leadSource.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.file.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await getStorageDriver().headObject(storageKey)).toBeNull();
    expect(await adminDb.user.findUnique({ where: { id: soleUserId } })).toBeNull();
    // Kept: the other organisation, and the person who also belongs there.
    expect(await adminDb.user.findUnique({ where: { id: shared.user.id } })).not.toBeNull();
    expect(await adminDb.company.count({ where: { organizationId: other.org.id } })).toBe(1);
    expect(await adminDb.membership.count({ where: { organizationId: other.org.id, userId: shared.user.id } })).toBe(1);

    // The tombstone: same id and slug, no name, OFFBOARDED, and the slug is never free again.
    expect(await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ slug: org.slug, name: "Offboarded organisation", status: "OFFBOARDED" });
    expect(await checkSlug(org.slug)).toMatchObject({ available: false, problem: "TAKEN" });
    await expect(transitionOrganization(admin1.actor, org.id, "reactivate", "Please bring it back")).rejects.toThrow(/offboarded and its data deleted/);

    // The certificate: stored, complete, and its hash matches its content.
    const certificate = await getDeletionCertificate(request.id);
    expect(certificate).toMatchObject({ id: result.certificate.id, requestId: request.id, organizationId: org.id, organizationSlug: org.slug, intact: true });
    const content = certificate.content as { organization: { name: string }; request: { approvals: { approver: string }[]; waitingPeriodDays: number }; executed: { by: string; at: string }; export: { checksumSha256: string }; deleted: { tableRowCounts: Record<string, number>; storedFiles: number; userAccounts: number } };
    expect(content.organization.name).toBe(org.name);
    expect(content.request.approvals.map((a) => a.approver).sort()).toEqual([admin1.email, admin2.email].sort());
    expect(content.request.waitingPeriodDays).toBe(30);
    expect(content.executed).toMatchObject({ by: admin2.email, at: new Date(at.getTime() + 31 * DAY).toISOString() });
    expect(content.export.checksumSha256).toBe((await row(request.id)).exportChecksumSha256);
    expect(content.deleted.tableRowCounts.companies).toBe(1);
    expect(content.deleted.tableRowCounts.memberships).toBeGreaterThanOrEqual(3);
    expect(content.deleted.storedFiles).toBe(1);
    expect(content.deleted.userAccounts).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(content)).not.toMatch(/Acme Export Co/); // counts only: no customer names in the proof

    // The request, the trail and the log record it, and the certificate cannot be altered afterwards.
    expect(await getDataRequest(request.id)).toMatchObject({ status: "COMPLETED", closedReason: "Deleted", certificate: { id: certificate.id } });
    expect((await adminDb.organizationLifecycleEvent.findMany({ where: { organizationId: org.id, action: "delete" } })).length).toBe(1);
    const log = (await listAuditEvents({ organizationId: org.id })).items.find((e) => e.action === "organization.deleted")!;
    expect(log).toMatchObject({ actorIdentityId: admin2.id, requestId: "req-delete-1", metadata: { certificateId: certificate.id, files: 1 } });
    await expect(adminDb.platformDeletionCertificate.update({ where: { id: certificate.id }, data: { contentSha256: "x" } })).rejects.toThrow(/append-only/);
    await expect(adminDb.platformDeletionCertificate.delete({ where: { id: certificate.id } })).rejects.toThrow(/append-only/);

    // Once done, it cannot be done again, and the app answers as for any offboarded organisation.
    await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now: new Date(at.getTime() + 60 * DAY) })).rejects.toThrow(/not approved|offboarding/);
    expect(await resolveActiveMembership(soleUserId, org.id)).toBeNull();
  });

  it("a tampered certificate is reported as not intact", async () => {
    const at = new Date("2026-12-01T09:00:00Z");
    const { org, request } = await approvedDeletion(at);
    await executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now: new Date(at.getTime() + 31 * DAY) });
    await adminDb.$executeRawUnsafe(`ALTER TABLE platform_deletion_certificates DISABLE TRIGGER platform_deletion_certificates_no_update`);
    try {
      await adminDb.$executeRawUnsafe(`UPDATE platform_deletion_certificates SET content = jsonb_set(content, '{deleted,storedFiles}', '99') WHERE request_id = '${request.id}'`);
      expect((await getDeletionCertificate(request.id)).intact).toBe(false);
    } finally {
      await adminDb.$executeRawUnsafe(`UPDATE platform_deletion_certificates SET content = jsonb_set(content, '{deleted,storedFiles}', '0') WHERE request_id = '${request.id}'`);
      await adminDb.$executeRawUnsafe(`ALTER TABLE platform_deletion_certificates ENABLE TRIGGER platform_deletion_certificates_no_update`);
    }
    await expect(getDeletionCertificate(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deletion erases chat through the chat erasure", () => {
  it("calls eraseMemberChat for every member, and the messages are gone", async () => {
    const at = new Date("2026-12-01T09:00:00Z");
    const { org, request, management, sales } = await approvedDeletion(at);
    const channel = await adminDb.chatChannel.create({ data: { organizationId: org.id, kind: "PUBLIC", name: "general", lastSeq: 2 } });
    await adminDb.chatMessage.createMany({
      data: [
        { organizationId: org.id, channelId: channel.id, seq: 1, authorMembershipId: management.membershipId, body: "private words from management" },
        { organizationId: org.id, channelId: channel.id, seq: 2, authorMembershipId: sales.membershipId, body: "private words from sales" },
      ],
    });
    const spy = vi.spyOn(chatPrivacy, "eraseMemberChat");
    try {
      const result = await executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now: new Date(at.getTime() + 31 * DAY) });
      const called = spy.mock.calls.map(([input]) => [input.organizationId, input.membershipId, input.policy]);
      expect(called).toEqual(expect.arrayContaining([[org.id, management.membershipId, "DELETE"], [org.id, sales.membershipId, "DELETE"]]));
      expect((result.certificate.content as { deleted: { chatMessagesErased: number } }).deleted.chatMessagesErased).toBe(2);
    } finally {
      spy.mockRestore();
    }
    expect(await adminDb.chatMessage.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.chatChannel.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("cancelling", () => {
  it("needs a reason, closes the request, and puts the organisation back as it was", async () => {
    const { org, request, management } = await approvedDeletion();
    expect(await statusOf(org.id)).toBe("OFFBOARDING");
    await expect(cancelDataRequest(admin3.actor, request.id, "no")).rejects.toThrow(/at least 5/);
    const done = await cancelDataRequest(admin3.actor, request.id, "The owner changed their mind", { requestId: "req-cancel-1" });
    expect(done).toMatchObject({ status: "CANCELLED", closedReason: "The owner changed their mind" });
    expect(await statusOf(org.id)).toBe("ACTIVE");
    await expect(cancelDataRequest(admin3.actor, request.id, "Again, for no reason")).rejects.toMatchObject({ issues: [{ code: "NOT_OPEN" }] });
    await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now: new Date(Date.now() + 40 * DAY) })).rejects.toThrow(/cancelled/);
    expect((await listAuditEvents({ organizationId: org.id })).items.map((e) => e.action)).toEqual(expect.arrayContaining(["data_request.cancelled", "organization.reactivated"]));
    // The organisation can ask again, and uses the app meanwhile.
    expect((await resolveActiveMembership(management.userId, org.id))?.organizationId).toBe(org.id);
    expect((await submitOrganisationRequest(management, { kind: "DELETE" })).status).toBe("SUBMITTED_TO_PLATFORM");
  });

  it("a suspended organisation goes back to suspended", async () => {
    const world = await setup({ withData: true });
    await transitionOrganization(admin1.actor, world.org.id, "suspend", "Unpaid invoice");
    // (A suspended organisation cannot file a request itself; the platform opens one on its behalf in the tests.)
    const request = await adminDb.platformDataRequest.create({
      data: { organizationId: world.org.id, organizationSlug: world.org.slug, organizationName: world.org.name, kind: "DELETE", approvalsRequired: 2 },
    });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    await decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" });
    expect(await statusOf(world.org.id)).toBe("OFFBOARDING");
    await cancelDataRequest(admin3.actor, request.id, "Resolved with the customer");
    expect(await statusOf(world.org.id)).toBe("SUSPENDED");
  });

  it("an open request can be cancelled before any approval, without touching the organisation", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationRequest(management, { kind: "EXPORT" });
    expect((await cancelDataRequest(admin1.actor, request.id, "Duplicate of an email request")).status).toBe("CANCELLED");
    expect(await statusOf(org.id)).toBe("ACTIVE");
    await expect(cancelDataRequest(admin1.actor, randomUUID(), "Does not exist at all")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the routes", () => {
  it("run the whole workflow for a platform admin, and give tenants a 404 on the platform side", async () => {
    const list = await import("../src/app/api/platform/data-requests/route");
    const one = await import("../src/app/api/platform/data-requests/[requestId]/route");
    const decision = await import("../src/app/api/platform/data-requests/[requestId]/decision/route");
    const del = await import("../src/app/api/platform/data-requests/[requestId]/delete/route");
    const certificate = await import("../src/app/api/platform/data-requests/[requestId]/certificate/route");
    const cancel = await import("../src/app/api/platform/data-requests/[requestId]/cancel/route");

    const world = await setup({ withData: true });
    const request = await submitOrganisationRequest(world.management, { kind: "DELETE" });
    const p = ctxParams({ requestId: request.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (module: { POST: (r: Request, c: any) => Promise<Response> }, body: unknown) => module.POST(jsonRequest("/api/platform/x", "POST", body), p);

    holder.jar = admin1.jar;
    expect(((await (await list.GET(jsonRequest(`/api/platform/data-requests?organizationId=${world.org.id}`, "GET"))).json()).items as unknown[]).length).toBe(1);
    expect((await call(decision, { decision: "APPROVE", comment: "ok" })).status).toBe(200);
    expect((await call(decision, { decision: "APPROVE" })).status).toBe(400);
    expect((await call(decision, { decision: "WHAT" })).status).toBe(400);
    holder.jar = admin2.jar;
    const second = await (await call(decision, { decision: "APPROVE" })).json();
    expect(second.status).toBe("APPROVED");
    await runExportJob(world.org.id);

    const detail = await (await one.GET(jsonRequest("/api/platform/x", "GET"), p)).json();
    expect(detail.deletionGate.ok).toBe(false);
    expect(detail.deletionGate.blockers.join(" ")).toMatch(/waiting period/);
    const early = await call(del, { confirmSlug: world.org.slug });
    expect(early.status).toBe(400);
    expect((await early.json()).fieldErrors[0]).toMatchObject({ code: "DELETION_BLOCKED" });
    expect((await certificate.GET(jsonRequest("/api/platform/x", "GET"), p)).status).toBe(404);

    // The organisation's side while it is offboarding: the request list and the download still work.
    const membership = await adminDb.membership.findFirstOrThrow({ where: { id: world.management.membershipId } });
    const jar = cookieJar({ [SESSION_COOKIE_NAME]: (await createSession(membership.userId)).token });
    holder.jar = jar;
    const requests = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/privacy/organisation-requests")!;
    const listed = await invoke(requests, "GET", fillParams(requests, world.org.slug));
    expect(listed.status).toBe(200);
    expect(listed.json.items[0]).toMatchObject({ kind: "DELETE", status: "APPROVED", exportStatus: "READY" });
    const download = discoverRoutes().find((r) => r.path.endsWith("/{requestId}/download"))!;
    const link = await invoke(download, "GET", fillParams(download, world.org.slug, (n) => (n === "requestId" ? request.id : undefined)));
    expect(link.status).toBe(200);
    expect(link.json.download.url).toContain("/api/storage/blob");
    const salesUser = await createTestMembership(world.org.id, "SALES", "dr.sales2");
    holder.jar = cookieJar({ [SESSION_COOKIE_NAME]: (await createSession(salesUser.user.id)).token });
    expect((await invoke(download, "GET", fillParams(download, world.org.slug, (n) => (n === "requestId" ? request.id : undefined)))).status).toBe(403);

    holder.jar = admin3.jar;
    expect((await call(cancel, { reason: "x" })).status).toBe(400);
    expect((await call(cancel, { reason: "Customer withdrew the request" })).status).toBe(200);

    holder.jar = jar; // tenant Management: nothing on the platform side
    expect((await list.GET(jsonRequest("/api/platform/data-requests", "GET"))).status).toBe(404);
    expect((await call(decision, { decision: "APPROVE" })).status).toBe(404);
    expect((await call(del, { confirmSlug: world.org.slug })).status).toBe(404);
  });
});

describe("hardening: reset credentials, resumable deletion, verify it's you", () => {
  it("a deletion approval from an identity reset in the last 24 hours is refused, and an approval followed by a reset blocks the gate", async () => {
    const world = await setup();
    const request = await submitOrganisationRequest(world.management, { kind: "DELETE" });
    await adminDb.platformIdentity.update({ where: { id: admin1.id }, data: { credentialsResetAt: new Date() } });
    await expect(decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" })).rejects.toMatchObject({ issues: [{ code: "CREDENTIALS_RECENTLY_RESET" }] });
    await adminDb.platformIdentity.update({ where: { id: admin1.id }, data: { credentialsResetAt: new Date(Date.now() - 2 * DAY) } });
    await decideDataRequest(admin1.actor, request.id, { decision: "APPROVE" });
    await decideDataRequest(admin2.actor, request.id, { decision: "APPROVE" });
    await runExportJob(world.org.id);
    const after = new Date(Date.now() + 31 * DAY);
    expect((await checkDeletionGate(request.id, after)).ok).toBe(true);
    await adminDb.platformIdentity.update({ where: { id: admin2.id }, data: { credentialsResetAt: new Date() } });
    const gate = await checkDeletionGate(request.id, after);
    expect(gate.ok).toBe(false);
    expect(gate.blockers.join(" ")).toMatch(/reset within 24 hours/);
    await adminDb.platformIdentity.update({ where: { id: admin2.id }, data: { credentialsResetAt: null } });
    await adminDb.platformIdentity.update({ where: { id: admin1.id }, data: { credentialsResetAt: null } });
  });

  it("a deletion that fails while removing files is resumable, and cannot be cancelled once started", async () => {
    const at = new Date("2026-12-01T09:00:00Z");
    const { org, request } = await approvedDeletion(at);
    const now = new Date(at.getTime() + 31 * DAY);
    const fileId = randomUUID();
    const storageKey = buildStorageKey(org.id, "attachment", fileId);
    await getStorageDriver().putObject(storageKey, Buffer.from("x"), { contentType: "text/plain" });
    await adminDb.file.create({ data: { id: fileId, organizationId: org.id, purpose: "ATTACHMENT", name: "a.txt", sizeBytes: 1, mimeType: "text/plain", storageKey, status: "READY" } });
    const spy = vi.spyOn(getStorageDriver(), "deleteObject").mockRejectedValueOnce(new Error("storage unavailable"));
    try {
      await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now })).rejects.toThrow(/storage unavailable/);
    } finally {
      spy.mockRestore();
    }
    const half = await row(request.id);
    expect(half.status).toBe("APPROVED");
    expect(half.deletionStartedAt).not.toBeNull();
    expect(await statusOf(org.id)).toBe("OFFBOARDING");
    await expect(cancelDataRequest(admin3.actor, request.id, "Too late to cancel")).rejects.toMatchObject({ issues: [{ code: "DELETION_STARTED" }] });
    const done = await executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now });
    expect(done.request.status).toBe("COMPLETED");
    expect(await statusOf(org.id)).toBe("OFFBOARDED");
  });

  it("a request cancelled before the deletion starts is never deleted (files stay)", async () => {
    const at = new Date("2026-12-01T09:00:00Z");
    const { org, request } = await approvedDeletion(at);
    const fileId = randomUUID();
    const storageKey = buildStorageKey(org.id, "attachment", fileId);
    await getStorageDriver().putObject(storageKey, Buffer.from("keep"), { contentType: "text/plain" });
    await adminDb.file.create({ data: { id: fileId, organizationId: org.id, purpose: "ATTACHMENT", name: "k.txt", sizeBytes: 4, mimeType: "text/plain", storageKey, status: "READY" } });
    await cancelDataRequest(admin3.actor, request.id, "Changed their mind");
    const spy = vi.spyOn(getStorageDriver(), "deleteObject");
    try {
      await expect(executeDeletion(admin1.actor, request.id, { confirmSlug: org.slug }, { now: new Date(at.getTime() + 31 * DAY) })).rejects.toThrow(ValidationError);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await adminDb.file.count({ where: { id: fileId } })).toBe(1);
  });

  it("every irreversible platform route asks to verify it's you when the session verification is stale", async () => {
    const decision = await import("../src/app/api/platform/data-requests/[requestId]/decision/route");
    const del = await import("../src/app/api/platform/data-requests/[requestId]/delete/route");
    const cancel = await import("../src/app/api/platform/data-requests/[requestId]/cancel/route");
    const retry = await import("../src/app/api/platform/data-requests/[requestId]/retry-export/route");
    const status = await import("../src/app/api/platform/organizations/[organizationId]/status/route");
    const incidents = await import("../src/app/api/platform/health/incidents/route");
    const resolve = await import("../src/app/api/platform/health/incidents/[incidentId]/resolve/route");
    const stale = await makePlatformAdmin("stale");
    await adminDb.platformSession.updateMany({ where: { platformIdentityId: stale.id }, data: { verifiedAt: new Date(Date.now() - 24 * 3600_000) } });
    holder.jar = stale.jar;
    const id = randomUUID();
    const body = { decision: "APPROVE", confirmSlug: "x", reason: "a good reason", action: "suspend", component: "api", severity: "MINOR", title: "t" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = (m: { POST: (r: Request, c: any) => Promise<Response> }, params: Record<string, string>) => m.POST(jsonRequest("/api/platform/x", "POST", body), ctxParams(params));
    for (const res of [
      await post(decision, { requestId: id }),
      await post(del, { requestId: id }),
      await post(cancel, { requestId: id }),
      await post(retry, { requestId: id }),
      await post(status, { organizationId: id }),
      await post(incidents, {}),
      await post(resolve, { incidentId: id }),
    ]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toMatch(/Verify it's you/);
    }
  });
});
