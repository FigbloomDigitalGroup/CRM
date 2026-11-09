import { adminDb } from "../db/adminClient";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { canSeeDealValue } from "../auth/masking";
import { createTranslator, isClientLocale, type ClientLocale } from "../lib/clientText";
import { cleanSignatureInput, computeSeal, sha256Hex, verifySignatureRecord, type SignatureVerification } from "../lib/quoteSignature";
import { createActivity } from "../repositories/activities";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getVersionWithLines } from "../repositories/quotes";
import { addEvent, findShareByTokenHash, getShare } from "../repositories/quoteShares";
import { AlreadySignedError, findSignatureForVersion, listSignaturesForQuote, recordSignatureAndAccept } from "../repositories/quoteSignatures";
import { isOrganizationActive } from "../repositories/webForms";
import { isFeatureEnabled, requireFeature } from "./featureService";
import { loadQuoteAndDeal } from "./quoteService";

/**
 * E-signature of a quote (FIG-1186, B7.04). V2: signing works only for an organisation on release V2 (`release.v2`), so the signing
 * link a sender creates is dead on V1 and V1.1 and the public page answers the same plain "not available".
 *
 *  - The client opens `/sign/{token}`; the token is the same secret as the quote link (only its SHA-256 is stored), on a share the
 *    sender created with `allowSigning`. Unknown, revoked, deactivated, replaced or not-signable links all answer "not found";
 *    an expired link is refused with its own answer (and a refused attempt is logged).
 *  - Signing records one append-only signature: signer name, optional email, typed or drawn signature, the consent wording shown, the
 *    language, the hash of the exact document that was sent, the time, the address and device, and a seal over all of it. In the same
 *    transaction the version moves SENT -> ACCEPTED, which the database already makes final. The deal timeline and the audit log
 *    get an entry. Nothing here approves, discounts or moves a deal stage (hard rule 9).
 *  - The signed record is checked by `verifyQuoteSignature` (staff) from what is stored; see `src/lib/quoteSignature.ts`.
 */

const REFUSED_EVENT_GAP_MS = 60 * 60 * 1000;

export interface SigningPage {
  organisationName: string;
  quoteNumber: string;
  version: number;
  company: string;
  contact: string | null;
  currency: string;
  validUntil: string;
  terms: string | null;
  lines: { description: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  /** The language of the document that was sent. The page may show another language; the record keeps the one shown at signing. */
  documentLanguage: ClientLocale;
  recipientEmail: string;
  expiresAt: Date;
}

export interface SignatureSummary {
  signerName: string;
  signedAt: Date;
  language: ClientLocale;
  /** The record reference the signer can quote: the first 12 characters of the seal. */
  reference: string;
}

export type SigningPageResult =
  | { status: "ok"; page: SigningPage }
  | { status: "signed"; page: SigningPage; signature: SignatureSummary }
  | { status: "expired"; organisationName: string; language: ClientLocale }
  | { status: "not_found" };

type ShareRow = NonNullable<Awaited<ReturnType<typeof findShareByTokenHash>>>;
type VersionRow = NonNullable<Awaited<ReturnType<typeof loadVersion>>>;

async function loadVersion(share: ShareRow) {
  return adminDb.quoteVersion.findFirst({ where: { id: share.quoteVersionId, organizationId: share.organizationId }, include: { quote: true, lines: { orderBy: { position: "asc" } } } });
}

async function organisationName(organizationId: string): Promise<string> {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId }, select: { name: true, displayName: true } });
  return org?.displayName?.trim() ? org.displayName : (org?.name ?? "the sender");
}

type Resolved = { status: "found"; share: ShareRow; version: VersionRow } | { status: "expired"; share: ShareRow; version: VersionRow } | { status: "not_found" };

/** Finds the signable share behind a token, or says why not. Every refusal that is not "expired" looks the same from outside. */
async function resolveSignable(token: string, now: Date): Promise<Resolved> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "not_found" };
  const share = await findShareByTokenHash(sha256Hex(token));
  if (!share || share.revokedAt || !share.signingEnabled) return { status: "not_found" };
  const version = await loadVersion(share);
  if (!version) return { status: "not_found" };
  if (!(await isOrganizationActive(share.organizationId))) return { status: "not_found" };
  if (!(await isFeatureEnabled(share.organizationId, "quotes.enabled")) || !(await isFeatureEnabled(share.organizationId, "release.v2"))) return { status: "not_found" };
  if (version.status !== "SENT" && version.status !== "ACCEPTED") return { status: "not_found" };
  const newer = await adminDb.quoteVersion.findFirst({ where: { quoteId: version.quoteId, organizationId: share.organizationId, version: { gt: version.version }, status: { in: ["SENT", "ACCEPTED"] } }, select: { id: true } });
  if (newer) return { status: "not_found" };
  if (share.expiresAt.getTime() <= now.getTime()) return { status: "expired", share, version };
  return { status: "found", share, version };
}

async function buildPage(share: ShareRow, version: VersionRow): Promise<SigningPage> {
  const deal = await adminDb.deal.findFirst({
    where: { id: version.quote.dealId, organizationId: share.organizationId },
    select: { company: { select: { name: true } }, primaryContact: { select: { firstName: true, lastName: true } } },
  });
  return {
    organisationName: await organisationName(share.organizationId),
    quoteNumber: version.quote.number,
    version: version.version,
    company: deal?.company.name ?? "",
    contact: deal?.primaryContact ? [deal.primaryContact.firstName, deal.primaryContact.lastName].filter(Boolean).join(" ") : null,
    currency: version.currency,
    validUntil: version.validUntil.toISOString().slice(0, 10),
    terms: version.terms,
    lines: version.lines.map((l) => ({ description: l.description, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), lineTotal: Number(l.lineTotal) })),
    subtotal: Number(version.subtotal),
    discountPercent: Number(version.discountPercent),
    discountAmount: Number(version.discountAmount),
    total: Number(version.total),
    documentLanguage: isClientLocale(share.language) ? share.language : "en",
    recipientEmail: share.recipientEmail,
    expiresAt: share.expiresAt,
  };
}

/** What the signing page needs. Read only: opening the page is logged by the quote link, not here. */
export async function getSigningPage(token: string, now = new Date()): Promise<SigningPageResult> {
  const found = await resolveSignable(token, now);
  if (found.status === "not_found") return found;
  const language: ClientLocale = isClientLocale(found.share.language) ? found.share.language : "en";
  if (found.status === "expired") return { status: "expired", organisationName: await organisationName(found.share.organizationId), language };
  const page = await buildPage(found.share, found.version);
  if (found.version.status === "ACCEPTED") {
    const signature = await findSignatureForVersion(found.share.organizationId, found.version.id);
    // Accepted by a person on the sender's side (not signed online): there is nothing for the client to do or see here.
    if (!signature) return { status: "not_found" };
    return { status: "signed", page, signature: { signerName: signature.signerName, signedAt: signature.signedAt, language: isClientLocale(signature.language) ? signature.language : "en", reference: signature.sealSha256.slice(0, 12) } };
  }
  return { status: "ok", page };
}

export type SignResult =
  | { status: "signed"; signedAt: Date; signerName: string; sealSha256: string; reference: string }
  | { status: "expired"; organisationName: string }
  | { status: "already_signed" }
  | { status: "integrity_error" }
  | { status: "not_found" };

export interface SignInput {
  signerName?: unknown;
  signerEmail?: unknown;
  consent?: unknown;
  signature?: unknown;
  language?: unknown;
}

export async function signQuote(token: string, input: SignInput, client: { ipAddress: string | null; userAgent: string | null }, now = new Date()): Promise<SignResult> {
  const found = await resolveSignable(token, now);
  if (found.status === "not_found") return found;
  const { share, version } = found;
  if (found.status === "expired") {
    // A refused attempt is logged, at most once an hour per link, so a stale link cannot flood the log.
    const since = new Date(now.getTime() - REFUSED_EVENT_GAP_MS);
    if (!(await adminDb.quoteEvent.findFirst({ where: { organizationId: share.organizationId, shareId: share.id, type: "SIGN_REFUSED", occurredAt: { gt: since } }, select: { id: true } }))) {
      await addEvent({ organizationId: share.organizationId, quoteId: version.quoteId, quoteVersionId: version.id, shareId: share.id, type: "SIGN_REFUSED", occurredAt: now, userAgent: client.userAgent?.slice(0, 200) ?? null });
    }
    return { status: "expired", organisationName: await organisationName(share.organizationId) };
  }
  if (version.status !== "SENT") return { status: "already_signed" };

  const cleaned = cleanSignatureInput(input);
  if ("issues" in cleaned) throw new ValidationError("The signature is not complete.", cleaned.issues);

  // The client signs the document that was sent. If the stored copy no longer matches its hash, nothing is signed.
  if (sha256Hex(share.documentHtml) !== share.documentSha256) return { status: "integrity_error" };

  const language: ClientLocale = isClientLocale(input.language) ? input.language : isClientLocale(share.language) ? share.language : "en";
  const consentText = createTranslator(language).t("sign.consent");
  const fields = {
    organizationId: share.organizationId,
    quoteId: version.quoteId,
    quoteVersionId: version.id,
    shareId: share.id,
    documentSha256: share.documentSha256,
    signerName: cleaned.value.signerName,
    signerEmail: cleaned.value.signerEmail,
    signatureKind: cleaned.value.signatureKind,
    signatureSha256: sha256Hex(cleaned.value.signatureData),
    consentText,
    language,
    ipAddress: client.ipAddress?.slice(0, 64) ?? null,
    userAgent: client.userAgent?.slice(0, 300) ?? null,
    signedAt: now,
  };
  const sealSha256 = computeSeal(fields);
  try {
    await recordSignatureAndAccept(share.organizationId, { ...fields, signatureData: cleaned.value.signatureData, sealSha256 }, `Signed online by ${cleaned.value.signerName}`.slice(0, 500));
  } catch (err) {
    if (err instanceof AlreadySignedError) return { status: "already_signed" };
    throw err;
  }

  await addEvent({ organizationId: share.organizationId, quoteId: version.quoteId, quoteVersionId: version.id, shareId: share.id, type: "SIGNED", occurredAt: now, userAgent: client.userAgent?.slice(0, 200) ?? null });
  // The audit entry carries no amount; the audit reader would mask one anyway. The actor is the signer, who has no account.
  await recordAuditEvent({
    organizationId: share.organizationId,
    action: "quote.signed",
    entityType: "Quote",
    entityId: version.quoteId,
    metadata: { quoteNumber: version.quote.number, version: version.version, shareId: share.id, signer: cleaned.value.signerName, sealSha256, documentSha256: share.documentSha256, language },
  });
  if (share.createdByMembershipId) {
    const deal = await adminDb.deal.findFirst({ where: { id: version.quote.dealId, organizationId: share.organizationId }, select: { id: true, companyId: true, primaryContactId: true } });
    if (deal) {
      await createActivity({
        organizationId: share.organizationId,
        type: "OTHER",
        subject: `Quote ${version.quote.number} v${version.version} signed by ${cleaned.value.signerName}`,
        description: "The client signed the quote online. The record is on the quote.",
        occurredAt: now,
        authorMembershipId: share.createdByMembershipId,
        dealId: deal.id,
        companyId: deal.companyId,
        contactId: deal.primaryContactId ?? undefined,
      }).catch(() => undefined);
    }
  }
  return { status: "signed", signedAt: now, signerName: cleaned.value.signerName, sealSha256, reference: sealSha256.slice(0, 12) };
}

// ---------------------------------------------------------------------------
// Staff side: reading and checking the record
// ---------------------------------------------------------------------------

export interface PresentedSignature {
  id: string;
  quoteVersionId: string;
  version: number;
  signerName: string;
  signerEmail: string | null;
  signatureKind: string;
  language: string;
  consentText: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  documentSha256: string;
  sealSha256: string;
  verification: SignatureVerification;
}

/** The signatures of a quote with their check. Needs the quote's read rights and the right to see the amounts the signed document shows. */
export async function listQuoteSignatures(ctx: AuthContext, quoteId: string, versionNumber?: number): Promise<PresentedSignature[]> {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  if (!hasPermission(ctx, "quotes.create") && !hasPermission(ctx, "quotes.approve")) throw deny(ctx, "quotes (quotes.create or quotes.approve)", ["quotes.create", "quotes.approve"]);
  const { deal } = await loadQuoteAndDeal(ctx, quoteId);
  // The record proves a document that is all prices, so it follows the deal value rule (docs/MASKING.md).
  if (!canSeeDealValue(ctx, deal)) throw deny(ctx, "the signed quote record (deals.view.value, or owning the deal)", ["deals.view.value"]);
  if (versionNumber !== undefined && !(await getVersionWithLines(ctx.organizationId, quoteId, versionNumber))) throw new NotFoundError("QuoteVersion", `${quoteId}/${versionNumber}`);
  const rows = await listSignaturesForQuote(ctx.organizationId, quoteId);
  const versions = await adminDb.quoteVersion.findMany({ where: { organizationId: ctx.organizationId, quoteId }, select: { id: true, version: true } });
  const numberOf = new Map(versions.map((v) => [v.id, v.version]));
  const out: PresentedSignature[] = [];
  for (const r of rows) {
    const number = numberOf.get(r.quoteVersionId) ?? 0;
    if (versionNumber !== undefined && number !== versionNumber) continue;
    const share = r.shareId ? await getShare(ctx.organizationId, r.shareId) : null;
    out.push({
      id: r.id,
      quoteVersionId: r.quoteVersionId,
      version: number,
      signerName: r.signerName,
      signerEmail: r.signerEmail,
      signatureKind: r.signatureKind,
      language: r.language,
      consentText: r.consentText,
      signedAt: r.signedAt,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      documentSha256: r.documentSha256,
      sealSha256: r.sealSha256,
      verification: verifySignatureRecord(r, share?.documentHtml ?? null),
    });
  }
  return out;
}
