/**
 * A small organisation with one of everything, built once per suite: six members (one per role), and a real record of every kind a
 * route can be asked about. The generated authorization matrix (G1.02) and the cross-organisation attack suite (G1.03) both walk
 * every route against it, so a route that answers "not found" is answering about a record that does exist for somebody.
 *
 * The records belong to the Sales member, so Sales has "own" access, Management has the organisation, and everybody else is
 * whatever the permission model says. Everything is created through the real services where one exists.
 */
import { randomUUID } from "node:crypto";
import type { AuthContext } from "../../src/auth/context";
import { adminDb } from "../../src/db/adminClient";
import { createAttachmentRecord } from "../../src/repositories/attachments";
import { createDealMove } from "../../src/repositories/dealMoves";
import { createFileRecord } from "../../src/repositories/files";
import { getStorageDriver } from "../../src/storage/index";
import { buildStorageKey } from "../../src/storage/keys";
import { addComment } from "../../src/services/commentService";
import { createCompany } from "../../src/services/companyService";
import { createContact } from "../../src/services/contactService";
import { createCustomFieldDefinition } from "../../src/services/customFieldService";
import { createDeal } from "../../src/services/dealService";
import { createLead } from "../../src/services/leadService";
import { createInvoice, recordPayment } from "../../src/services/paymentService";
import { createRecurringService } from "../../src/services/recurringServiceService";
import { startExport } from "../../src/services/dataRunService";
import { createProposalReference } from "../../src/services/proposalService";
import { createTag } from "../../src/services/tagService";
import { createTask } from "../../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId, getServiceId } from "./fixtures";

/** Distinctive money so a response that leaks it is found by text search, in any of the usual formats. */
export const SENTINEL_DEAL_VALUE = 7654321;
export const SENTINEL_INVOICE_AMOUNT = 8123456.5;
export const SENTINEL_INVOICE_PREFIX = "INV-SENTINEL";
export const SENTINEL_PATTERNS = {
  dealValue: /7[,\s]?654[,\s]?321/,
  invoiceAmount: /8[,\s]?123[,\s]?456/,
  invoiceNumber: /INV-SENTINEL/,
};

export const ROLE_KEYS = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface World {
  organization: { id: string; slug: string };
  ctx: Record<RoleKey, AuthContext>;
  /** Real ids by the name a route uses for them (`leadId`, `dealId`, ...). Paths that reuse a name for a second kind use `overrides`. */
  ids: Record<string, string>;
  /** `"<path fragment>:<param>"` -> id, for a param name that means different records on different routes (`requestId`). */
  overrides: Record<string, string>;
  /** What could not be created, so a gap is visible instead of silently weakening the walk. */
  missing: string[];
  /** Records owned by Management (not Sales), for the "own records only" checks. */
  managementOwned: Record<string, string>;
  /** Strings that identify this organisation's data (ids, slug, names, emails): none of them may ever appear in another organisation's response. */
  markers: string[];
}

export async function buildWorld(prefix = "World"): Promise<World> {
  const organization = await createTestOrganization(prefix);
  const ctx = {} as Record<RoleKey, AuthContext>;
  for (const key of ROLE_KEYS) ctx[key] = await createTestContext(organization.id, key, `${prefix.toLowerCase()}.${key.toLowerCase()}`);
  const ids: Record<string, string> = { orgSlug: organization.slug };
  const overrides: Record<string, string> = {};
  const missing: string[] = [];
  const org = organization.id;
  const mgmt = ctx.MANAGEMENT;
  const sales = ctx.SALES;

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      missing.push(`${name}: ${(e as Error).message.replace(/\s+/g, " ").slice(-300)}`);
      return null;
    }
  }

  const company = await step("company", async () => (await createCompany(mgmt, { name: `${prefix} Co ${randomUUID().slice(0, 6)}`, email: "co@example.test", ownerMembershipId: sales.membershipId } as any)).company);
  if (company) ids.companyId = company.id;

  const contact = await step("contact", async () =>
    (await createContact(mgmt, { firstName: "Wanjiru", lastName: "Kamau", email: `w.${randomUUID().slice(0, 6)}@example.test`, phone: "+254700123456", companyId: company?.id, ownerMembershipId: sales.membershipId } as any)).contact,
  );
  if (contact) ids.contactId = contact.id;

  const lead = await step("lead", async () =>
    (await createLead(mgmt, { leadStatusId: await getLeadStatusId(org, "NEW"), companyId: company?.id, contactId: contact?.id, ownerMembershipId: sales.membershipId, temperature: "WARM" } as any, { skipDuplicateCheck: true })).lead,
  );
  if (lead) ids.leadId = lead.id;

  const deal = company
    ? await step("deal", async () => createDeal(mgmt, { companyId: company.id, primaryContactId: contact?.id, pipelineStageId: await getPipelineStageId(org, "SOLUTION_PRESENTED"), ownerMembershipId: sales.membershipId, value: SENTINEL_DEAL_VALUE } as any))
    : null;
  if (deal) ids.dealId = deal.id;

  const task = await step("task", () => createTask(mgmt, { title: "Call back", assigneeMembershipId: sales.membershipId, leadId: lead?.id, dueAt: new Date(Date.now() + 86400000).toISOString() } as any));
  if (task) ids.taskId = task.id;

  const comment = lead ? await step("comment", () => addComment(mgmt, "lead", lead.id, { body: "First note" })) : null;
  if (comment) ids.commentId = comment.id;

  const file = await step("file", async () => {
    const id = randomUUID();
    return createFileRecord({ id, organizationId: org, ownerMembershipId: sales.membershipId, purpose: "ATTACHMENT", name: "brief.pdf", sizeBytes: 12, mimeType: "application/pdf", storageKey: buildStorageKey(org, "attachment", id), status: "READY" } as any);
  });
  if (file) {
    ids.fileId = file.id;
    // The bytes exist, so downloads and content reads have something to serve.
    await step("file bytes", () => getStorageDriver().putObject(file.storageKey, Buffer.from("%PDF-1.4 walk"), { contentType: "application/pdf" }));
  }
  if (file && lead) {
    const attachment = await step("attachment", () => createAttachmentRecord({ organizationId: org, fileId: file.id, parent: "lead", parentId: lead.id, shared: false, uploadedByMembershipId: sales.membershipId } as any));
    if (attachment) ids.attachmentId = attachment.id;
  }

  // A member the walks may remove, deactivate or re-role without disturbing the six the suites act as.
  const spare = await step("spare member", () => createTestContext(org, "DELIVERY", `${prefix.toLowerCase()}.spare`));
  if (spare) ids.membershipId = spare.membershipId;

  const source = await adminDb.leadSource.findFirst({ where: { organizationId: org } });
  if (source) ids.entryId = source.id;

  const managementOwned: Record<string, string> = {};
  const mgmtLead = await step("management lead", async () =>
    (await createLead(mgmt, { leadStatusId: await getLeadStatusId(org, "NEW"), temperature: "COLD" } as any, { skipDuplicateCheck: true })).lead,
  );
  if (mgmtLead) managementOwned.leadId = mgmtLead.id;
  if (company) {
    const mgmtDeal = await step("management deal", async () =>
      createDeal(mgmt, { companyId: company.id, pipelineStageId: await getPipelineStageId(org, "SOLUTION_PRESENTED"), ownerMembershipId: mgmt.membershipId, value: 1111 } as any),
    );
    if (mgmtDeal) managementOwned.dealId = mgmtDeal.id;
  }
  const mgmtTask = await step("management task", () => createTask(mgmt, { title: "Management only", assigneeMembershipId: mgmt.membershipId } as any));
  if (mgmtTask) managementOwned.taskId = mgmtTask.id;

  const tag = await step("tag", () => createTag(mgmt, { name: `vip-${randomUUID().slice(0, 4)}` }));
  if (tag) ids.tagId = tag.id;

  const field = await step("custom field", () => createCustomFieldDefinition(mgmt, { entityType: "LEAD", key: `source_note_${randomUUID().slice(0, 4).replace(/-/g, "")}`, label: "Source note" } as any));
  if (field) ids.fieldId = field.id;

  const template = await step("email template", () => adminDb.emailTemplate.create({ data: { organizationId: org, name: "Intro", subject: "Hello", body: "Hi {{name}}", createdByMembershipId: mgmt.membershipId } }));
  if (template) ids.templateId = template.id;

  if (company) {
    const invoice = await step("invoice", () => createInvoice(mgmt, { number: `${SENTINEL_INVOICE_PREFIX}-${randomUUID().slice(0, 6)}`, amount: SENTINEL_INVOICE_AMOUNT, issuedOn: "2026-10-01", dueOn: "2026-10-31", companyId: company.id, sent: true }));
    if (invoice) {
      ids.invoiceId = invoice.id;
      const payment = await step("payment", () => recordPayment(mgmt, invoice.id, { amount: 1000, paidOn: "2026-10-05" }));
      const paymentId = (payment as any)?.payment?.id ?? (payment as any)?.id;
      if (paymentId) ids.paymentId = paymentId;
    }
    const service = await step("service", () => getServiceId(org, "CRM"));
    if (service) {
      const recurring = await step("recurring service", () =>
        createRecurringService(mgmt, { companyId: company.id, serviceId: service, startsOn: "2026-01-01", renewsOn: "2027-01-01", value: 1000, ownerMembershipId: sales.membershipId }),
      );
      if (recurring) {
        ids.serviceId = recurring.id;
        ids.companyServiceId = recurring.id;
      }
    }
  }

  if (deal) {
    const move = await step("deal move", async () =>
      createDealMove({ organizationId: org, dealId: deal.id, fromStageId: await getPipelineStageId(org, "SOLUTION_PRESENTED"), toStageId: await getPipelineStageId(org, "NEGOTIATION"), movedByMembershipId: sales.membershipId, undoExpiresAt: new Date(Date.now() + 3600000), previous: {} }),
    );
    if (move) ids.moveId = move.id;
  }

  const notification = await step("notification", () =>
    adminDb.notification.create({ data: { organizationId: org, membershipId: sales.membershipId, type: "LEAD_ASSIGNED", title: "A lead was assigned to you", body: "Open it to follow up." } as any }),
  );
  if (notification) ids.notificationId = notification.id;

  const rule = await step("website rule", () => adminDb.websiteLeadAssignmentRule.create({ data: { organizationId: org, name: "All website leads", assigneeMembershipId: sales.membershipId, sequence: 1 } as any }));
  if (rule) ids.ruleId = rule.id;

  const session = await step("migration session", () =>
    adminDb.importSession.create({ data: { organizationId: org, entity: "COMPANY", status: "DRAFT", step: "SOURCE", createdByMembershipId: mgmt.membershipId } as any }),
  );
  if (session) ids.sessionId = session.id;

  const preset = await step("migration preset", () => adminDb.importMappingPreset.create({ data: { organizationId: org, name: "Preset", entity: "COMPANY", mapping: {}, createdByMembershipId: mgmt.membershipId } as any }));
  if (preset) ids.presetId = preset.id;

  const dsr = contact
    ? await step("data subject request", () =>
        adminDb.dataSubjectRequest.create({ data: { organizationId: org, kind: "ACCESS", status: "OPEN", contactId: contact.id, subjectLabel: "Wanjiru Kamau", dueOn: new Date(Date.now() + 30 * 86400000), requestedByMembershipId: mgmt.membershipId } as any }),
      )
    : null;
  if (dsr) overrides["/privacy/requests/{requestId}:requestId"] = dsr.id;

  const comm = await step("conversation", () =>
    adminDb.communication.create({ data: { organizationId: org, channel: "EMAIL", direction: "INBOUND", subject: "Quote please", summary: "Please send a quote.", contactId: contact?.id, companyId: company?.id, counterpartyEmail: "buyer@example.test" } as any }),
  );
  if (comm) ids.conversationId = comm.id;

  if (deal) {
    const proposal = await step("proposal", () => createProposalReference(mgmt, deal.id, { proposalNumber: `P-${randomUUID().slice(0, 4)}`, amount: 1000 }));
    if (proposal) ids.proposalId = proposal.id;
  }

  if (lead) {
    const poolRequest = await step("lead pool request", () => adminDb.leadPoolRequest.create({ data: { organizationId: org, leadId: lead.id, requesterMembershipId: ctx.DELIVERY.membershipId, status: "PENDING" } }));
    if (poolRequest) overrides["/lead-pool/requests/{requestId}:requestId"] = poolRequest.id;
  }

  const run = await step("data run", () => startExport(mgmt, { entity: "LEAD" } as any));
  const runId = (run as any)?.id ?? (run as any)?.run?.id;
  if (runId) ids.runId = runId;

  const approval = await step("export approval", () =>
    adminDb.exportApproval.create({ data: { organizationId: org, entity: "LEAD", status: "PENDING", requestedByMembershipId: sales.membershipId, filters: {}, rowCount: 10 } as any }),
  );
  if (approval) ids.approvalId = approval.id;

  const job = await step("job", () => adminDb.backgroundJob.create({ data: { organizationId: org, type: "world.noop", status: "QUEUED", payload: {}, runAt: new Date(Date.now() + 86400000) } as any }));
  if (job) ids.jobId = job.id;

  const subscription = await step("push subscription", () =>
    adminDb.pushSubscription.create({ data: { organizationId: org, membershipId: sales.membershipId, endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, p256dh: "p", auth: "a" } as any }),
  );
  if (subscription) ids.subscriptionId = subscription.id;

  const markers = [organization.id, organization.slug, company?.name, contact?.email, ...Object.values(ids).filter((v) => v !== organization.slug), ...Object.values(overrides), ...ROLE_KEYS.flatMap((k) => [ctx[k].membershipId, ctx[k].userId])].filter(
    (v): v is string => typeof v === "string" && v.length > 5,
  );
  return { organization: { id: organization.id, slug: organization.slug }, ctx, ids, overrides, missing, markers, managementOwned };
}

/** The id to use for a dynamic segment, honouring a per-path override. */
export function idFor(world: World, routePath: string, name: string): string | undefined {
  for (const [key, value] of Object.entries(world.overrides)) {
    const [fragment, param] = key.split(":");
    if (param === name && routePath.includes(fragment!)) return value;
  }
  return world.ids[name];
}
