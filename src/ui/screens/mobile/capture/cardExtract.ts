import type { ApiClient } from "@/api-client";
import { newIdempotencyKey, putSignedUpload } from "../../../data/client";

/**
 * Business-card reading (M4, FIG-1177) on the real API (docs/CARD_CAPTURE.md): declare the photo, send the bytes to the signed link, then ask the
 * server to read it. Whatever comes back is only ever a suggestion: nothing is created until the person checks every field and presses Save, which
 * calls the confirm route (`confirmCard` in Sheets). Fields the reader was unsure about are flagged.
 */

export type CardField = "name" | "company" | "title" | "phone" | "email" | "website";

export interface ExtractedCard {
  /** The server's id of this capture: Save confirms it, so the photo is attached to the lead. */
  captureId: string;
  name: string;
  company: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  /** Fields the reader was not sure of, so the person is asked to check them. */
  unsure: CardField[];
  /** The server's note when nothing could be read ("Type the details in."). */
  note: string | null;
}

interface StartAnswer {
  capture: { id: string };
  upload: { url: string; method?: string; headers?: Record<string, string> };
}
interface ExtractAnswer {
  fields: Partial<Record<CardField, string>> | null;
  unsure: CardField[];
  note: string | null;
}

/** Sends the photo and returns what the server read from it. Throws the API's error (wrong file type, too large, offline) for the sheet to explain. */
export async function extractCard(api: ApiClient, orgSlug: string, photo: File): Promise<ExtractedCard> {
  const started = (await api.call("postQuickCaptureCards", {
    params: { orgSlug },
    body: { name: photo.name || "card.jpg", mimeType: photo.type, sizeBytes: photo.size } as never,
    idempotencyKey: newIdempotencyKey(),
  })) as unknown as StartAnswer;
  await putSignedUpload(started.upload, photo);
  const read = (await api.call("postQuickCaptureCardsByCaptureIdExtract", { params: { orgSlug, captureId: started.capture.id }, idempotencyKey: newIdempotencyKey() })) as unknown as ExtractAnswer;
  const f = read.fields ?? {};
  return {
    captureId: started.capture.id,
    name: f.name ?? "",
    company: f.company ?? "",
    title: f.title ?? "",
    phone: f.phone ?? "",
    email: f.email ?? "",
    website: f.website ?? "",
    unsure: read.unsure ?? [],
    note: read.note ?? null,
  };
}

/** Throws away a card the person did not keep (the photo goes with it). Best effort: an unconfirmed card is harmless. */
export async function discardCard(api: ApiClient, orgSlug: string, captureId: string): Promise<void> {
  await api.call("deleteQuickCaptureCardsByCaptureId", { params: { orgSlug, captureId } });
}

/** The sentence that goes above the form after a scan. */
export function scanSummary(card: Pick<ExtractedCard, "name" | "unsure" | "note">): string {
  if (!card.name && card.note) return `${card.note} Check the fields before saving.`;
  const check = card.unsure.length ? ` Not sure about the ${card.unsure.join(" and ")}.` : "";
  return `Read “${card.name}” from the card.${check} Check the fields before saving.`;
}

/** What goes into the capture form: only what the form has a place for. The job title and company go in the note so nothing is lost. */
export function cardToCapture(card: Pick<ExtractedCard, "name" | "company" | "title" | "phone" | "email">): { name: string; phone: string; email: string; note: string } {
  return { name: card.company || card.name, phone: card.phone, email: card.email, note: card.name ? `${card.name}${card.title ? `, ${card.title}` : ""}. From a business card.` : "From a business card." };
}
