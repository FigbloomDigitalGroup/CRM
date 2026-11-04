import { createHash, randomBytes } from "node:crypto";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { canSeeDealValue } from "../auth/masking";
import { adminDb } from "../db/adminClient";
import { assertWritable } from "../lib/archive";
import { discountNeedsApproval } from "../lib/approvalRules";
import { LOGO_PLACEHOLDER, escapeHtml, renderQuoteHtml, type QuoteDocumentInput } from "../lib/quoteDocument";
import { isExpiredOn, todayIso } from "../lib/quotes";
import { lookColours } from "../preferences/catalogue";
import { recordAuditEvent } from "../repositories/auditEvents";
import { createActivity } from "../repositories/activities";
import { getVersionWithLines, transitionVersion } from "../repositories/quotes";
import { addEvent, createShare, findShareByTokenHash, getShare, latestShareWithDocument, listEvents, listShares, recordView, revokeShare } from "../repositories/quoteShares";
import { getStorageDriver } from "../storage";
import { loadApprovalRules } from "./approvalRuleService";
import { sendAndLogEmail } from "./communicationService";
import { renderTemplate } from "./emailTemplateService";
import { isOrganizationActive } from "../repositories/webForms";
import { isFeatureEnabled, requireFeature } from "./featureService";
import { loadQuoteAndDeal, presentVersion, quoteAuditSnapshot, requireQuoteWrite } from "./quoteService";

/**
 * Quote document, send and view tracking (FIG-1144, B6.12).
 *
 *  - The document is one pure function (`renderQuoteHtml`), used by the preview and by the send, so they cannot drift.
 *    It carries no cost and no margin. The sent document is stored on the share row; the client always sees that snapshot,
 *    and the preview of a sent version returns it too, so "what you previewed is what was sent".
 *  - A share link is a random token, stored only as a SHA-256 hash, with an expiry (the end of the quote validity, at most
 *    90 days) and a revoke. Opening it logs a view event, counts it, and writes the deal timeline once an hour at most.
 *  - Sending needs the same rights as editing the deal plus `communications.create`, and the right to see the deal value (the
 *    document is all prices). A discount above the approval limit must be approved first (B6.13): the rule makes the send wait
 *    for a person, it never approves anything.
 */

export const MAX_LINK_DAYS = 90;
const TIMELINE_GAP_MS = 60 * 60 * 1000;
/** One VIEWED event per link in this window, and one LINK_EXPIRED_VISIT per link per hour, so a token cannot flood the log. */
const VIEW_EVENT_GAP_MS = 10 * 60 * 1000;
const EXPIRED_VISIT_GAP_MS = 60 * 60 * 1000;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashToken(token: string): string {
  return sha256(token);
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function shareLinkFor(token: string): string {
  return `${appBaseUrl()}/api/public/quotes/${token}`;
}

type VersionWithLines = NonNullable<Awaited<ReturnType<typeof getVersionWithLines>>>;

/** Builds the document for a version. `now` fixes the issue date, so a preview and a send made on the same day match. */
export async function buildQuoteDocument(organizationId: string, quote: { number: string; dealId: string }, version: VersionWithLines, now: Date): Promise<{ html: string; sha256: string }> {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const deal = await adminDb.deal.findFirstOrThrow({
    where: { id: quote.dealId, organizationId },
    select: { company: { select: { name: true } }, primaryContact: { select: { firstName: true, lastName: true } } },
  });
  const creator = version.createdByMembershipId
    ? await adminDb.membership.findFirst({ where: { id: version.createdByMembershipId, organizationId }, select: { user: { select: { name: true } } } })
    : null;
  const input: QuoteDocumentInput = {
    organization: {
      name: org.displayName?.trim() ? org.displayName : org.name,
      phone: org.phone,
      website: org.website,
      address: org.address,
      accent: lookColours(org.defaultTheme, org.defaultPageColour).accent,
      showLogo: org.showLogoOnClientPages && org.logoFileId !== null,
    },
    quote: {
      number: quote.number,
      version: version.version,
      currency: version.currency,
      issuedOn: todayIso(now),
      validUntil: version.validUntil.toISOString().slice(0, 10),
      terms: version.terms,
      discountPercent: Number(version.discountPercent),
      subtotal: Number(version.subtotal),
      discountAmount: Number(version.discountAmount),
      total: Number(version.total),
      lines: version.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), lineTotal: Number(l.lineTotal), taxable: l.taxable })),
    },
    preparedFor: { company: deal.company.name, contact: deal.primaryContact ? [deal.primaryContact.firstName, deal.primaryContact.lastName].filter(Boolean).join(" ") : null },
    preparedBy: creator?.user.name ?? null,
  };
  const html = renderQuoteHtml(input);
  return { html, sha256: sha256(html) };
}

function requireSeesAmounts(ctx: AuthContext, deal: { ownerMembershipId: string | null }, what: string) {
  if (!canSeeDealValue(ctx, deal)) throw deny(ctx, `${what} (deals.view.value, or owning the deal)`, ["deals.view.value"]);
}

async function loadVersion(ctx: AuthContext, quoteId: string, version: number) {
  const row = await getVersionWithLines(ctx.organizationId, quoteId, version);
  if (!row) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
  return row;
}

/** The document as the client would see it. A sent version returns the stored snapshot. */
export async function previewQuote(ctx: AuthContext, quoteId: string, version: number, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  if (!hasPermission(ctx, "quotes.create") && !hasPermission(ctx, "quotes.approve")) throw deny(ctx, "quotes (quotes.create or quotes.approve)", ["quotes.create", "quotes.approve"]);
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireSeesAmounts(ctx, deal, "the quote document");
  const row = await loadVersion(ctx, quoteId, version);
  const sent = await latestShareWithDocument(ctx.organizationId, row.id);
  if (sent) return { source: "sent" as const, html: sent.documentHtml, sha256: sent.documentSha256 };
  const built = await buildQuoteDocument(ctx.organizationId, quote, row, now);
  return { source: "draft" as const, ...built };
}

export interface SendQuoteInput {
  to?: string;
  subject?: string;
  body?: string;
  templateId?: string;
  /** Link lifetime in days; never beyond the end of the quote validity or 90 days. */
  linkExpiresInDays?: number;
}

// The same pattern the mail service uses: one address, no list separators or angle brackets.
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export async function sendQuote(ctx: AuthContext, quoteId: string, version: number, input: SendQuoteInput = {}, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  requirePermission(ctx, "communications.create");
  requireSeesAmounts(ctx, deal, "sending a quote");
  assertWritable(ctx, "deal", deal, "sending its quote");
  const row = await loadVersion(ctx, quoteId, version);

  const fail = (message: string, code: string, path = "version") => new ValidationError(message, [{ path, message, code }]);
  const validUntil = row.validUntil.toISOString().slice(0, 10);
  if (row.status === "PENDING_APPROVAL") throw fail("This version is waiting for approval. It can be sent once it is approved.", "APPROVAL_PENDING");
  if (row.status === "REJECTED") throw fail("This version was not approved. Make a new version.", "NOT_APPROVED");
  if (row.status === "ACCEPTED" || row.status === "DECLINED") throw fail("The client has already answered this version.", "ALREADY_ANSWERED");
  if (row.lines.length === 0) throw fail("Add at least one line before sending the quote.", "NO_LINES", "lines");
  if (isExpiredOn(validUntil, now)) throw fail("This quote has passed its validity date. Make a new version with a new date.", "QUOTE_EXPIRED", "validUntil");
  if (row.status === "DRAFT" && discountNeedsApproval(Number(row.discountPercent), await loadApprovalRules(ctx.organizationId))) {
    throw fail("A discount this size needs approval before the quote can be sent. Ask for approval first.", "APPROVAL_REQUIRED", "discountPercent");
  }

  let to = input.to?.trim();
  if (!to && deal.primaryContactId) {
    to = (await adminDb.contact.findFirst({ where: { id: deal.primaryContactId, organizationId: ctx.organizationId }, select: { email: true } }))?.email ?? undefined;
  }
  if (!to || !EMAIL.test(to)) throw fail("Give the email address to send the quote to.", "RECIPIENT_REQUIRED", "to");
  if (input.linkExpiresInDays !== undefined && (!Number.isInteger(input.linkExpiresInDays) || input.linkExpiresInDays < 1 || input.linkExpiresInDays > MAX_LINK_DAYS)) {
    throw fail(`A link lasts 1 to ${MAX_LINK_DAYS} days.`, "INVALID_LINK_DAYS", "linkExpiresInDays");
  }

  // The link ends with the quote validity (end of that day), at most 90 days, or sooner when the sender asks.
  const validityEnd = new Date(`${validUntil}T23:59:59.999Z`);
  const ceiling = new Date(now.getTime() + MAX_LINK_DAYS * 86_400_000);
  let expiresAt = new Date(Math.min(validityEnd.getTime(), ceiling.getTime()));
  if (input.linkExpiresInDays !== undefined) expiresAt = new Date(Math.min(expiresAt.getTime(), now.getTime() + input.linkExpiresInDays * 86_400_000));

  const document = await buildQuoteDocument(ctx.organizationId, quote, row, now);
  const token = randomBytes(32).toString("base64url");
  const link = shareLinkFor(token);

  let subject = input.subject;
  let body = input.body;
  if (input.templateId && (subject === undefined || body === undefined)) {
    const rendered = await renderTemplate(ctx, input.templateId, { dealId: deal.id, contactId: deal.primaryContactId ?? undefined });
    subject = subject ?? rendered.subject;
    body = body ?? rendered.body;
  }
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true, displayName: true } });
  const orgName = org.displayName?.trim() ? org.displayName : org.name;
  subject = subject?.trim() || `Quote ${quote.number} from ${orgName}`;
  body = body?.trim() || `Hello,\n\nPlease find your quote ${quote.number} (version ${row.version}) from ${orgName}.`;
  if (!body.includes(link)) body += `\n\nView your quote: ${link}\nThis link works until ${expiresAt.toISOString().slice(0, 10)}.`;

  // Email first: when it fails, nothing is locked and no link exists.
  await sendAndLogEmail(ctx, { to, subject, body, dealId: deal.id, companyId: deal.companyId, contactId: deal.primaryContactId ?? undefined, templateId: input.templateId });

  let updated: VersionWithLines | null = row;
  if (row.status === "DRAFT" || row.status === "APPROVED") {
    updated = await transitionVersion(ctx.organizationId, row.id, ["DRAFT", "APPROVED"], "SENT", { lock: row.status === "DRAFT", sentAt: now });
    if (!updated) throw fail("This version was changed by someone else. Reload and try again.", "CONFLICT");
  }
  const share = await createShare({
    organizationId: ctx.organizationId,
    quoteVersionId: row.id,
    tokenHash: hashToken(token),
    recipientEmail: to,
    expiresAt,
    documentHtml: document.html,
    documentSha256: document.sha256,
    createdByMembershipId: ctx.membershipId,
  });
  await addEvent({ organizationId: ctx.organizationId, quoteId, quoteVersionId: row.id, shareId: share.id, type: "SENT", occurredAt: now });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: row.status === "SENT" ? "quote.resent" : "quote.sent",
    entityType: "Quote",
    entityId: quoteId,
    newValue: quoteAuditSnapshot(quote, updated!),
    metadata: { shareId: share.id, expiresAt: expiresAt.toISOString() },
  });
  return {
    version: presentVersion(ctx, deal, updated!, null, now),
    share: { id: share.id, recipientEmail: to, expiresAt, documentSha256: document.sha256 },
    /** Shown once: only a hash is kept. */
    link,
  };
}

/** The links of a version and what happened to them. Tokens are never returned. */
export async function getQuoteActivity(ctx: AuthContext, quoteId: string, version: number, nowDate = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  if (!hasPermission(ctx, "quotes.create") && !hasPermission(ctx, "quotes.approve")) throw deny(ctx, "quotes (quotes.create or quotes.approve)", ["quotes.create", "quotes.approve"]);
  await loadQuoteAndDeal(ctx, quoteId);
  const row = await loadVersion(ctx, quoteId, version);
  const now = nowDate.getTime();
  const [shares, events] = await Promise.all([listShares(ctx.organizationId, row.id), listEvents(ctx.organizationId, row.id)]);
  return {
    shares: shares.map((s) => ({ ...s, active: s.revokedAt === null && s.expiresAt.getTime() > now })),
    events: events.map((e) => ({ id: e.id, type: e.type, shareId: e.shareId, occurredAt: e.occurredAt })),
  };
}

export async function revokeQuoteShare(ctx: AuthContext, quoteId: string, shareId: string, now = new Date()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  const share = await getShare(ctx.organizationId, shareId);
  const versionRow = share ? await adminDb.quoteVersion.findFirst({ where: { id: share.quoteVersionId, organizationId: ctx.organizationId, quoteId } }) : null;
  if (!share || !versionRow) throw new NotFoundError("QuoteShare", shareId);
  if (!(await revokeShare(ctx.organizationId, shareId, now))) throw new ValidationError("This link was already revoked.", [{ path: "shareId", message: "Already revoked.", code: "ALREADY_REVOKED" }]);
  await addEvent({ organizationId: ctx.organizationId, quoteId, quoteVersionId: share.quoteVersionId, shareId, type: "LINK_REVOKED", occurredAt: now });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "quote.link_revoked", entityType: "Quote", entityId: quote.id, metadata: { shareId } });
  return { id: shareId, revokedAt: now };
}

// ---------------------------------------------------------------------------
// The public side: opening a link
// ---------------------------------------------------------------------------

export type PublicQuoteResult =
  | { status: "ok"; html: string }
  | { status: "expired"; organizationName: string }
  | { status: "not_found" };

async function withLogo(organizationId: string, html: string): Promise<string> {
  if (!html.includes(LOGO_PLACEHOLDER)) return html;
  const org = await adminDb.organization.findUnique({ where: { id: organizationId }, select: { name: true, displayName: true, logoFileId: true, showLogoOnClientPages: true } });
  const name = org?.displayName?.trim() ? org.displayName : (org?.name ?? "");
  let url: string | null = null;
  if (org?.logoFileId && org.showLogoOnClientPages) {
    const file = await adminDb.file.findFirst({ where: { id: org.logoFileId, organizationId, status: "READY", purpose: "LOGO", deletedAt: null } });
    if (file) {
      url = (await getStorageDriver().signDownload(file.storageKey, { expiresInSeconds: 300, fileName: file.name, contentType: file.mimeType, disposition: "inline" })).url;
    }
  }
  if (url) return html.replaceAll(LOGO_PLACEHOLDER, escapeHtml(url));
  return html.replace(/<img src="__QUOTE_LOGO_URL__"[^>]*>/g, `<strong>${escapeHtml(name)}</strong>`);
}

async function senderName(organizationId: string): Promise<string> {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId }, select: { name: true, displayName: true } });
  return org?.displayName?.trim() ? org.displayName : (org?.name ?? "the sender");
}

async function recentEvent(organizationId: string, shareId: string, type: string, since: Date): Promise<boolean> {
  return (await adminDb.quoteEvent.findFirst({ where: { organizationId, shareId, type, occurredAt: { gt: since } }, select: { id: true } })) !== null;
}

/** Opens a link: logs the view, counts it, writes the deal timeline (at most hourly), and returns the stored document. */
export async function openQuoteLink(token: string, client: { userAgent?: string | null } = {}, now = new Date()): Promise<PublicQuoteResult> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "not_found" };
  const share = await findShareByTokenHash(hashToken(token));
  if (!share || share.revokedAt) return { status: "not_found" };
  const version = await adminDb.quoteVersion.findFirst({ where: { id: share.quoteVersionId, organizationId: share.organizationId }, include: { quote: true } });
  if (!version) return { status: "not_found" };
  const userAgent = client.userAgent?.slice(0, 200) ?? null;

  // A link stops working, without any trace, when its organisation is deactivated, the quotes feature is off, or the
  // version was turned down or replaced by a newer one the client has been given.
  if (!(await isOrganizationActive(share.organizationId)) || !(await isFeatureEnabled(share.organizationId, "quotes.enabled"))) return { status: "not_found" };
  if (version.status === "REJECTED") return { status: "not_found" };
  const newer = await adminDb.quoteVersion.findFirst({ where: { quoteId: version.quoteId, organizationId: share.organizationId, version: { gt: version.version }, status: { in: ["SENT", "ACCEPTED"] } }, select: { id: true } });
  if (newer) return { status: "not_found" };

  if (share.expiresAt.getTime() <= now.getTime()) {
    if (await recentEvent(share.organizationId, share.id, "LINK_EXPIRED_VISIT", new Date(now.getTime() - EXPIRED_VISIT_GAP_MS))) {
      return { status: "expired", organizationName: await senderName(share.organizationId) };
    }
    await addEvent({ organizationId: share.organizationId, quoteId: version.quoteId, quoteVersionId: version.id, shareId: share.id, type: "LINK_EXPIRED_VISIT", occurredAt: now, userAgent });
    return { status: "expired", organizationName: await senderName(share.organizationId) };
  }

  const timeline = share.lastTimelineAt === null || now.getTime() - share.lastTimelineAt.getTime() >= TIMELINE_GAP_MS;
  const updated = await recordView(share.organizationId, share.id, now, timeline);
  if (!(await recentEvent(share.organizationId, share.id, "VIEWED", new Date(now.getTime() - VIEW_EVENT_GAP_MS)))) {
    await addEvent({ organizationId: share.organizationId, quoteId: version.quoteId, quoteVersionId: version.id, shareId: share.id, type: "VIEWED", occurredAt: now, userAgent });
  }
  if (timeline && share.createdByMembershipId) {
    const deal = await adminDb.deal.findFirst({ where: { id: version.quote.dealId, organizationId: share.organizationId }, select: { id: true, companyId: true, primaryContactId: true } });
    if (deal) {
      await createActivity({
        organizationId: share.organizationId,
        type: "OTHER",
        subject: `Quote ${version.quote.number} v${version.version} opened by the client`,
        description: `The client opened the quote link (view ${updated.viewCount}).`,
        occurredAt: now,
        authorMembershipId: share.createdByMembershipId,
        dealId: deal.id,
        companyId: deal.companyId,
        contactId: deal.primaryContactId ?? undefined,
      }).catch(() => undefined);
    }
  }
  return { status: "ok", html: await withLogo(share.organizationId, share.documentHtml) };
}
