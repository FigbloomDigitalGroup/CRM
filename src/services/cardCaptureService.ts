import type { CardCapture } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { CARD_FIELDS, getCardExtractor, readCard, type CardField, type CardFields } from "../capture/cardExtractor";
import { adminDb } from "../db/adminClient";
import { cleanText } from "../lib/inputParsing";
import { createAttachmentRecord } from "../repositories/attachments";
import { recordAuditEvent } from "../repositories/auditEvents";
import { findDuplicates } from "./duplicateService";
import { completeUpload, createUpload, markFileDeleted, readFileContent } from "./fileService";
import { quickCapture, type DuplicateDecision } from "./quickCaptureService";

/**
 * Business-card capture from the phone (FIG-1154, B6.22, mobile design M4).
 *
 * The flow, and where it cannot be shortened:
 *   1. `startCardCapture`  declares the photo; the file service answers with a signed upload link (type, size, checksum rules apply).
 *   2. the phone uploads the bytes.
 *   3. `extractCard`       completes the upload (content check and virus-scan hook), reads the card, and returns the SUGGESTED fields,
 *                          the ones the reader was unsure of, and any likely duplicate. Nothing is created.
 *   4. `confirmCardCapture` takes the fields the person saw and edited, plus an explicit `confirmed: true`. Only now does a lead exist.
 *                          It goes through quick capture, so the duplicate warning, the defaults and the permissions are the same
 *                          as typing the lead in; the card photo is attached to the lead (or the existing record it merged into).
 * The reading is never trusted: it fills a form, the person confirms, and every field the person submits is validated as if typed.
 */
const MAX_FIELD = 200;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Suggested = { fields: CardFields; unsure: CardField[] };

function view(c: CardCapture, extra: Record<string, unknown> = {}) {
  const extracted = (c.extracted ?? null) as Suggested["fields"] | null;
  return {
    id: c.id,
    status: c.status,
    fileId: c.fileId,
    fields: extracted,
    unsure: c.unsure,
    note: c.extractionNote,
    leadId: c.leadId,
    contactId: c.contactId,
    outcome: c.outcome,
    ...extra,
  };
}

async function loadOwn(ctx: AuthContext, id: string): Promise<CardCapture> {
  const row = await adminDb.cardCapture.findFirst({ where: { id, organizationId: ctx.organizationId, membershipId: ctx.membershipId } });
  if (!row) throw new NotFoundError("Card capture", id);
  return row;
}

function requireCaptureRights(ctx: AuthContext) {
  requirePermission(ctx, "leads.create");
  requirePermission(ctx, "contacts.create");
  requirePermission(ctx, "attachments.manage");
}

export async function startCardCapture(ctx: AuthContext, input: { name: string; mimeType: string; sizeBytes: number; checksumSha256?: string }) {
  requireCaptureRights(ctx);
  if (!IMAGE_TYPES.includes((input.mimeType ?? "").toLowerCase())) {
    throw new ValidationError("A business card must be a photo (JPEG, PNG or WebP).", [{ path: "mimeType", message: "Use a JPEG, PNG or WebP photo.", code: "FILE_TYPE_NOT_ALLOWED" }]);
  }
  const { file, upload } = await createUpload(ctx, { purpose: "ATTACHMENT", name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, checksumSha256: input.checksumSha256 });
  const capture = await adminDb.cardCapture.create({ data: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, fileId: file.id } });
  return { capture: view(capture), upload };
}

/** Likely duplicates for what was read, among what the person may see. Shown before they confirm; confirming checks again. */
async function duplicatePreview(ctx: AuthContext, fields: CardFields) {
  if (!fields.name && !fields.email && !fields.phone) return [];
  const [firstName, ...rest] = (fields.name || fields.company || "Unknown").split(" ");
  const found = await findDuplicates(ctx, { entity: "contact", firstName: firstName!, lastName: rest.join(" ") || undefined, phone: fields.phone || undefined, email: fields.email || undefined });
  return found.candidates.filter((c) => c.confidence !== "low").map((c) => ({ entityType: c.entityType, id: c.id, label: c.label, confidence: c.confidence, reasons: c.reasons }));
}

/** Completes the upload and reads the card. Safe to repeat: a card already read returns what was read. */
export async function extractCard(ctx: AuthContext, captureId: string) {
  requireCaptureRights(ctx);
  const capture = await loadOwn(ctx, captureId);
  if (capture.status === "DISCARDED") throw new NotFoundError("Card capture", captureId);
  if (capture.status !== "UPLOADING") {
    const fields = (capture.extracted ?? null) as CardFields | null;
    return view(capture, { duplicates: capture.status === "EXTRACTED" && fields ? await duplicatePreview(ctx, fields) : [] });
  }
  // The bytes must have arrived, passed the content check and the scan; otherwise the file service refuses and nothing is read.
  await completeUpload(ctx, capture.fileId);
  const { file, data } = await readFileContent(ctx, capture.fileId);
  const extractor = await getCardExtractor();
  let suggestion: Suggested;
  let note: string | null = null;
  try {
    suggestion = readCard(await extractor.extract({ bytes: Buffer.from(data), mimeType: file.mimeType }));
  } catch {
    // A reader that fails must not lose the photo: the person types the fields.
    suggestion = readCard({ text: "" });
    note = "The card could not be read. Type the details in.";
  }
  if (extractor.id === "none") note = "Automatic reading is not set up. Type the details in.";
  else if (!note && CARD_FIELDS.every((k) => !suggestion.fields[k])) note = "Nothing could be read from the photo. Type the details in.";
  const updated = await adminDb.cardCapture.update({ where: { id: capture.id }, data: { status: "EXTRACTED", extractor: extractor.id, extracted: suggestion.fields as never, unsure: suggestion.unsure, extractionNote: note } });
  return view(updated, { duplicates: await duplicatePreview(ctx, suggestion.fields) });
}

export async function getCardCapture(ctx: AuthContext, captureId: string) {
  requireCaptureRights(ctx);
  return view(await loadOwn(ctx, captureId));
}

export interface ConfirmCardInput {
  /** Must be literally true: the person has looked at every field. */
  confirmed: boolean;
  fields: { name: string; company?: string; title?: string; phone?: string; email?: string; website?: string; note?: string };
  duplicateDecision?: DuplicateDecision;
  duplicateId?: string;
  serviceId?: string;
  sourceId?: string;
}

export async function confirmCardCapture(ctx: AuthContext, captureId: string, input: ConfirmCardInput) {
  requireCaptureRights(ctx);
  if (input.confirmed !== true) {
    throw new ValidationError("Check the details and confirm them before saving.", [{ path: "confirmed", message: "Confirm the details first.", code: "CARD_NOT_CONFIRMED" }]);
  }
  if (!input.fields || typeof input.fields !== "object") throw new ValidationError("Send the fields you checked.", [{ path: "fields", message: "The checked fields are required." }]);
  const capture = await loadOwn(ctx, captureId);
  if (capture.status === "CONFIRMED") return { status: "ALREADY_CONFIRMED" as const, capture: view(capture) };
  if (capture.status !== "EXTRACTED") throw new ValidationError("This card has not been read yet.", [{ path: "status", message: "Read the card first.", code: "CARD_NOT_EXTRACTED" }]);

  const f = input.fields;
  const name = cleanText(f.name, "fields.name", MAX_FIELD, { required: true }) ?? "";
  const company = cleanText(f.company, "fields.company", MAX_FIELD) ?? undefined;
  const title = cleanText(f.title, "fields.title", MAX_FIELD) ?? undefined;
  const website = cleanText(f.website, "fields.website", MAX_FIELD) ?? undefined;
  const extra = cleanText(f.note, "fields.note", 1000) ?? undefined;
  const note = [title ? `${title}.` : null, website ? `Website: ${website}.` : null, extra, "From a business card."].filter(Boolean).join(" ");

  // One confirmation at a time: a double tap or a replay cannot make two leads.
  const claimed = await adminDb.cardCapture.updateMany({ where: { id: capture.id, status: "EXTRACTED", outcome: null }, data: { outcome: "IN_PROGRESS" } });
  if (claimed.count !== 1) throw new ValidationError("This card is already being saved.", [{ path: "status", message: "Wait a moment." }]);
  try {
    const result = await quickCapture(ctx, {
      name,
      company,
      phone: f.phone,
      email: f.email,
      note,
      serviceId: input.serviceId,
      sourceId: input.sourceId,
      duplicateDecision: input.duplicateDecision,
      duplicateId: input.duplicateId,
    });
    if (result.status === "DUPLICATE_WARNING") {
      // Nothing was created. The card waits for the person's choice.
      await adminDb.cardCapture.update({ where: { id: capture.id }, data: { outcome: null } });
      return { status: "DUPLICATE_WARNING" as const, duplicates: result.duplicates, hiddenDuplicates: result.hiddenDuplicates, options: result.options };
    }
    if (result.status === "OPENED_EXISTING") {
      // The person chose the record that already exists: no new record, so no photo kept.
      await adminDb.cardCapture.update({ where: { id: capture.id }, data: { status: "DISCARDED", outcome: "OPENED_EXISTING" } });
      await markFileDeleted(ctx, await adminDb.file.findFirstOrThrow({ where: { id: capture.fileId, organizationId: ctx.organizationId } }));
      return { status: "OPENED_EXISTING" as const, existing: result.existing };
    }
    const target =
      result.status === "CREATED"
        ? ({ parent: "lead", id: result.lead.id, leadId: result.lead.id, contactId: result.contact.id } as const)
        : result.mergedInto.type === "lead"
          ? ({ parent: "lead", id: result.mergedInto.id, leadId: result.mergedInto.id, contactId: null } as const)
          : ({ parent: "contact", id: result.mergedInto.id, leadId: null, contactId: result.mergedInto.id } as const);
    // The photo becomes an attachment of the record, visible to whoever can open it.
    await createAttachmentRecord({ organizationId: ctx.organizationId, fileId: capture.fileId, parent: target.parent, parentId: target.id, title: "Business card", shared: true, uploadedByMembershipId: ctx.membershipId });
    const done = await adminDb.cardCapture.update({
      where: { id: capture.id },
      data: { status: "CONFIRMED", outcome: result.status, leadId: target.leadId, contactId: target.contactId, confirmedAt: new Date() },
    });
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "capture.card_confirmed",
      entityType: target.parent === "lead" ? "Lead" : "Contact",
      entityId: target.id,
      metadata: { captureId: capture.id, outcome: result.status, edited: CARD_FIELDS.filter((k) => ((capture.extracted ?? {}) as Record<string, string>)[k] !== (f as Record<string, string | undefined>)[k] && (f as Record<string, string | undefined>)[k] !== undefined).length },
    });
    return { status: result.status, capture: view(done), result };
  } catch (err) {
    await adminDb.cardCapture.updateMany({ where: { id: capture.id, status: "EXTRACTED", outcome: "IN_PROGRESS" }, data: { outcome: null } });
    throw err;
  }
}

/** The person decided not to keep the card: the photo is removed with the usual retention for deleted files. */
export async function discardCardCapture(ctx: AuthContext, captureId: string) {
  requireCaptureRights(ctx);
  const capture = await loadOwn(ctx, captureId);
  if (capture.status === "CONFIRMED") throw new ValidationError("This card was already saved.", [{ path: "status", message: "It is attached to a record now." }]);
  if (capture.status === "DISCARDED") return view(capture);
  const file = await adminDb.file.findFirst({ where: { id: capture.fileId, organizationId: ctx.organizationId } });
  const updated = await adminDb.cardCapture.update({ where: { id: capture.id }, data: { status: "DISCARDED" } });
  if (file && file.status !== "DELETED") await markFileDeleted(ctx, file);
  return view(updated);
}
