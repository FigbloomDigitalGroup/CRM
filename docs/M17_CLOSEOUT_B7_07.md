# M17 close-out: FIG-1189 (B7.07) Swahili for the client quote, signing page and web form

Facts only. Verified against the code on branch `makeover/m17-closeout`.

## Criterion table

| Scope / criterion | Code | Proving test | Verdict |
|---|---|---|---|
| Translation keys for the three surfaces | `src/lib/clientText.ts` (55 keys: `doc.*`, `mail.*`, `sign.*`, `form.*`) | `tests/m17closeSwahili.test.ts` "key parity" (3 tests; closed `Record<ClientTextKey,true>` list) | Met |
| Swahili complete or visibly falling back | `createTranslator` (`fellBack`), `form.captcha` deliberately missing | `clientLanguage.test.ts` "falls back to English for a key with no Swahili text"; "when a Swahili text is missing the English shows and the page says so"; new parity test pins the fallback list | Met (document and form definition); see gap 3 |
| Language stored per quote and per form | `quote_shares.language` (trigger-fixed), `web_forms.language` | `clientLanguage.test.ts` "previews and sends one document per language, and the share keeps the language"; "English is the default; the language is saved, validated and returned" | Met |
| Language chosen per document | `language` on send / preview / form create+update | same files | Met |
| Dates and KES per locale | `formatMoneyFor`, `formatDateFor`, `formatMomentFor` (East Africa Time) | `clientLanguage.test.ts` "formats dates and money..."; new "formats KES per language" | Met |
| Switch on the signing page, no sign-in | `LiveSign.tsx` EN/SW buttons; `getSigningPage(token)` has no auth | new `tests/components/commercial/m17closeSwahiliSign.test.tsx` "starts in the document's language and the visitor can switch both ways"; new "page data is readable with the token alone" | Met |
| Unsupported locale refused or safe | `requireLanguage` (400 `INVALID_LANGUAGE`) on send/preview/form; sign path falls back to the document language | `clientLanguage.test.ts` (refusals); new "an unsupported language on signing falls back to the document's language" | Met |
| No internal value (rule 7) in either language | document and page are built from explicit field lists with no cost field | new "quote document, stored share and signing page data carry no cost or margin" (cost 11,000 exists on the line, absent from en and sw output); component test "no cost, margin or internal wording" | Met |
| Signed record keeps the language the signer saw | `signQuote` stores `language` and the consent wording in that language, both inside the seal | `quoteSignature.test.ts` "keeps the language the client saw"; new: switched to English, unsupported `fr`, no language given | Met |
| Snapshot tests per locale | snapshots | quote document: `clientLanguage.test.ts` (en, sw, existing). Signing page: new component snapshots en, sw, expired-sw. Web form definition: new inline snapshots en, sw | Met |
| Reviewed translations | `TRANSLATION_REVIEW.sw = "PENDING_HUMAN_REVIEW"` | `clientLanguage.test.ts` pins the status | **Met (12 Nov 2026): reviewed and approved by a native Swahili speaker (Given); `TRANSLATION_REVIEW.sw = "COMPLETE"`.** The Swahili captcha line is still missing on purpose, so that one line shows in English (the fallback) |

## Hard-coded English found (not fixed, reported)

1. `src/app/sign/[token]/not-found.tsx`: "This link is not available / Online signing is not switched on..." Static English. By design it is the same 404 for every refused link, so no language is known; left as is (changing it would also say which language a link was sent in).
2. `src/services/webFormSubmissionService.ts`: API error messages "Please check your answers.", "This submission was not accepted.", "Missing or invalid captcha token." are English. The key `form.fixFields` exists and is returned in the form definition text, so an embed can show the Swahili text itself; the server error string is not translated. Embed-facing API text, not a rendered page.
3. `LiveSign.tsx`: the "shown in English" note is only rendered in the unsigned form, and the signing page uses no key that is missing in Swahili today, so the visible-fallback note on the signing page cannot appear with the shipped catalogue (only `form.captcha` is missing, and it is not on that page). The mechanism is the same translator that is tested on the document.
4. `src/app/sign/[token]/SignClient.tsx` + `demoSigning.ts`: old demo signing component with its own English/Swahili table and fixed "FigBloom Digital Group". It is not used by `page.tsx` (only by its own component test); dead code, not removed (rule 4: no deleting).
5. `quoteSignatureService.organisationName` falls back to the English "the sender" when an organisation has no name (edge case).
6. The public web form has no rendered Next.js page in the repo: the public surface is the JSON definition (`GET /api/public/orgs/{org}/forms/{key}`) plus the embed. Field labels are the organisation's own text and are not translated (intended).

No product code was changed. No leaked internal field and no wrong format was found.

## Tests added (all passing in this run)

- `tests/m17closeSwahili.test.ts` (14 tests): key parity (3), unsupported locale and formats (3), rule 7 (2), signing language and the signed record (4), web form definition snapshots en and sw (2).
- `tests/components/commercial/m17closeSwahiliSign.test.tsx` (5 tests) with `tests/components/commercial/__snapshots__/m17closeSwahiliSign.test.tsx.snap` (3 snapshots).

Run against `figbloom_crm_test_c`: those two files, plus `tests/clientLanguage.test.ts`, `tests/quoteSignature.test.ts`, `tests/components/commercial/sign.test.tsx` (all green). `npx eslint` on the two new files: clean. `npm run typecheck`: one error, in another lane's file `tests/m17closeRolesB706.test.ts(164,7)` (TS2554); none in my files.

Not run: full suite, Playwright, any server, mail sending, a real browser check of the signing page.

## Swahili strings added

None. All existing Swahili text was written by the build team and is unreviewed (machine quality, needs native review), including the consent wording that is recorded in signed records.

## Recommended state

**Done (12 Nov 2026): native-speaker sign-off recorded.** Earlier state, kept for the record: **In Review.** "Reviewed translations" is in scope and needs a native speaker; the code records `PENDING_HUMAN_REVIEW`, not a sign-off. Open for a person: review the Swahili in `src/lib/clientText.ts`, supply `form.captcha`, run `vitest -u` for the snapshots if wording changes, then flip `TRANSLATION_REVIEW.sw`.
