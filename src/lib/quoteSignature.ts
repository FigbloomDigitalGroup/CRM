import { createHash } from "node:crypto";

/**
 * E-signature of a sent quote (FIG-1186, B7.04): the pure rules. Nothing here touches the database.
 *
 * A signature is kept as one append-only record. Its `seal` is a SHA-256 over the whole record in a fixed order (the document the
 * client saw, who signed, how, when, from which address, the consent wording), so a record changed afterwards no longer matches its
 * seal. The record also holds the hash of the exact document that was sent; checking a signature means recomputing both
 * (`verifySignatureRecord`). The database refuses any change to the row, and to the sent document, so the check is a second line.
 */

export const SIGNATURE_KINDS = ["TYPED", "DRAWN"] as const;
export type SignatureKind = (typeof SIGNATURE_KINDS)[number];

export const SEAL_VERSION = 1;
export const MAX_SIGNATURE_DATA = 120_000;
const MAX_NAME = 200;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = "89504e470d0a1a0a";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface SealFields {
  organizationId: string;
  quoteId: string;
  quoteVersionId: string;
  shareId: string | null;
  documentSha256: string;
  signerName: string;
  signerEmail: string | null;
  signatureKind: string;
  signatureSha256: string;
  consentText: string;
  language: string;
  ipAddress: string | null;
  userAgent: string | null;
  signedAt: Date;
}

/** The seal: a hash over every field in a fixed order. Arrays keep the order, and JSON keeps strings and nulls apart. */
export function computeSeal(f: SealFields): string {
  return sha256Hex(
    JSON.stringify([
      SEAL_VERSION,
      f.organizationId,
      f.quoteId,
      f.quoteVersionId,
      f.shareId,
      f.documentSha256,
      f.signerName,
      f.signerEmail,
      f.signatureKind,
      f.signatureSha256,
      f.consentText,
      f.language,
      f.ipAddress,
      f.userAgent,
      f.signedAt.toISOString(),
    ]),
  );
}

export interface SignatureRecordForCheck extends SealFields {
  sealSha256: string;
  signatureData: string;
}

export interface SignatureVerification {
  /** The record still matches its seal (nothing in it was changed). */
  sealValid: boolean;
  /** The signature data still matches its stored hash. */
  signatureValid: boolean;
  /** The document kept with the quote is the one the client signed. */
  documentValid: boolean;
  ok: boolean;
}

/**
 * Checks a stored signature against what was kept: the record against its seal, the signature data against its hash, and the stored
 * document (`currentDocumentHtml`, the HTML kept on the share) against the hash the client signed.
 */
export function verifySignatureRecord(record: SignatureRecordForCheck, currentDocumentHtml: string | null): SignatureVerification {
  const sealValid = computeSeal(record) === record.sealSha256;
  const signatureValid = sha256Hex(record.signatureData) === record.signatureSha256;
  const documentValid = currentDocumentHtml !== null && sha256Hex(currentDocumentHtml) === record.documentSha256;
  return { sealValid, signatureValid, documentValid, ok: sealValid && signatureValid && documentValid };
}

export interface CleanSignature {
  signerName: string;
  signerEmail: string | null;
  signatureKind: SignatureKind;
  signatureData: string;
}

export interface SignatureIssue {
  path: string;
  message: string;
  code: string;
}

/** A name counts as a signature only with at least two letters; control characters are refused. */
export function cleanSignerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length > MAX_NAME || /[\p{Cc}<>]/u.test(name)) return null;
  return name.replace(/[^\p{L}]/gu, "").length >= 2 ? name : null;
}

/** A drawn signature is a small PNG data URL; the bytes must start with the PNG signature, so any other file is refused. */
export function isPngDataUrl(data: string): boolean {
  if (!data.startsWith(PNG_PREFIX) || data.length > MAX_SIGNATURE_DATA) return false;
  const base64 = data.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 24) return false;
  return Buffer.from(base64.slice(0, 16), "base64").toString("hex").startsWith(PNG_MAGIC);
}

/** Checks the signing request body. Returns the cleaned signature, or every problem found. */
export function cleanSignatureInput(input: unknown): { value: CleanSignature } | { issues: SignatureIssue[] } {
  const issues: SignatureIssue[] = [];
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const name = cleanSignerName(body.signerName);
  if (name === null) issues.push({ path: "signerName", message: "Give your full name (at least two letters).", code: "NAME_REQUIRED" });
  if (body.consent !== true) issues.push({ path: "consent", message: "You must agree to the quote before signing.", code: "CONSENT_REQUIRED" });
  let email: string | null = null;
  if (body.signerEmail !== undefined && body.signerEmail !== null && body.signerEmail !== "") {
    if (typeof body.signerEmail !== "string" || !EMAIL.test(body.signerEmail.trim()) || body.signerEmail.length > 320) {
      issues.push({ path: "signerEmail", message: "Give a single valid email address, or leave it empty.", code: "INVALID_EMAIL" });
    } else email = body.signerEmail.trim().toLowerCase();
  }
  const sig = (typeof body.signature === "object" && body.signature !== null ? body.signature : { kind: "TYPED" }) as Record<string, unknown>;
  const kind = sig.kind === undefined ? "TYPED" : sig.kind;
  let kindOk: SignatureKind | null = null;
  let data = "";
  if (kind === "TYPED") {
    kindOk = "TYPED";
    // A typed signature is the typed name itself; a different value in `data` is refused so the record says what the person typed.
    if (name !== null && sig.data !== undefined && sig.data !== name) issues.push({ path: "signature.data", message: "A typed signature is the name you typed.", code: "SIGNATURE_MISMATCH" });
    data = name ?? "";
  } else if (kind === "DRAWN") {
    kindOk = "DRAWN";
    if (typeof sig.data !== "string" || !isPngDataUrl(sig.data)) issues.push({ path: "signature.data", message: "A drawn signature is a PNG image of at most 120,000 characters.", code: "INVALID_SIGNATURE_IMAGE" });
    else data = sig.data;
  } else issues.push({ path: "signature.kind", message: "Use TYPED or DRAWN.", code: "INVALID_SIGNATURE_KIND" });
  if (issues.length > 0 || name === null || kindOk === null) return { issues };
  return { value: { signerName: name, signerEmail: email, signatureKind: kindOk, signatureData: data } };
}
