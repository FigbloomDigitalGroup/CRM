import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import "../src/jobs/definitions";
import { startExport } from "../src/services/dataRunService";
import { eraseContactData } from "../src/services/erasureService";
import { assertBulkExportAllowed } from "../src/services/exportService";
import {
  addEvidenceNote,
  confirmErasure,
  createDataSubjectRequest,
  decideExportApproval,
  fulfilAccessRequest,
  fulfilRectificationRequest,
  getAccessDownload,
  getDataSubjectRequest,
  getPrivacyOverview,
  listDataSubjectRequests,
  listExportApprovals,
  listOrganisationDataRequests,
  rejectDataSubjectRequest,
  requestExportApproval,
  runRetentionSweep,
  setLegalHold,
  submitOrganisationDataRequest,
  updateExportRights,
  updateRetention,
} from "../src/services/privacyService";
import { randomUUID } from "node:crypto";
import { getStorageDriver } from "../src/storage";
import { buildStorageKey } from "../src/storage/keys";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";
import { createCompanyRow } from "./helpers/stage3";
import type { AuthContext } from "../src/auth/context";

async function setup() {
  const org = await createTestOrganization("Privacy");
  const management = await createTestContext(org.id, "MANAGEMENT", "priv.mgmt");
  const management2 = await createTestContext(org.id, "MANAGEMENT", "priv.mgmt2");
  const sales = await createTestContext(org.id, "SALES", "priv.sales");
  return { org, management, management2, sales };
}

/** A role that has been granted the export permission, as the future role editor will allow (fabricated here, as the masking tests do). */
const withExport = (ctx: AuthContext, ...keys: string[]): AuthContext => ({ ...ctx, permissionKeys: [...ctx.permissionKeys, ...keys] });

describe("settings: export rights, retention, legal hold", () => {
  it("shows the documented defaults, and only Management can see or change anything", async () => {
    const { management, sales } = await setup();
    const overview = await getPrivacyOverview(management);
    expect(overview.exportRights).toMatchObject({ allowedRoleKeys: ["MANAGEMENT"], approvalThreshold: 500, approvalExpiryHours: 72 });
    const byKey = Object.fromEntries(overview.retention.map((r) => [r.key, r]));
    expect(byKey.signInEvents).toMatchObject({ value: 24, default: 24, unit: "months", isDefault: true });
    expect(byKey.importFiles).toMatchObject({ value: 90, unit: "days" });
    expect(byKey.archivedLeads).toMatchObject({ value: null, default: null });
    expect(overview.legalHold.active).toBe(false);
    expect(overview.requests).toMatchObject({ open: 0, overdue: 0 });
    for (const attempt of [getPrivacyOverview(sales), updateExportRights(sales, { approvalThreshold: 10 }), updateRetention(sales, {}), setLegalHold(sales, { active: true, reason: "x" }), submitOrganisationDataRequest(sales, { kind: "EXPORT" })]) {
      await expect(attempt).rejects.toThrow(ForbiddenError);
    }
  });

  it("validates and audits changes to export rights and retention", async () => {
    const { org, management } = await setup();
    const rights = await updateExportRights(management, { allowedRoleKeys: ["FINANCE"], approvalThreshold: 50, approvalExpiryHours: 24 });
    expect(rights).toEqual({ allowedRoleKeys: ["MANAGEMENT", "FINANCE"], approvalThreshold: 50, approvalExpiryHours: 24 });
    for (const bad of [{ approvalThreshold: 0 }, { approvalThreshold: 100_001 }, { approvalThreshold: 1.5 }, { approvalExpiryHours: 0 }, { allowedRoleKeys: ["WIZARD"] }]) {
      await expect(updateExportRights(management, bad as never)).rejects.toThrow(ValidationError);
    }
    const retention = await updateRetention(management, { signInEvents: 12, importFiles: "DEFAULT", archivedLeads: 36, syncQueue: null });
    expect(retention).toMatchObject({ signInEvents: 12, importFiles: 90, archivedLeads: 36, syncQueue: null });
    for (const bad of [{ signInEvents: 1 }, { importFiles: 99999 }, { nonsense: 5 }, { exportFiles: 0.5 }]) {
      await expect(updateRetention(management, bad as never)).rejects.toThrow(ValidationError);
    }
    expect((await getPrivacyOverview(management)).retention.find((r) => r.key === "signInEvents")).toMatchObject({ value: 12, isDefault: false });
    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { in: ["privacy.export_rights_updated", "privacy.retention_updated"] } } });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.action === "privacy.retention_updated")).toMatchObject({ previousValue: expect.objectContaining({ signInEvents: 24 }), newValue: expect.objectContaining({ signInEvents: 12 }) });
  });

  it("a legal hold needs a reason, is audited, and releases", async () => {
    const { org, management } = await setup();
    await expect(setLegalHold(management, { active: true })).rejects.toThrow(ValidationError);
    const hold = await setLegalHold(management, { active: true, reason: "Court order 2026/114" });
    expect(hold).toMatchObject({ active: true, reason: "Court order 2026/114", byMembershipId: management.membershipId });
    expect((await getPrivacyOverview(management)).legalHold.active).toBe(true);
    expect((await setLegalHold(management, { active: false })).active).toBe(false);
    expect((await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { startsWith: "privacy.legal_hold" } }, orderBy: { createdAt: "asc" } })).map((e) => e.action)).toEqual(["privacy.legal_hold_placed", "privacy.legal_hold_released"]);
  });
});

describe("bulk export rights and approvals", () => {
  async function leads(orgId: string, count: number) {
    const statusId = await getLeadStatusId(orgId);
    await adminDb.lead.createMany({ data: Array.from({ length: count }, () => ({ organizationId: orgId, leadStatusId: statusId })) });
  }

  it("lets Management export any size, and refuses a role that merely holds the export permission above the threshold", async () => {
    const { org, management, sales } = await setup();
    await updateExportRights(management, { approvalThreshold: 5 });
    await leads(org.id, 8);
    await expect(assertBulkExportAllowed(management, 100_000)).resolves.toBeUndefined();
    await expect(assertBulkExportAllowed(withExport(sales, "leads.export"), 5)).resolves.toBeUndefined();
    await expect(assertBulkExportAllowed(withExport(sales, "leads.export"), 6)).rejects.toThrow(ForbiddenError);
    await expect(startExport(withExport(sales, "leads.export"), { entity: "LEAD" })).rejects.toThrow(ForbiddenError);
    // Without the permission at all it is refused before size matters.
    await expect(startExport(sales, { entity: "LEAD" })).rejects.toThrow(ForbiddenError);
  });

  it("a role the organisation allows may export above the threshold directly", async () => {
    const { org, management, sales } = await setup();
    await updateExportRights(management, { approvalThreshold: 5, allowedRoleKeys: ["SALES"] });
    await leads(org.id, 8);
    const run = await startExport(withExport(sales, "leads.export"), { entity: "LEAD" });
    expect(run.status).toBe("QUEUED");
  });

  it("an approval is for one person, one kind of export and one use, decided by someone else, and it expires", async () => {
    const { org, management, management2, sales } = await setup();
    await updateExportRights(management, { approvalThreshold: 5, approvalExpiryHours: 2 });
    await leads(org.id, 8);
    const salesCtx = withExport(sales, "leads.export", "contacts.export");

    await expect(requestExportApproval(salesCtx, { entity: "SPACESHIP" })).rejects.toThrow(ValidationError);
    await expect(requestExportApproval(sales, { entity: "LEAD" })).rejects.toThrow(ForbiddenError);
    await expect(requestExportApproval(salesCtx, { entity: "LEAD", filters: { bogus: 1 } })).rejects.toThrow(ValidationError);
    const small = await requestExportApproval(salesCtx, { entity: "CONTACT" }).catch((e) => e);
    expect(small.issues?.[0]?.code).toBe("APPROVAL_NOT_NEEDED");

    const request = await requestExportApproval(salesCtx, { entity: "LEAD", reason: "Quarterly review with the board" });
    expect(request).toMatchObject({ status: "PENDING", rowCount: 8, entity: "LEAD" });
    // Not usable until decided.
    await expect(startExport(salesCtx, { entity: "LEAD", approvalId: request.id })).rejects.toThrow(ForbiddenError);

    // Who may decide: Management, and not the requester.
    await expect(decideExportApproval(sales, request.id, { approve: true })).rejects.toThrow(ForbiddenError);
    const selfRequest = await requestExportApproval(withExport(management, "leads.export"), { entity: "LEAD" });
    await expect(decideExportApproval(management, selfRequest.id, { approve: true })).rejects.toThrow(/Someone else/);
    expect((await decideExportApproval(management2, selfRequest.id, { approve: false, note: "Not needed" })).status).toBe("REJECTED");
    await expect(decideExportApproval(management2, request.id + "x", { approve: true })).rejects.toThrow(NotFoundError);

    const approved = await decideExportApproval(management, request.id, { approve: true, note: "Fine" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.expiresAt!.getTime() - approved.decidedAt!.getTime()).toBe(2 * 3_600_000);
    await expect(decideExportApproval(management2, request.id, { approve: true })).rejects.toThrow(/already approved/);

    // Wrong person and wrong kind are refused; the right one runs once.
    const other = withExport(await createTestContext(org.id, "SALES", "priv.sales2"), "leads.export");
    await expect(startExport(other, { entity: "LEAD", approvalId: request.id })).rejects.toThrow(ForbiddenError);
    await expect(startExport(salesCtx, { entity: "CONTACT", approvalId: request.id })).resolves.toBeDefined(); // 0 contacts: under the threshold, no approval spent
    expect((await listExportApprovals(salesCtx)).items[0]!.status).toBe("APPROVED");
    const run = await startExport(salesCtx, { entity: "LEAD", approvalId: request.id });
    expect(run.status).toBe("QUEUED");
    expect((await listExportApprovals(management, { status: "USED" })).items.map((a) => a.id)).toEqual([request.id]);
    await expect(startExport(salesCtx, { entity: "LEAD", approvalId: request.id })).rejects.toThrow(ForbiddenError);

    // An approval that has expired is no use.
    const second = await requestExportApproval(salesCtx, { entity: "LEAD" });
    await decideExportApproval(management, second.id, { approve: true });
    await adminDb.exportApproval.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(startExport(salesCtx, { entity: "LEAD", approvalId: second.id })).rejects.toThrow(ForbiddenError);
    expect((await listExportApprovals(management)).items.find((a) => a.id === second.id)!.status).toBe("EXPIRED");

    // An approval is for the size it was asked about: a bigger export needs a new one.
    const third = await requestExportApproval(salesCtx, { entity: "LEAD" });
    await decideExportApproval(management, third.id, { approve: true });
    await leads(org.id, 5);
    await expect(startExport(salesCtx, { entity: "LEAD", approvalId: third.id })).rejects.toThrow(ForbiddenError);

    // Each person sees only their own requests; the audit trail has every step.
    expect((await listExportApprovals(salesCtx)).items.every((a) => a.requestedByMembershipId === sales.membershipId)).toBe(true);
    expect((await listExportApprovals(other)).total).toBe(0);
    const actions = (await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { startsWith: "export_approval." } } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["export_approval.requested", "export_approval.approved", "export_approval.rejected"]));
  });

  it("an approval never works in another organisation", async () => {
    const a = await setup();
    const b = await setup();
    await updateExportRights(a.management, { approvalThreshold: 2 });
    await updateExportRights(b.management, { approvalThreshold: 2 });
    await leads(a.org.id, 4);
    await leads(b.org.id, 4);
    const request = await requestExportApproval(withExport(a.sales, "leads.export"), { entity: "LEAD" });
    await decideExportApproval(a.management, request.id, { approve: true });
    await expect(startExport(withExport(b.sales, "leads.export"), { entity: "LEAD", approvalId: request.id })).rejects.toThrow(ForbiddenError);
    await expect(decideExportApproval(b.management, request.id, { approve: true })).rejects.toThrow(NotFoundError);
  });
});

async function subject(orgId: string, owner: AuthContext) {
  const company = await createCompanyRow(orgId, { name: "Subject Employer Ltd" });
  const contact = await adminDb.contact.create({
    data: { organizationId: orgId, companyId: company.id, firstName: "Wanjiku", lastName: "Kariuki", email: "Wanjiku.Kariuki@personal.test", phone: "0722 555 987", jobTitle: "Buyer", notes: "Likes morning calls", ownerMembershipId: owner.membershipId },
  });
  return { company, contact };
}

describe("data-subject requests (FIG-1062)", () => {
  it("are filed with a due date (30 days by default), listed, flagged overdue, and given evidence notes that are stamped", async () => {
    const { management, sales } = await setup();
    const { contact } = await subject(management.organizationId, sales);
    const now = new Date("2026-11-01T09:00:00.000Z");
    const request = await createDataSubjectRequest(management, { kind: "ACCESS", contactId: contact.id, evidenceNotes: "ID checked: national ID seen at the shop" }, now);
    expect(request).toMatchObject({ kind: "ACCESS", status: "OPEN", subject: { contactId: contact.id, label: "Wanjiku Kariuki" }, daysLeft: 30, overdue: false });
    expect(request.dueOn.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(request.evidenceNotes).toMatch(/^\[2026-11-01 09:00 by [0-9a-f]{8}\] ID checked/);

    await expect(createDataSubjectRequest(management, { kind: "DELETE_IT", contactId: contact.id })).rejects.toThrow(ValidationError);
    await expect(createDataSubjectRequest(management, { kind: "ACCESS", contactId: "nope" })).rejects.toThrow(NotFoundError);
    await expect(createDataSubjectRequest(management, { kind: "ACCESS", contactId: contact.id, dueOn: "2020-01-01" }, now)).rejects.toThrow(/past/);

    const noted = await addEvidenceNote(management, request.id, "Told the requester by email on 2 Nov", new Date("2026-11-02T10:00:00.000Z"));
    expect(noted.status).toBe("IN_PROGRESS");
    expect(noted.evidenceNotes!.split("\n")).toHaveLength(2);
    await expect(addEvidenceNote(management, request.id, "  ")).rejects.toThrow(ValidationError);

    const late = await getDataSubjectRequest(management, request.id, new Date("2026-12-05T09:00:00.000Z"));
    expect(late).toMatchObject({ overdue: true, daysLeft: -4 });
    expect((await listDataSubjectRequests(management, { overdue: true }, new Date("2026-12-05T09:00:00.000Z"))).items).toHaveLength(1);
    expect((await listDataSubjectRequests(management, { overdue: true }, now)).items).toHaveLength(0);
    expect((await listDataSubjectRequests(management, { kind: "ERASURE" })).items).toHaveLength(0);
    expect((await getPrivacyOverview(management, new Date("2026-12-05T09:00:00.000Z"))).requests).toMatchObject({ open: 1, overdue: 1 });

    const rejected = await rejectDataSubjectRequest(management, request.id, "The requester could not be identified");
    expect(rejected.status).toBe("REJECTED");
    await expect(rejectDataSubjectRequest(management, request.id, "again")).rejects.toThrow(/already rejected/);
    await expect(addEvidenceNote(management, request.id, "late note")).resolves.toBeDefined(); // notes can still be added to the record of a closed request
  });

  it("access: collects what is held about the person into one CSV, with a download link, audited, and masks deal values by permission", async () => {
    const { org, management, sales } = await setup();
    const { company, contact } = await subject(org.id, sales);
    const statusId = await getLeadStatusId(org.id);
    await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: statusId, contactId: contact.id, notes: "Asked for a quote" } });
    const stage = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: org.id, isWon: false, isLost: false } });
    await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, primaryContactId: contact.id, pipelineStageId: stage.id, ownerMembershipId: sales.membershipId, value: 987654 } });
    await adminDb.activity.create({ data: { organizationId: org.id, contactId: contact.id, type: "CALL", subject: "Intro call", authorMembershipId: sales.membershipId } });
    await adminDb.communication.create({ data: { organizationId: org.id, contactId: contact.id, channel: "EMAIL", direction: "INBOUND", summary: "Hello from Wanjiku" } });

    const request = await createDataSubjectRequest(management, { kind: "ACCESS", contactId: contact.id });
    const { request: done, download } = await fulfilAccessRequest(management, request.id);
    expect(done).toMatchObject({ status: "COMPLETED", hasExport: true, result: { leads: 1, deals: 1, activities: 1, conversations: 1 } });
    const bytes = (await getStorageDriver().getObject(download.file.storageKey, 10_000_000)).toString("utf8");
    expect(bytes.split("\n")[0]).toBe("record_type,record_id,field,value");
    for (const expected of ["Wanjiku", "Kariuki", "Wanjiku.Kariuki@personal.test", "0722 555 987", "Likes morning calls", "Asked for a quote", "Intro call", "Hello from Wanjiku", "987654"]) expect(bytes).toContain(expected);
    // Downloadable again later, and that is audited.
    expect((await getAccessDownload(management, request.id)).file.id).toBe(download.file.id);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: { in: ["data_subject_request.access_fulfilled", "data_subject_request.access_downloaded"] } } })).toBe(2);
    await expect(fulfilAccessRequest(management, request.id)).rejects.toThrow(/already completed/);

    // A reader without the deal value permission gets everything but the value.
    const second = await createDataSubjectRequest(management, { kind: "ACCESS", contactId: contact.id });
    const limited = { ...management, permissionKeys: management.permissionKeys.filter((k) => k !== "deals.view.value") };
    const { download: d2 } = await fulfilAccessRequest(limited, second.id);
    expect((await getStorageDriver().getObject(d2.file.storageKey, 10_000_000)).toString("utf8")).not.toContain("987654");
  });

  it("rectification: applies the corrections to the record, audited by field name only", async () => {
    const { org, management, sales } = await setup();
    const { contact } = await subject(org.id, sales);
    const request = await createDataSubjectRequest(management, { kind: "RECTIFICATION", contactId: contact.id });
    await expect(fulfilRectificationRequest(management, request.id, {})).rejects.toThrow(/what to correct/);
    await expect(fulfilAccessRequest(management, request.id)).rejects.toThrow(/rectification request/);
    const done = await fulfilRectificationRequest(management, request.id, { firstName: "Wanjiru", phone: "0733 111 222" });
    expect(done).toMatchObject({ status: "COMPLETED", result: { corrected: ["firstName", "phone"] }, subject: { label: "Wanjiru Kariuki" } });
    expect(await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ firstName: "Wanjiru", phone: "0733 111 222" });
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "data_subject_request.rectified" } });
    expect(JSON.stringify(audit.metadata)).not.toContain("0733");
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, entityType: "Contact", entityId: contact.id } })).toBeGreaterThan(0);
  });

  it("erasure: two different Management members confirm; the first parks it, the second erases", async () => {
    const { org, management, management2, sales } = await setup();
    const { contact } = await subject(org.id, sales);
    const request = await createDataSubjectRequest(management, { kind: "ERASURE", contactId: contact.id });
    await expect(fulfilAccessRequest(management, request.id)).rejects.toThrow(/erasure request/);
    await expect(confirmErasure(sales, request.id)).rejects.toThrow(ForbiddenError);

    const first = await confirmErasure(management, request.id);
    expect(first).toMatchObject({ status: "AWAITING_SECOND_CONFIRMATION", confirmations: { first: { by: management.membershipId }, second: null } });
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(1);
    await expect(confirmErasure(management, request.id)).rejects.toThrow(/different Management member/);
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(1);

    const second = await confirmErasure(management2, request.id);
    expect(second).toMatchObject({ status: "COMPLETED", subject: { contactId: null, label: "[erased]" }, confirmations: { second: { by: management2.membershipId } } });
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(0);
    await expect(confirmErasure(management2, request.id)).rejects.toThrow(/already completed/);
    const trail = (await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { startsWith: "data_subject" }, entityType: { in: ["DataSubjectRequest", "Contact"] } }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(trail).toEqual([
      "data_subject_request.created",
      "data_subject_request.erasure_confirmed_first",
      "data_subject_request.erasure_confirmed_second",
      "data_subject.erased",
      "data_subject_request.erasure_completed",
    ]);
  });

  it("erasure removes the person from records, files, conversations, notifications and search, keeps the counts, and the audit trail holds no personal data", async () => {
    const { org, management, management2, sales } = await setup();
    const { company, contact } = await subject(org.id, sales);
    // A merged copy of the same person, and a record that points at them.
    const copy = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Wanjiku", lastName: "Kariuki", email: "w.kariuki@old-employer.test", mergedIntoId: contact.id, archivedAt: new Date() } });
    const statusId = await getLeadStatusId(org.id);
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: statusId, contactId: contact.id, companyId: company.id, notes: "Spoke to Wanjiku Kariuki about CCTV" } });
    const stage = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: org.id, isWon: false, isLost: false } });
    const deal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, primaryContactId: contact.id, pipelineStageId: stage.id, ownerMembershipId: sales.membershipId, value: 55000 } });
    await adminDb.invoice.create({ data: { organizationId: org.id, companyId: company.id, dealId: deal.id, number: "INV-ERASE-1", amount: 55000, issuedOn: new Date("2026-10-01"), dueOn: new Date("2026-10-20") } });
    await adminDb.activity.create({ data: { organizationId: org.id, contactId: contact.id, type: "CALL", subject: "Call with Wanjiku", authorMembershipId: sales.membershipId } });
    const task = await adminDb.task.create({ data: { organizationId: org.id, contactId: contact.id, title: "Call Wanjiku back", assigneeMembershipId: sales.membershipId, createdByMembershipId: sales.membershipId } });
    await adminDb.communication.create({ data: { organizationId: org.id, contactId: contact.id, channel: "EMAIL", direction: "INBOUND", summary: "Mail from Wanjiku" } });
    // A conversation from her address that was never linked to anything.
    await adminDb.communication.create({ data: { organizationId: org.id, needsLinking: true, channel: "EMAIL", direction: "INBOUND", summary: "Who is this?", counterpartyEmail: "wanjiku.kariuki@personal.test", counterpartyName: "Wanjiku Kariuki" } });
    await adminDb.communication.create({ data: { organizationId: org.id, needsLinking: true, channel: "EMAIL", direction: "INBOUND", summary: "Someone else", counterpartyEmail: "other@elsewhere.test" } });
    await adminDb.notification.create({ data: { organizationId: org.id, membershipId: sales.membershipId, type: "LEAD_ASSIGNED", title: "New lead: Wanjiku Kariuki", body: "Call 0722 555 987", entityType: "Lead", entityId: lead.id } });
    await adminDb.searchRecent.create({ data: { organizationId: org.id, membershipId: sales.membershipId, query: "wanjiku.kariuki@personal.test" } });
    await adminDb.searchRecent.create({ data: { organizationId: org.id, membershipId: sales.membershipId, query: "cctv" } });
    // A file attached to her record, bytes and all.
    const storageKey = buildStorageKey(org.id, "attachment", randomUUID());
    await getStorageDriver().putObject(storageKey, Buffer.from("her passport scan"), { contentType: "text/plain" });
    const file = await adminDb.file.create({ data: { organizationId: org.id, purpose: "ATTACHMENT", name: "passport.txt", sizeBytes: 17, mimeType: "text/plain", storageKey, status: "READY" } });
    await adminDb.attachment.create({ data: { organizationId: org.id, fileId: file.id, contactId: contact.id } });
    // History about her, in the audit trail and in a merge snapshot.
    await adminDb.auditEvent.create({ data: { organizationId: org.id, action: "contact.updated", entityType: "Contact", entityId: contact.id, previousValue: { firstName: "Wanjiku", email: "Wanjiku.Kariuki@personal.test" }, newValue: { phone: "0722 555 987" } } });
    await adminDb.mergeRecord.create({ data: { organizationId: org.id, entityType: "Contact", winnerId: contact.id, loserId: copy.id, undoExpiresAt: new Date(), snapshot: { loser: { firstName: "Wanjiku", email: "w.kariuki@old-employer.test" } } } });
    const before = {
      leads: await adminDb.lead.count({ where: { organizationId: org.id } }),
      deals: await adminDb.deal.count({ where: { organizationId: org.id } }),
      invoices: await adminDb.invoice.count({ where: { organizationId: org.id } }),
    };

    const request = await createDataSubjectRequest(management, { kind: "ERASURE", contactId: contact.id, evidenceNotes: "Requester verified by email and ID" });
    await confirmErasure(management, request.id);
    const done = await confirmErasure(management2, request.id);
    const result = done.result as { contactsErased: number; deleted: Record<string, number>; unlinked: Record<string, number>; scrubbed: Record<string, number>; reviewNeeded: Record<string, number>; proof: { emailHash: string; phoneHash: string } };

    // Gone: the person, their copy, and everything that was about them.
    expect(result.contactsErased).toBe(2);
    for (const model of ["contact", "activity"] as const) expect(await (adminDb[model] as never as { count: (a: unknown) => Promise<number> }).count({ where: { organizationId: org.id, ...(model === "contact" ? { id: { in: [contact.id, copy.id] } } : { contactId: contact.id }) } }), model).toBe(0);
    expect(await adminDb.task.count({ where: { id: task.id } })).toBe(0);
    expect(await adminDb.communication.count({ where: { organizationId: org.id, OR: [{ contactId: contact.id }, { counterpartyEmail: "wanjiku.kariuki@personal.test" }] } })).toBe(0);
    expect(await adminDb.communication.count({ where: { organizationId: org.id, counterpartyEmail: "other@elsewhere.test" } })).toBe(1);
    expect(await adminDb.notification.count({ where: { organizationId: org.id, title: { contains: "Wanjiku" } } })).toBe(0);
    expect((await adminDb.searchRecent.findMany({ where: { organizationId: org.id } })).map((s) => s.query)).toEqual(["cctv"]);
    expect(await adminDb.attachment.count({ where: { fileId: file.id } })).toBe(0);
    expect(await adminDb.file.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ status: "DELETED" });
    await expect(getStorageDriver().getObject(storageKey, 1000)).rejects.toThrow();
    // Kept: the records that merely referred to her, unlinked, and the money.
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(before.leads);
    expect(await adminDb.deal.count({ where: { organizationId: org.id } })).toBe(before.deals);
    expect(await adminDb.invoice.count({ where: { organizationId: org.id } })).toBe(before.invoices);
    expect(await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ contactId: null });
    expect(await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ primaryContactId: null });
    // Counts and proof.
    expect(result.deleted).toMatchObject({ activities: 1, tasks: 1, communications: 2, attachments: 1, notifications: 1, recentSearches: 1 });
    expect(result.unlinked).toMatchObject({ leads: 1, deals: 1 });
    expect(result.scrubbed.auditEvents).toBeGreaterThanOrEqual(1);
    expect(result.scrubbed.mergeRecords).toBe(1);
    expect(result.reviewNeeded.leads).toBe(1); // the lead's notes still name her: a person has to look
    expect(result.proof.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.proof.phoneHash).toMatch(/^[0-9a-f]{64}$/);

    // The audit trail and the request row hold nothing that identifies her.
    const everything = JSON.stringify([
      await adminDb.auditEvent.findMany({ where: { organizationId: org.id } }),
      await adminDb.dataSubjectRequest.findMany({ where: { organizationId: org.id } }),
      await adminDb.mergeRecord.findMany({ where: { organizationId: org.id } }),
    ]);
    for (const personal of ["Wanjiku.Kariuki@personal.test", "wanjiku.kariuki@personal.test", "w.kariuki@old-employer.test", "0722 555 987"]) expect(everything.toLowerCase(), personal).not.toContain(personal.toLowerCase());
    expect(everything).not.toContain("Wanjiku Kariuki");
    expect((await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "data_subject.erased" } })).actorMembershipId).toBe(management2.membershipId);
  });

  it("erasure is blocked by a legal hold, and the person's record is untouched", async () => {
    const { org, management, management2, sales } = await setup();
    const { contact } = await subject(org.id, sales);
    const request = await createDataSubjectRequest(management, { kind: "ERASURE", contactId: contact.id });
    await setLegalHold(management, { active: true, reason: "Litigation hold" });
    const err = await confirmErasure(management, request.id).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues[0].code).toBe("LEGAL_HOLD");
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(1);
    await setLegalHold(management, { active: false });
    await confirmErasure(management, request.id);
    await setLegalHold(management2, { active: true, reason: "Held again before the second confirmation" });
    await expect(confirmErasure(management2, request.id)).rejects.toThrow(/legal hold/);
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(1);
  });

  it("erasing never reaches into another organisation, even by contact id", async () => {
    const a = await setup();
    const b = await setup();
    const { contact } = await subject(b.org.id, b.sales);
    await expect(eraseContactData({ organizationId: a.org.id, contactId: contact.id })).rejects.toThrow(NotFoundError);
    await expect(createDataSubjectRequest(a.management, { kind: "ERASURE", contactId: contact.id })).rejects.toThrow(NotFoundError);
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(1);
    // A request in A is invisible to B's manager.
    const own = await subject(a.org.id, a.sales);
    const request = await createDataSubjectRequest(a.management, { kind: "ACCESS", contactId: own.contact.id });
    await expect(getDataSubjectRequest(b.management, request.id)).rejects.toThrow(NotFoundError);
    await expect(confirmErasure(b.management, request.id)).rejects.toThrow(NotFoundError);
    expect((await listDataSubjectRequests(b.management)).items).toHaveLength(0);
    const seen = await withOrgContext(b.org.id, async (tx) => ({ requests: await tx.dataSubjectRequest.count(), approvals: await tx.exportApproval.count() }));
    expect(seen).toEqual({ requests: 0, approvals: 0 });
  });

  it("only Management files, reads or decides requests", async () => {
    const { org, management, sales } = await setup();
    const { contact } = await subject(org.id, sales);
    const request = await createDataSubjectRequest(management, { kind: "ACCESS", contactId: contact.id });
    for (const role of ["SALES", "DELIVERY", "FINANCE"] as const) {
      const ctx = await createTestContext(org.id, role, `priv.${role}`);
      for (const attempt of [createDataSubjectRequest(ctx, { kind: "ACCESS", contactId: contact.id }), listDataSubjectRequests(ctx), getDataSubjectRequest(ctx, request.id), addEvidenceNote(ctx, request.id, "x"), fulfilAccessRequest(ctx, request.id), confirmErasure(ctx, request.id), rejectDataSubjectRequest(ctx, request.id, "x"), getAccessDownload(ctx, request.id)]) {
        await expect(attempt, role).rejects.toThrow(ForbiddenError);
      }
    }
  });
});

describe("retention (the daily job)", () => {
  const old = (days: number) => new Date(Date.now() - days * 86_400_000);

  async function seedOld(orgId: string) {
    const user = await adminDb.user.create({ data: { email: `ret.${Math.random().toString(36).slice(2)}@example.test`, name: "Retention" } });
    await adminDb.signInEvent.createMany({
      data: [
        { organizationId: orgId, userId: user.id, email: user.email, outcome: "SUCCESS", createdAt: old(800) },
        { organizationId: orgId, userId: user.id, email: user.email, outcome: "SUCCESS", createdAt: old(10) },
      ],
    });
    const mk = async (purpose: "IMPORT" | "EXPORT", ageDays: number) => {
      const key = buildStorageKey(orgId, purpose.toLowerCase(), randomUUID());
      await getStorageDriver().putObject(key, Buffer.from("a,b\n1,2\n"), { contentType: "text/csv" });
      return adminDb.file.create({ data: { organizationId: orgId, purpose, name: `${purpose}.csv`, sizeBytes: 8, mimeType: "text/csv", storageKey: key, status: "READY", createdAt: old(ageDays) } });
    };
    const files = { oldImport: await mk("IMPORT", 200), newImport: await mk("IMPORT", 5), oldExport: await mk("EXPORT", 60), newExport: await mk("EXPORT", 2) };
    const membership = (await adminDb.membership.findFirstOrThrow({ where: { organizationId: orgId } })).id;
    await adminDb.syncMutation.createMany({ data: [{ organizationId: orgId, membershipId: membership, clientId: "old-mutation-0001", kind: "TASK_CREATE", status: "APPLIED", requestHash: "x", createdAt: old(200) }, { organizationId: orgId, membershipId: membership, clientId: "new-mutation-0001", kind: "TASK_CREATE", status: "APPLIED", requestHash: "y", createdAt: old(3) }] });
    await adminDb.automationRun.createMany({ data: [{ organizationId: orgId, ruleKey: "STALLED_DEAL_ALERT", triggerKey: "old", status: "APPLIED", result: "x", createdAt: old(500) }, { organizationId: orgId, ruleKey: "STALLED_DEAL_ALERT", triggerKey: "new", status: "APPLIED", result: "y", createdAt: old(5) }] });
    const statusId = await getLeadStatusId(orgId);
    const archivedOld = await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: statusId, archivedAt: old(900) } });
    const archivedRecent = await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: statusId, archivedAt: old(30) } });
    const live = await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: statusId } });
    return { files, archivedOld, archivedRecent, live };
  }

  it("purges what is older than each period, keeps the rest, and audits the counts", async () => {
    const { org, management } = await setup();
    const seeded = await seedOld(org.id);
    await updateRetention(management, { archivedLeads: 24 });
    const result = await runRetentionSweep(org.id);
    expect(result.purged).toMatchObject({ signInEvents: 1, importFiles: 1, exportFiles: 1, syncQueue: 1, automationRuns: 1, archivedLeads: 1 });

    expect(await adminDb.signInEvent.count({ where: { organizationId: org.id } })).toBe(1);
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: seeded.files.oldImport.id } })).status).toBe("DELETED");
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: seeded.files.oldExport.id } })).purgedAt).not.toBeNull();
    await expect(getStorageDriver().getObject(seeded.files.oldImport.storageKey, 1000)).rejects.toThrow();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: seeded.files.newImport.id } })).status).toBe("READY");
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: seeded.files.newExport.id } })).status).toBe("READY");
    expect((await adminDb.syncMutation.findMany({ where: { organizationId: org.id } })).map((m) => m.clientId)).toEqual(["new-mutation-0001"]);
    expect((await adminDb.automationRun.findMany({ where: { organizationId: org.id } })).map((m) => m.triggerKey)).toEqual(["new"]);
    expect(await adminDb.lead.count({ where: { id: seeded.archivedOld.id } })).toBe(0);
    expect(await adminDb.lead.count({ where: { id: { in: [seeded.archivedRecent.id, seeded.live.id] } } })).toBe(2);
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "retention.purged" } });
    expect(audit.metadata).toMatchObject({ signInEvents: 1, archivedLeads: 1 });

    // Safe to repeat: nothing more to purge, and no second audit entry for nothing.
    expect(Object.values((await runRetentionSweep(org.id)).purged).every((n) => n === 0)).toBe(true);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "retention.purged" } })).toBe(1);
  });

  it("keeps data the organisation chose to keep, and leaves an import file a running migration needs", async () => {
    const { org, management } = await setup();
    const seeded = await seedOld(org.id);
    await updateRetention(management, { signInEvents: null, exportFiles: null, automationRuns: null });
    await adminDb.importSession.create({ data: { organizationId: org.id, entity: "COMPANY", status: "IMPORTING", step: "IMPORT", fileId: seeded.files.oldImport.id } });
    const result = await runRetentionSweep(org.id);
    expect(result.purged.signInEvents).toBeUndefined();
    expect(result.purged.exportFiles).toBeUndefined();
    expect(result.purged.importFiles).toBe(0);
    expect(await adminDb.signInEvent.count({ where: { organizationId: org.id } })).toBe(2);
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: seeded.files.oldImport.id } })).status).toBe("READY");
  });

  it("does nothing at all under a legal hold, and resumes when it is released", async () => {
    const { org, management } = await setup();
    await seedOld(org.id);
    await setLegalHold(management, { active: true, reason: "Regulator inquiry" });
    expect(await runRetentionSweep(org.id)).toEqual({ skipped: "LEGAL_HOLD", purged: {} });
    expect(await adminDb.signInEvent.count({ where: { organizationId: org.id } })).toBe(2);
    expect(await adminDb.syncMutation.count({ where: { organizationId: org.id } })).toBe(2);
    await setLegalHold(management, { active: false });
    expect((await runRetentionSweep(org.id)).purged.signInEvents).toBe(1);
  });

  it("only ever touches its own organisation, and runs as a job through the framework", async () => {
    const a = await setup();
    const b = await setup();
    await seedOld(a.org.id);
    await seedOld(b.org.id);
    const run = await enqueueAndRunNow({ organizationId: a.org.id, type: "privacy.retention" });
    expect(run.outcome).toBe("succeeded");
    expect(run.job?.result).toMatchObject({ purged: { signInEvents: 1 } });
    expect(await adminDb.signInEvent.count({ where: { organizationId: a.org.id } })).toBe(1);
    expect(await adminDb.signInEvent.count({ where: { organizationId: b.org.id } })).toBe(2);
  });
});

describe("organisation-level requests (handed to the platform queue)", () => {
  it("are recorded and audited, once per kind, and nothing is exported or deleted by them", async () => {
    const { org, management } = await setup();
    const request = await submitOrganisationDataRequest(management, { kind: "EXPORT", note: "We are changing systems" });
    expect(request).toMatchObject({ kind: "EXPORT", status: "SUBMITTED_TO_PLATFORM", requestedByMembershipId: management.membershipId });
    await expect(submitOrganisationDataRequest(management, { kind: "EXPORT" })).rejects.toThrow(/already with the platform team/);
    await expect(submitOrganisationDataRequest(management, { kind: "BURN" })).rejects.toThrow(ValidationError);
    await submitOrganisationDataRequest(management, { kind: "DELETE" });
    expect((await listOrganisationDataRequests(management)).items.map((r) => r.kind)).toEqual(["EXPORT", "DELETE"]);
    expect((await getPrivacyOverview(management)).organisationRequests).toHaveLength(2);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "organization.data_request_submitted" } })).toBe(2);
    expect(await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ status: "ACTIVE" });
    // Another organisation has its own, separate queue.
    const other = await setup();
    expect((await listOrganisationDataRequests(other.management)).items).toHaveLength(0);
  });
});
