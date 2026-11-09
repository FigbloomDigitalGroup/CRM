# E-signature and Swahili for client documents (FIG-1186 B7.04, FIG-1189 B7.07)

Release V2. Online signing needs the organisation to be on release `v2` (`release.v2`) on top of `quotes.enabled`; below that the signing link cannot be created and an address under `/sign/` answers the plain "not available" 404. Swahili needs no flag: a language is a property of one document, and English stays the default everywhere.

FIG-1187 (B7.05, deposit request) is **not built**: it is decision-gated and no decision exists (see the end).

## E-signature (B7.04)

**Sending.** `POST /orgs/{org}/quotes/{quoteId}/versions/{n}/send` accepts `allowSigning: true` and `language: "en" | "sw"`. With `allowSigning` the share is created with `signing_enabled`, and the email carries a second link, `{APP_BASE_URL}/sign/{token}`, next to the quote link. The token is the same secret as the quote link (only its SHA-256 is stored). Below release V2 the request is refused up front (`SIGNING_NOT_AVAILABLE`, 400) and nothing is sent or locked. The response gives `signLink` once, like `link`. `sendOnApproval` takes the same two fields.

**The client.**
- `/sign/{token}` (page, `src/app/sign/[token]/`): the quote, a name, an optional email, one consent tick and one button; EN/SW switch. Submitting runs a server action that calls the same service as the API.
- `GET /api/public/sign/{token}`: the page data. `POST /api/public/sign/{token}`: signs. Body: `signerName`, `consent: true`, optional `signerEmail`, optional `signature: {kind: "TYPED" | "DRAWN", data?}`, optional `language`. Unknown fields are refused.
- Answers: 404 unknown, revoked, replaced by a newer sent version, not a signing link, deactivated organisation, or below V2 (all look the same); 410 `LINK_EXPIRED`; 409 `ALREADY_ANSWERED` or `DOCUMENT_INTEGRITY`; 400 with field codes (`NAME_REQUIRED`, `CONSENT_REQUIRED`, `INVALID_EMAIL`, `INVALID_SIGNATURE_IMAGE`, `SIGNATURE_MISMATCH`, `INVALID_SIGNATURE_KIND`); 201 with `{status: "signed", signedAt, signerName, sealSha256, reference}`. The error body is the standard envelope; the three codes `LINK_EXPIRED`, `ALREADY_ANSWERED`, `DOCUMENT_INTEGRITY` are specific to this route (the V1 code list is frozen, and the route is outside the V1 contract).
- Rate limit: `QUOTE_SIGN`, 60 per 15 minutes per address (page, API and action).

**What signing records** (`quote_signatures`, one per version): signer name and email, signature kind and data (the typed name, or a PNG data URL of at most 120,000 characters whose bytes start with the PNG signature), the consent wording the person saw and its language, the SHA-256 of the exact document that was sent, time, IP address, user agent, and a **seal**: a SHA-256 over all of those fields in a fixed order (`src/lib/quoteSignature.ts`). In the same transaction the version moves SENT to ACCEPTED (the existing database rules already make ACCEPTED final). A `SIGNED` event, an audit entry (`quote.signed`, no amounts, actor is the signer) and a deal timeline entry are written. Nothing moves a deal stage, applies a discount or approves anything (hard rule 9).

**Immutable (database):** a trigger refuses any update or delete of a signature (only a cascade from the quote, deal or organisation removes it) and refuses an insert unless the version is SENT. A second trigger fixes the sent document, its hash, token hash, version, language and `signing_enabled` on `quote_shares`. Two people signing at once: the first wins, the second gets `ALREADY_ANSWERED`.

**Verifiable:** `verifySignatureRecord` recomputes the seal, the signature hash and the document hash from what is stored. Staff read the result in `GET .../versions/{n}/activity` (no new route): `signatures` with `verification: {sealValid, signatureValid, documentValid, ok}`. The signed record proves a document that is all prices, so it follows the deal value rule: without the right to see the value the response has `signatures: null` and `signaturesMasked: true` (the events still show that a signature happened). Signing itself is refused if the stored document no longer matches its hash.

**Not included:** the PDF of the signed quote (the HTML is the document, as for B6.12, a known gap); a notification to the deal owner (the timeline entry and the `SIGNED` event are the signal); a drawing pad in the page (the API accepts a drawn PNG, the page offers the typed signature); declining online.

## Swahili (B7.07)

- **Catalogue:** `src/lib/clientText.ts`. English is complete; Swahili may lack a key, and then the English text is used and recorded (`fellBack`). Documents show a visible note ("Some text on this page is shown in English", in Swahili when that text exists), the web form definition lists `fallbackKeys`.
- **Per document:** quote document and email (`language` on send, `?language=sw` on preview; stored on the share, fixed by a trigger), signing page (starts in the document's language, the person may switch; the record keeps the wording shown at signing), web form (`language` on create and update, returned by the public definition with the form's own text; the built-in thank-you follows the language, the organisation's own wording is never changed).
- **Formats:** money and dates follow the language (`sw-KE` for Swahili; English keeps the formats the document always used); times on the signing page are East Africa Time.
- **Tests:** `tests/clientLanguage.test.ts` (snapshots for both languages in `tests/__snapshots__/`), `tests/quoteSignature.test.ts`.

**Review needed (human):** the Swahili text was drafted by the build team and **has not been reviewed by a native speaker**. `TRANSLATION_REVIEW.sw` is `PENDING_HUMAN_REVIEW`. Correct the strings in `src/lib/clientText.ts` (the snapshots will then need `vitest -u`) and flip the status. The Swahili captcha line is deliberately missing, to prove the fallback; a test pins that list.

## Migration

`20261122090000_quote_signing`: `quote_signatures` (RLS, FKs, checks, guard trigger), `quote_shares.signing_enabled` and `.language` with the document guard trigger, `web_forms.language`, `quote_events` types `SIGNED` and `SIGN_REFUSED`, rate-limit action `QUOTE_SIGN`.

## FIG-1187, deposit request: not built

`docs/DECISIONS.md` 2.5 and 13 keep payments out until the business decides. Needed from Given or Michael: (1) approve taking deposits through the CRM, yes or no; (2) if yes, the provider. If no, the issue is cancelled with a note (the acceptance criteria say so); only Given cancels.
