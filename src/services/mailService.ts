import type { MailDraft, OAuthConnection } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { canSeeDealValue, canSeeMargin } from "../auth/masking";
import { adminDb } from "../db/adminClient";
import { getMailProvider, type OutgoingMail, type ProviderMail } from "../integrations/mail/types";
import { OAuthTransientError, type OAuthProviderKey } from "../integrations/oauth/types";
import { enqueueJobFor } from "../jobs/runner";
import { createCommunication as createCommunicationRecord, findCommunicationByReference } from "../repositories/communications";
import { findContactByEmail } from "../repositories/contacts";
import { recordAuditEvent } from "../repositories/auditEvents";
import { touchDealActivity } from "../repositories/deals";
import { getAttachmentById } from "../repositories/attachments";
import { resolveActiveMembership } from "../repositories/memberships";
import { assertAttachmentRecordAccess } from "./attachmentService";
import { getDeal } from "./dealService";
import { readFileContent } from "./fileService";
import {
  ConnectionUnavailableError,
  findConnectionFor,
  getAccessToken,
  getUsableConnection,
  recordSyncResult,
} from "./oauthConnectionService";
import { assertCanAccessLinkedRecords, type LinkedRecordIds } from "./recordAccess";
import { rescoreCompanyQuietly, rescoreLeadQuietly } from "./scoreEngine";

/**
 * Mail through a connected Google or Microsoft mailbox (FIG-807, backend of the Mail workspace F6.22).
 *
 *  - Sync pulls messages to and from KNOWN contacts into Communications on the right timelines (matched by email address).
 *    Everything else is ignored, and so is anything touching an address on the person's exclusion list. A message already
 *    stored (a BCC copy, a colleague's sync, a message the CRM itself sent) is never stored twice.
 *    The one exception is the shared organisation mailbox: unmatched inbound mail waits in Needs linking (FIG-1053).
 *  - Send and reply go through the connected mailbox, so the message is in the person's Sent folder. A send claims its draft row
 *    first (DRAFT/SCHEDULED to SENDING), so a repeated request cannot send twice; the message is logged once on the record
 *    timeline (which is what Conversations reads). Nothing is logged for a send that failed.
 *  - Attachments are CRM attachments: each must pass the same record access check as opening it (organisation, record, deal
 *    value visibility), and the bytes are read through the file service.
 *  - Scheduled send runs on the job framework (`mail.send_scheduled`) as the draft's owner, with the owner's current permissions.
 */
export const MAX_RECIPIENTS = 20;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_SUMMARY = 5000;
const SYNC_BATCH = 100;
const FIRST_SYNC_DAYS = 30;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export interface MailSettings {
  syncEnabled: boolean;
  excludedAddresses: string[];
}

export function readMailSettings(connection: Pick<OAuthConnection, "settings">): MailSettings {
  const s = (connection.settings ?? {}) as Record<string, unknown>;
  return {
    syncEnabled: s.syncEnabled !== false,
    excludedAddresses: Array.isArray(s.excludedAddresses) ? s.excludedAddresses.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()) : [],
  };
}

/** `a@b.com` matches that address, `@b.com` and `b.com` match the whole domain. */
export function isExcluded(address: string, excluded: string[]): boolean {
  const a = address.toLowerCase();
  const domain = a.split("@")[1] ?? "";
  return excluded.some((e) => e === a || e === domain || e === `@${domain}`);
}

function parseAddresses(input: unknown, path: string, required: boolean): string[] {
  const list = Array.isArray(input) ? input : [];
  const cleaned = [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const bad = cleaned.filter((a) => !EMAIL.test(a));
  if (bad.length) throw new ValidationError("Some email addresses are not valid.", [{ path, message: `Check: ${bad.join(", ")}` }]);
  if (required && cleaned.length === 0) throw new ValidationError("Add at least one recipient.", [{ path, message: "Add a recipient." }]);
  return cleaned;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** A copy of a message the CRM sent itself: Outlook gives no id back from sendMail, so match on subject, recipients and time. */
async function isCrmSentCopy(organizationId: string, connection: OAuthConnection, mail: ProviderMail): Promise<boolean> {
  const window = 10 * 60_000;
  const candidates = await adminDb.mailDraft.findMany({
    where: {
      organizationId,
      status: "SENT",
      OR: [{ externalMessageId: mail.id }, { connectionId: connection.id, subject: mail.subject, sentAt: { gte: new Date(mail.receivedAt.getTime() - window), lte: new Date(mail.receivedAt.getTime() + window) } }],
    },
    select: { externalMessageId: true, toAddresses: true },
  });
  return candidates.some((d) => d.externalMessageId === mail.id || d.toAddresses.some((a) => mail.to.includes(a)));
}

export async function syncMailbox(organizationId: string, connectionId: string) {
  const result = { fetched: 0, logged: 0, ignored: 0, excluded: 0, duplicates: 0, needsLinking: 0 };
  const connection = await getUsableConnection(organizationId, connectionId);
  if (connection.kind !== "EMAIL") throw new ValidationError("That is not a mailbox connection.");
  const settings = readMailSettings(connection);
  if (!settings.syncEnabled) return { ...result, skipped: "SYNC_OFF" as const };
  try {
    const { token } = await getAccessToken(organizationId, connectionId);
    const provider = await getMailProvider(connection.provider as OAuthProviderKey);
    const since = connection.syncCursor ? new Date(new Date(connection.syncCursor).getTime() - 60_000) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    const messages = await provider.listMessages(token, { since, limit: SYNC_BATCH });
    result.fetched = messages.length;
    const owner = connection.membershipId;
    let newest = connection.syncCursor ? new Date(connection.syncCursor) : since;
    for (const mail of messages) {
      if (mail.receivedAt > newest) newest = mail.receivedAt;
      const counterparties = (mail.sent ? [...mail.to, ...mail.cc] : [mail.from.email]).filter((a) => a && a !== connection.accountEmail);
      // Private mail: any address on the exclusion list, on either side, keeps the whole message out.
      if ([mail.from.email, ...mail.to, ...mail.cc].some((a) => isExcluded(a, settings.excludedAddresses))) {
        result.excluded += 1;
        continue;
      }
      const references = [mail.internetMessageId, `mail:${connection.provider}:${mail.id}`].filter((x): x is string => !!x);
      let duplicate = false;
      for (const reference of references) if (await findCommunicationByReference(organizationId, reference)) duplicate = true;
      if (duplicate || (mail.sent && (await isCrmSentCopy(organizationId, connection, mail)))) {
        result.duplicates += 1;
        continue;
      }
      let matched: Awaited<ReturnType<typeof findContactByEmail>> = null;
      for (const address of counterparties) {
        matched = await findContactByEmail(organizationId, address);
        if (matched) break;
      }
      const summary = (mail.bodyText.trim() || "(no message body)").slice(0, MAX_SUMMARY);
      const reference = mail.internetMessageId ?? `mail:${connection.provider}:${mail.id}`;
      if (matched) {
        await createCommunicationRecord({
          organizationId,
          channel: "EMAIL",
          direction: mail.sent ? "OUTBOUND" : "INBOUND",
          occurredAt: mail.receivedAt,
          subject: mail.subject,
          summary,
          externalReference: reference,
          authorMembershipId: owner ?? undefined,
          contactId: matched.id,
          companyId: matched.companyId ?? undefined,
        });
        result.logged += 1;
      } else if (owner === null && !mail.sent) {
        // The shared organisation mailbox: nobody owns it, so unknown senders wait to be linked rather than vanish.
        await createCommunicationRecord({
          organizationId,
          channel: "EMAIL",
          direction: "INBOUND",
          occurredAt: mail.receivedAt,
          subject: mail.subject,
          summary,
          externalReference: reference,
          needsLinking: true,
          counterpartyEmail: mail.from.email,
          counterpartyName: mail.from.name ?? undefined,
        });
        result.logged += 1;
        result.needsLinking += 1;
      } else {
        result.ignored += 1;
      }
    }
    await recordSyncResult(connectionId, { ok: true, cursor: newest.toISOString() });
    return result;
  } catch (err) {
    if (err instanceof ConnectionUnavailableError) throw err;
    await recordSyncResult(connectionId, { ok: false, message: err instanceof OAuthTransientError ? err.message : "The mailbox could not be read. It will be tried again." });
    throw err;
  }
}

/** Every mailbox connection that should sync for this organisation (the scheduled job). */
export async function syncAllMailboxes(organizationId: string) {
  const rows = await adminDb.oAuthConnection.findMany({ where: { organizationId, kind: "EMAIL", status: "CONNECTED", revokedAt: null }, select: { id: true } });
  const totals = { connections: rows.length, logged: 0, failed: 0 };
  for (const r of rows) {
    try {
      totals.logged += (await syncMailbox(organizationId, r.id)).logged;
    } catch {
      totals.failed += 1;
    }
  }
  return totals;
}

/** "Sync now" for the person's own mailbox or calendar: queued on the job framework, not run inside the request. */
export async function requestConnectionSync(ctx: AuthContext, connectionId: string) {
  const connection = await getUsableConnection(ctx.organizationId, connectionId);
  if (connection.membershipId !== ctx.membershipId && !hasPermission(ctx, "configuration.manage")) throw new NotFoundError("Connection", connectionId);
  const type = connection.kind === "EMAIL" ? "mail.sync" : "calendar.sync";
  const job = await enqueueJobFor({ organizationId: ctx.organizationId, type, payload: { connectionId }, createdByMembershipId: ctx.membershipId });
  return { queued: true, jobId: job.id };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface DraftInput extends LinkedRecordIds {
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  replyToCommunicationId?: string;
  attachmentIds?: string[];
}

const draftView = (d: MailDraft) => ({
  id: d.id,
  to: d.toAddresses,
  cc: d.ccAddresses,
  subject: d.subject,
  body: d.body,
  status: d.status,
  scheduledAt: d.scheduledAt,
  sentAt: d.sentAt,
  communicationId: d.communicationId,
  replyToCommunicationId: d.replyToCommunicationId,
  companyId: d.companyId,
  contactId: d.contactId,
  leadId: d.leadId,
  dealId: d.dealId,
  attachmentIds: d.attachmentIds,
  lastError: d.lastError,
  updatedAt: d.updatedAt,
});

async function resolveReply(ctx: AuthContext, communicationId: string | undefined) {
  if (!communicationId) return null;
  const comm = await adminDb.communication.findFirst({ where: { id: communicationId, organizationId: ctx.organizationId, channel: "EMAIL" } });
  if (!comm) throw new NotFoundError("Message", communicationId);
  // The reply is allowed only where the person may open the record the message hangs off.
  await assertCanAccessLinkedRecords(ctx, { companyId: comm.companyId ?? undefined, contactId: comm.contactId ?? undefined, leadId: comm.leadId ?? undefined, dealId: comm.dealId ?? undefined });
  return comm;
}

async function checkAttachments(ctx: AuthContext, ids: string[]) {
  if (ids.length > 10) throw new ValidationError("At most 10 attachments.", [{ path: "attachmentIds", message: "Send fewer files." }]);
  let total = 0;
  for (const id of ids) {
    await assertAttachmentRecordAccess(ctx, id); // 404 when it is another organisation's or hidden from this role
    const attachment = await getAttachmentById(ctx.organizationId, id);
    if (!attachment) throw new NotFoundError("Attachment", id);
    if (attachment.file.status !== "READY") throw new ValidationError("A file is not ready yet.", [{ path: "attachmentIds", message: `${attachment.file.name} is not ready.` }]);
    total += attachment.file.sizeBytes;
  }
  if (total > MAX_ATTACHMENT_BYTES) throw new ValidationError("The attachments are too large to send.", [{ path: "attachmentIds", message: "Keep the files under 10 MB in total." }]);
}

async function validateDraftFields(ctx: AuthContext, input: DraftInput) {
  requirePermission(ctx, "communications.create");
  const links: LinkedRecordIds = { companyId: input.companyId, contactId: input.contactId, leadId: input.leadId, dealId: input.dealId };
  await assertCanAccessLinkedRecords(ctx, links, { requireWritable: true });
  await resolveReply(ctx, input.replyToCommunicationId);
  if (input.attachmentIds?.length) await checkAttachments(ctx, input.attachmentIds);
  return links;
}

export async function createDraft(ctx: AuthContext, input: DraftInput) {
  const links = await validateDraftFields(ctx, input);
  const draft = await adminDb.mailDraft.create({
    data: {
      organizationId: ctx.organizationId,
      membershipId: ctx.membershipId,
      toAddresses: parseAddresses(input.to, "to", false),
      ccAddresses: parseAddresses(input.cc, "cc", false),
      subject: (input.subject ?? "").slice(0, 300),
      body: input.body ?? "",
      replyToCommunicationId: input.replyToCommunicationId ?? null,
      attachmentIds: input.attachmentIds ?? [],
      ...links,
    },
  });
  return draftView(draft);
}

async function loadOwnDraft(ctx: AuthContext, id: string): Promise<MailDraft> {
  const draft = await adminDb.mailDraft.findFirst({ where: { id, organizationId: ctx.organizationId, membershipId: ctx.membershipId } });
  if (!draft) throw new NotFoundError("Draft", id);
  return draft;
}

export async function getDraft(ctx: AuthContext, id: string) {
  return draftView(await loadOwnDraft(ctx, id));
}

export async function listDrafts(ctx: AuthContext, status?: string) {
  requirePermission(ctx, "communications.view");
  const rows = await adminDb.mailDraft.findMany({
    where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return { items: rows.map(draftView) };
}

export async function updateDraft(ctx: AuthContext, id: string, input: DraftInput) {
  const existing = await loadOwnDraft(ctx, id);
  if (existing.status !== "DRAFT" && existing.status !== "FAILED") throw new ValidationError("This message is already queued or sent.", [{ path: "status", message: "Only a draft can be edited." }]);
  const merged: DraftInput = {
    companyId: input.companyId ?? existing.companyId ?? undefined,
    contactId: input.contactId ?? existing.contactId ?? undefined,
    leadId: input.leadId ?? existing.leadId ?? undefined,
    dealId: input.dealId ?? existing.dealId ?? undefined,
    replyToCommunicationId: input.replyToCommunicationId ?? existing.replyToCommunicationId ?? undefined,
    attachmentIds: input.attachmentIds ?? existing.attachmentIds,
  };
  const links = await validateDraftFields(ctx, merged);
  const updated = await adminDb.mailDraft.update({
    where: { id },
    data: {
      ...(input.to ? { toAddresses: parseAddresses(input.to, "to", false) } : {}),
      ...(input.cc ? { ccAddresses: parseAddresses(input.cc, "cc", false) } : {}),
      ...(input.subject !== undefined ? { subject: input.subject.slice(0, 300) } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      replyToCommunicationId: merged.replyToCommunicationId ?? null,
      attachmentIds: merged.attachmentIds ?? [],
      ...links,
      status: "DRAFT",
      lastError: null,
    },
  });
  return draftView(updated);
}

export async function deleteDraft(ctx: AuthContext, id: string) {
  const existing = await loadOwnDraft(ctx, id);
  if (existing.status === "SENDING" || existing.status === "SENT") throw new ValidationError("This message was already sent.", [{ path: "status", message: "A sent message cannot be deleted here." }]);
  await adminDb.mailDraft.delete({ where: { id } });
  return { id };
}

// ---------------------------------------------------------------------------
// Send, reply, schedule
// ---------------------------------------------------------------------------

/** Takes the draft for sending exactly once; null when another request already has it or it is not sendable. */
async function claim(draft: MailDraft, from: ("DRAFT" | "SCHEDULED" | "FAILED")[]): Promise<MailDraft | null> {
  const taken = await adminDb.mailDraft.updateMany({ where: { id: draft.id, status: { in: from } }, data: { status: "SENDING", lastError: null } });
  return taken.count === 1 ? adminDb.mailDraft.findUniqueOrThrow({ where: { id: draft.id } }) : null;
}

async function loadAttachments(ctx: AuthContext, ids: string[]): Promise<OutgoingMail["attachments"]> {
  const out: OutgoingMail["attachments"] = [];
  for (const id of ids) {
    await assertAttachmentRecordAccess(ctx, id);
    const attachment = await getAttachmentById(ctx.organizationId, id);
    if (!attachment) throw new NotFoundError("Attachment", id);
    const { file, data } = await readFileContent(ctx, attachment.fileId);
    out.push({ name: file.name, mimeType: file.mimeType, content: Buffer.from(data) });
  }
  return out;
}

async function performSend(ctx: AuthContext, claimed: MailDraft) {
  const fail = async (message: string, status: "FAILED" | "DRAFT" = "FAILED") => {
    await adminDb.mailDraft.update({ where: { id: claimed.id }, data: { status, lastError: message.slice(0, 300) } });
  };
  try {
    requirePermission(ctx, "communications.create");
    const links: LinkedRecordIds = { companyId: claimed.companyId ?? undefined, contactId: claimed.contactId ?? undefined, leadId: claimed.leadId ?? undefined, dealId: claimed.dealId ?? undefined };
    await assertCanAccessLinkedRecords(ctx, links, { requireWritable: true });
    const to = parseAddresses(claimed.toAddresses, "to", true);
    if (to.length + claimed.ccAddresses.length > MAX_RECIPIENTS) throw new ValidationError(`At most ${MAX_RECIPIENTS} recipients.`, [{ path: "to", message: "Too many recipients." }]);
    if (!claimed.subject.trim()) throw new ValidationError("A subject is required.", [{ path: "subject", message: "A subject is required." }]);

    const connection = await findConnectionFor(ctx.organizationId, ctx.membershipId, "EMAIL");
    if (!connection) throw new ConnectionUnavailableError("DISCONNECTED", "No mailbox is connected. Connect Google or Microsoft mail in Settings to send from Figbloom.");
    const { token } = await getAccessToken(ctx.organizationId, connection.id);
    const reply = await resolveReply(ctx, claimed.replyToCommunicationId ?? undefined);
    const attachments = await loadAttachments(ctx, claimed.attachmentIds);
    const provider = await getMailProvider(connection.provider as OAuthProviderKey);
    const sent = await provider.sendMessage(token, {
      to,
      cc: claimed.ccAddresses,
      subject: claimed.subject,
      body: claimed.body,
      attachments,
      inReplyTo: reply?.externalReference ? { externalId: reply.externalReference, internetMessageId: reply.externalReference.startsWith("<") ? reply.externalReference : null } : undefined,
    });

    const reference = sent.internetMessageId ?? `mail:${connection.provider}:${sent.externalId}`;
    // The send is done: from here the message is logged exactly once, and a failure to log must not make it look unsent.
    const communication = await createCommunicationRecord({
      organizationId: ctx.organizationId,
      channel: "EMAIL",
      direction: "OUTBOUND",
      subject: claimed.subject,
      summary: claimed.body.slice(0, MAX_SUMMARY) || "(no message body)",
      externalReference: reference,
      authorMembershipId: ctx.membershipId,
      counterpartyEmail: to[0],
      ...links,
    });
    const done = await adminDb.mailDraft.update({
      where: { id: claimed.id },
      data: { status: "SENT", sentAt: new Date(), communicationId: communication.id, connectionId: connection.id, externalMessageId: sent.externalId, lastError: null },
    });
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "communication.logged",
      entityType: "Communication",
      entityId: communication.id,
      newValue: { channel: "EMAIL", direction: "OUTBOUND", subject: claimed.subject, to, via: connection.provider, ...links },
    });
    await rescoreLeadQuietly(ctx.organizationId, links.leadId);
    if (links.dealId) await touchDealActivity(ctx.organizationId, links.dealId);
    await rescoreCompanyQuietly(ctx.organizationId, links.companyId);
    return { draft: draftView(done), communicationId: communication.id };
  } catch (err) {
    // Not sent and not logged. A disconnected mailbox or a refused field puts the message back as a draft to fix; a provider error is FAILED.
    const message = err instanceof Error ? err.message : "The message could not be sent.";
    const back = err instanceof ValidationError || err instanceof ConnectionUnavailableError || err instanceof NotFoundError;
    await fail(message, back ? "DRAFT" : "FAILED");
    if (err instanceof OAuthTransientError) throw new ValidationError(`The message was not sent: ${err.message}`);
    throw err;
  }
}

/** Sends a draft the person owns, now. A second call for a draft that is queued, sending or sent changes nothing and says so. */
export async function sendDraft(ctx: AuthContext, draftId: string) {
  requirePermission(ctx, "communications.create");
  const draft = await loadOwnDraft(ctx, draftId);
  if (draft.status === "SENT") return { draft: draftView(draft), communicationId: draft.communicationId, alreadySent: true as const };
  const claimed = await claim(draft, ["DRAFT", "SCHEDULED", "FAILED"]);
  if (!claimed) throw new ValidationError("This message is already being sent.", [{ path: "status", message: "It is already being sent." }]);
  return performSend(ctx, claimed);
}

/** Write and send in one call, from a record (also the reply). Wrap the route in an Idempotency-Key. */
export async function sendMail(ctx: AuthContext, input: DraftInput) {
  const draft = await createDraft(ctx, input);
  return sendDraft(ctx, draft.id);
}

export async function scheduleDraft(ctx: AuthContext, draftId: string, sendAt: Date) {
  requirePermission(ctx, "communications.create");
  if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() + 30_000) throw new ValidationError("Choose a time in the future.", [{ path: "sendAt", message: "Pick a time at least a minute from now." }]);
  if (sendAt.getTime() > Date.now() + 90 * 86_400_000) throw new ValidationError("Choose a time within 90 days.", [{ path: "sendAt", message: "Too far ahead." }]);
  const draft = await loadOwnDraft(ctx, draftId);
  if (draft.status !== "DRAFT" && draft.status !== "FAILED") throw new ValidationError("Only a draft can be scheduled.", [{ path: "status", message: "It is already queued or sent." }]);
  parseAddresses(draft.toAddresses, "to", true);
  const updated = await adminDb.mailDraft.update({ where: { id: draftId }, data: { status: "SCHEDULED", scheduledAt: sendAt, lastError: null } });
  await enqueueJobFor({ organizationId: ctx.organizationId, type: "mail.send_scheduled", payload: { draftId }, runAt: sendAt, createdByMembershipId: ctx.membershipId });
  return draftView(updated);
}

/** Cancels a scheduled send (back to a draft). The queued job finds it is no longer scheduled and does nothing. */
export async function unscheduleDraft(ctx: AuthContext, draftId: string) {
  const draft = await loadOwnDraft(ctx, draftId);
  if (draft.status !== "SCHEDULED") throw new ValidationError("This message is not scheduled.", [{ path: "status", message: "Nothing to cancel." }]);
  const back = await adminDb.mailDraft.updateMany({ where: { id: draftId, status: "SCHEDULED" }, data: { status: "DRAFT", scheduledAt: null } });
  if (back.count !== 1) throw new ValidationError("It was just sent.", [{ path: "status", message: "Too late to cancel." }]);
  return getDraft(ctx, draftId);
}

/** The scheduled job: sends as the draft's owner with that person's permissions today. Repeating it sends nothing twice. */
export async function runScheduledSend(organizationId: string, draftId: string) {
  const draft = await adminDb.mailDraft.findFirst({ where: { id: draftId, organizationId } });
  if (!draft || draft.status !== "SCHEDULED") return { sent: false as const, reason: "NOT_SCHEDULED" };
  const membership = await adminDb.membership.findFirst({ where: { id: draft.membershipId, organizationId }, select: { userId: true } });
  const ctx = membership ? await resolveActiveMembership(membership.userId, organizationId) : null;
  const claimed = await claim(draft, ["SCHEDULED"]);
  if (!claimed) return { sent: false as const, reason: "ALREADY_TAKEN" };
  if (!ctx) {
    await adminDb.mailDraft.update({ where: { id: draftId }, data: { status: "FAILED", lastError: "The sender is no longer an active member." } });
    return { sent: false as const, reason: "SENDER_INACTIVE" };
  }
  try {
    await performSend(ctx, claimed);
    return { sent: true as const };
  } catch {
    return { sent: false as const, reason: "FAILED" };
  }
}

// ---------------------------------------------------------------------------
// The record card shown beside a message (masked by the viewer's role, never the sender's)
// ---------------------------------------------------------------------------

/**
 * What the Mail workspace shows about the record a message is linked to. A deal's value follows `canSeeDealValue` (Management
 * and Finance, or the owner of the deal), a margin follows `deals.margin`, a payment figure needs `finance.view.payments`.
 * A hidden figure is `null` with its `*Masked` flag, never a stand-in number. The deal itself is loaded through the deal
 * service, so a role that may not open it gets the usual refusal.
 */
export async function getMailRecordCard(ctx: AuthContext, ref: { dealId?: string; companyId?: string; leadId?: string; contactId?: string }) {
  requirePermission(ctx, "communications.view");
  await assertCanAccessLinkedRecords(ctx, ref);
  if (ref.dealId) {
    const deal = await getDeal(ctx, ref.dealId);
    const raw = deal as unknown as { id: string; ownerMembershipId: string | null; value?: unknown; currency?: string; outcome?: string; pipelineStage?: { name?: string } | null; company?: { name?: string } | null };
    const showValue = canSeeDealValue(ctx, raw);
    return {
      kind: "deal" as const,
      id: raw.id,
      name: raw.company?.name ?? "Deal",
      stage: raw.pipelineStage?.name ?? null,
      outcome: raw.outcome ?? null,
      value: showValue && raw.value != null ? Number(raw.value) : null,
      currency: raw.currency ?? "KES",
      valueMasked: !showValue,
      margin: null as number | null,
      marginMasked: !canSeeMargin(ctx),
      paymentDue: null as number | null,
      paymentsMasked: !hasPermission(ctx, "finance.view.payments"),
    };
  }
  if (ref.companyId) {
    const company = await adminDb.company.findFirst({ where: { id: ref.companyId, organizationId: ctx.organizationId }, select: { id: true, name: true } });
    if (!company) throw new NotFoundError("Company", ref.companyId);
    return { kind: "company" as const, id: company.id, name: company.name };
  }
  throw new ValidationError("Say which record.", [{ path: "dealId", message: "Pass dealId or companyId." }]);
}

