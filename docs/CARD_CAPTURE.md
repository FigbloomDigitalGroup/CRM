# Business-card capture and camera attachments (FIG-1154, B6.22)

Mobile design M4. Depends on the upload pipeline (B1.07) and quick capture (B4.08).

| Piece | Where |
|---|---|
| Table `card_captures` (RLS, composite FKs to memberships and files) | `prisma/migrations/20261110120000_card_captures` |
| Reader seam, card text parser, vision extractor | `src/capture/cardExtractor.ts` |
| Service | `src/services/cardCaptureService.ts` |
| Routes | `src/app/api/orgs/[orgSlug]/quick-capture/cards/*` |

## Flow

1. `POST .../quick-capture/cards` `{name, mimeType, sizeBytes, checksumSha256?}` declares a JPEG, PNG or WebP photo and returns the signed upload link (the file service applies type, size, checksum rules).
2. The phone uploads the bytes.
3. `POST .../cards/{id}/extract` completes the upload (content sniffing, virus-scan hook), reads the card and returns the SUGGESTED `fields` (name, company, title, phone, email, website), `unsure` fields, a `note` when nothing could be read, and `duplicates`. **Nothing is created.**
4. `POST .../cards/{id}/confirm` with `confirmed: true` and the fields the person saw and edited. Only now does a lead exist. It runs through quick capture (same defaults, permissions and duplicate warning as a typed lead); a duplicate answers `DUPLICATE_WARNING` and saves nothing until the person picks open existing, merge or create anyway. The photo is attached to the lead (or the record merged into); opening the existing record drops the photo. Send an `Idempotency-Key`; a double or racing confirmation makes one lead (`ALREADY_CONFIRMED` after).
5. `DELETE .../cards/{id}` discards the card and the photo (normal deleted-file retention).

## Reading

`CardExtractor` turns the photo into text (and optionally fields); `readCard` finds fields in the text and lists missing or doubtful ones (two different phone numbers, short number, malformed email) as `unsure`. The default extractor is a vision model through the Anthropic SDK client when `ANTHROPIC_API_KEY` is set (the same optional package as the assistant, see `docs/ASSISTANT.md`); otherwise the person types the fields and the note says so. An OCR engine can be plugged in with `setCardExtractorFactory`. A reader that throws keeps the photo and falls back to typing. The image is untrusted: the vision prompt says to ignore printed instructions, and the output is only ever shown for confirmation.

## Camera attachments

A phone photo on a lead, deal, contact, company or task uses the existing attachment pipeline (`docs/M8_*`/FIG-796): signed upload, content check, scan, access by record. HEIC is refused up front (the phone converts to JPEG). The offline queue entry for photos is the sync queue's concern (FIG-799/B4.07); no new queue was added.

## Requirements

`leads.create`, `contacts.create` and `attachments.manage` (the photo is an attachment). A capture belongs to the person who took it; others and other organisations get 404.

## Screens to wire

`src/ui/screens/mobile/capture/cardExtract.ts` and `ScanCard.tsx` (swap the sample reader for start, upload, extract; Save calls confirm) and `photos.ts` (swap for the attachment upload). Not wired in this issue.

## Tests

`tests/cardCapture.test.ts`: fixture photos and a fake reader, suggest-only reading, unsure flags, fallback to typing, file checks, explicit confirmation and edited fields saved, attachment on the lead, validation as if typed, double/racing/idempotent confirmation, duplicate warning, merge, open existing, create anyway, roles, ownership and cross-organisation, discard, RLS, camera attachments, text parser and vision extractor fixtures.
