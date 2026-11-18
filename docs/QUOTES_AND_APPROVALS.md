# Catalogue, quotes, approvals, pipelines (FIG-1142, 1143, 1144, 1145, 1147; B6.10 to B6.13, B6.15)

Release V1.1. Everything here is behind `release.v11` (pipelines, stage rules) or `quotes.enabled` (catalogue, quotes, approvals); an organisation still on V1 gets the explained "not available yet" answer and the V1 deal behaviour unchanged. The permission keys `quotes.create`, `quotes.approve`, `catalogue.manage` and `deals.margin` only carry weight from V1.1 (`PERMISSION_MIN_RELEASE`).

Screens already built on demo data that these routes replace: `src/ui/screens/commercial/` (quotes list and builder, approvals inbox: `demo/store.ts`), `src/ui/screens/settingsplus/` (Catalogue, Approval rules, Pipelines tabs: `demo/data.ts`), and the quote part of the Customer-facing page. Wiring them is M14 (see `docs/RESTRUCTURE_LOG.md`); no screen was rewired here.

## Who may do what

| Action | Permission |
|---|---|
| Read the catalogue | `catalogue.manage`, `quotes.create`, `quotes.approve` or `deals.view.value`; everyone but `catalogue.manage` sees ACTIVE items only |
| Write the catalogue | `catalogue.manage` (Management). Setting a cost also needs `deals.margin` |
| Read quotes | `quotes.create` or `quotes.approve`, and the right to open the deal (a deal the caller cannot open answers 404) |
| Build, edit, send a quote | `quotes.create` plus edit rights on the deal (`deals.edit.own` or `.all`); sending also needs `communications.create` and the right to see the deal value |
| Decide approvals | `quotes.approve` (Management); nobody decides their own request. Export approvals and erasure confirmations are decided with `security.manage`, as before |
| Rules, pipelines, stage rules, quote settings | `configuration.manage` (Management) |

## Masking (docs/MASKING.md)

- **Catalogue:** `cost` and `marginPct` are `null` with `costMasked: true` for anyone without `deals.margin`, in list, detail and audit (`CatalogueItem` is a money entity in `maskAuditSnapshot`).
- **Quotes:** one function builds every response (`presentVersion`). Prices, line totals, subtotal, discount amount and total follow the deal value rule (`deals.view.value`, or owning the deal). Cost, line cost and margin need `deals.margin` as well; Sales never get them, not even on their own deal. The audit snapshot carries the total only; the audit reader masks it.
- **Client document:** has no field for cost or margin at all.
- **Approvals inbox:** no row carries a money amount. A title names the quote, the company and the discount percentage. The large-deal limit appears in the block message because it is an organisation setting, not a deal value.
- **Timeline:** view events on the deal timeline say "Quote Q-... v1 opened by the client", never an amount.
- Not indexed by search, not in any export, not in the assistant.

## Catalogue (B6.10)

`catalogue_items`: name (unique per organisation), optional unique SKU, kind PRODUCT or SERVICE, unit, price, cost, currency, tax flag, state ACTIVE or HIDDEN. Hidden items stay on quotes that already use them and cannot be added to new lines. Routes: `GET/POST /catalogue`, `GET/PATCH /catalogue/{itemId}`.

## Quotes (B6.11)

- One quote per deal (`Q-YYYY-NNNN`, numbered per organisation under an advisory lock), many numbered versions.
- A version is editable while DRAFT. Submitting it for approval or sending it locks it (`locked_at`). **Immutability is a database rule**: triggers on `quote_versions` and `quote_lines` refuse any change to content, lines or totals of a locked version, any delete of it, and any status step that is not allowed (PENDING_APPROVAL to APPROVED or REJECTED, APPROVED to SENT, SENT to ACCEPTED or DECLINED). Deleting the deal or organisation still removes everything (a cascade).
- Lines come from the catalogue (price and cost frozen on the line when added; a catalogue change never alters a quote; a new version can ask to refresh) or are custom lines (description and price typed by the builder, no cost). A catalogue line cannot carry a different price: the only way down is the discount (0 to 30 percent).
- **Custom lines need `catalogue.manage`.** A custom line takes any price, so letting Sales add one would walk round the discount approval (a line priced 40 percent low with a 0 percent discount never reaches the threshold). Anyone without the permission gets the explained 403; a line already on a draft keeps its frozen price. Sales build quotes from the catalogue and use the discount field, which is what the approval rule watches.
- Totals are in cents: subtotal less discount. Prices include VAT, as the terms say; the document marks lines with no VAT.
- Validity date (default 30 days, `quote-settings`), terms (default text, `quote-settings`). Expired is derived, not stored.
- Declined by an approver means REJECTED with the reason; the requester makes a new version.
- "Use the quote total" copies a version total to the deal value (`apply-to-deal`, needs value visibility).
  Only an APPROVED, SENT or ACCEPTED version can set the deal value (a draft, a pending or a rejected one answers `VERSION_NOT_FINAL`).
- **Proposal Sent gate:** the `QUOTE_REQUIRED` stage rule (below) on the Proposal Sent stage. The `quote-settings` switch `requireForProposalSent` turns that rule on or off for the Proposal Sent stages. Valid means some version is APPROVED, SENT or ACCEPTED and its validity date has not passed. Reasons: `QUOTE_REQUIRED`, `QUOTE_NOT_APPROVED`, `QUOTE_EXPIRED`.

Routes: `GET/POST /deals/{dealId}/quote`, `GET /quotes`, `GET /quotes/{quoteId}`, `POST /quotes/{quoteId}/versions`, `GET/PUT /quotes/{quoteId}/versions/{n}`, `POST .../response` (a person records accepted or declined), `POST .../apply-to-deal`, `GET/PATCH /quote-settings`. Creates take an `Idempotency-Key`.

## Document, send, tracking (B6.12)

- `renderQuoteHtml` is one pure function used by the preview and the send. HTML with its own styles and a print stylesheet (the browser prints it to PDF; there is no server-side PDF library, a known gap). Organisation branding: display name, accent colour, contact lines, and the logo when "show logo on client pages" is on (the logo link is signed and short lived, so the stored document holds a placeholder and the public page swaps in a fresh link).
- **Preview matches the sent document:** the exact HTML that was emailed is stored on the share row; the client always sees that snapshot and the preview of a sent version returns it. `GET .../preview` returns `{source, html, sha256}`.
- **Send** (`POST .../send`): email first (through `sendAndLogEmail`, so the message is logged on the deal and uses an email template when `templateId` is given); then the version is locked as SENT, the share link is created and a SENT event recorded. A discount above the approval limit answers `APPROVAL_REQUIRED` until approved. Sending an already sent version again makes another link.
- **Link:** 32 random bytes, only the SHA-256 is stored. It expires at the end of the quote validity day, at most 90 days, sooner if the sender asks; it can be revoked. Public route `GET /api/public/quotes/{token}` (rate limited, `noindex`, strict CSP): 404 for unknown or revoked, 410 for expired.
- **Tracking:** every open is a VIEWED event and counts; the deal timeline gets an entry for the first view and then at most one an hour. An expired open is recorded as `LINK_EXPIRED_VISIT`. `GET .../activity` lists links and events (never tokens).
- **Link rules and limits:** a link stops working (not found, no event, no timeline entry) when the organisation is not ACTIVE, `quotes.enabled` is off, the version is REJECTED, or a newer version has been SENT or ACCEPTED. A link logs at most one VIEWED event per 10 minutes and one LINK_EXPIRED_VISIT per hour (the view counter still counts every open). The recipient address must be a single plain address (same pattern as the mail service). Migration `20261119120000_quote_guards_strict` makes the database refuse a DRAFT version jumping to APPROVED, REJECTED, ACCEPTED or DECLINED (a draft only becomes PENDING_APPROVAL or SENT, locked in the same statement) and a line being moved into a locked version.

## Approvals (B6.13)

Rules (`GET/PATCH /approval-rules`): discount threshold (default 5 percent), large deal (off by default; 1,000,000 KES when switched on), export threshold (stored with the export rights of B4.05, shown and changed here), deletion (always on, cannot be switched off). **A rule only decides that an action waits; a person approves** (hard rule 9).

| Kind | What waits | On approval (the blocked action resumes by itself) | On rejection |
|---|---|---|---|
| DISCOUNT | a quote version above the limit; requesting locks it (PENDING_APPROVAL) | APPROVED; if the requester asked (`sendOnApproval`), the quote is sent to the address they gave, as them | REJECTED with the reason; make a new version |
| LARGE_DEAL | moving a deal above the limit to a won stage, or into a stage with an approval rule | the move is made for the requester at once; if it fails the approval stays a one-use grant for 7 days and the reason is recorded | nothing moves |
| EXPORT | bulk export approvals (B4.05, own table) | the export is started for the requester | reason shown to the requester |
| DELETION | the second confirmation of a contact erasure (B4.05, own table) | the erasure runs | the request goes back to open |

Inbox: `GET /approvals` (approvers see everything with a pending count; others see only their own, read-only), `GET /approvals/{id}`, `POST /approvals/{id}/decision {approve, reason}` (a rejection needs a reason of at least 3 characters, the requester reads it), `POST /approvals/{id}/cancel` (the requester withdraws), `POST /quotes/{id}/versions/{n}/request-approval`, `POST /deals/{id}/request-approval`. A request is decided once (database guard, plus a conditional update), asking twice returns the same open request, and a decided request cannot be rewritten (trigger). Notification: email to approvers on a request and to the requester on a decision (no amounts); the inbox pending count is the in-app signal.

## Pipelines and stage rules (B6.15)

- `pipelines` (one default per organisation, partial unique index; the default is always active), `pipeline_stages.pipeline_id`, `pipeline_services` (a service belongs to one pipeline), `stage_rules`.
- **Migration:** every organisation gets one default pipeline "Sales" holding all its stages; no stage has a rule (an existing "Proposal Sent needs a valid quote" setting becomes that rule). A trigger puts a stage created the old way into the default pipeline, and a new organisation gets its default pipeline with it, so V1 behaviour and the seed are unchanged. The board shows the default pipeline unless `pipelineId` is given.
- A pipeline has at least one open stage, exactly one won and exactly one lost stage. Stages are switched off, never deleted, and not while open deals are in them. Stage keys are unique across the organisation, so new stages carry the pipeline key. Open stages can be added at a position and reordered; won and lost stay last.
- Rules per stage (`PUT /pipelines/{id}/stages/{stageId}/rules`): `QUOTE_REQUIRED`, `REQUIRED_FIELDS` (value, expectedCloseDate, primaryContactId, serviceId, notes, `custom:<key>`), `APPROVAL_REQUIRED`. The save returns a plain-words impact line. Closed Lost always needs a reason (not configurable) and takes no other rule.
- **Blocked moves explain themselves:** `checkDealMove` and `moveDeal` return every reason at once with a code (`QUOTE_REQUIRED`, `QUOTE_NOT_APPROVED`, `QUOTE_EXPIRED`, `REQUIRED_FIELDS_MISSING` with the field names, `APPROVAL_REQUIRED`, `WRONG_PIPELINE`) and a message such as "Proposal Sent needs Expected close date and Primary contact filled in first."
- A move into a stage of another pipeline needs `changePipeline: true` and then meets that stage rules.
- Routes: `GET/POST /pipelines`, `GET/PATCH /pipelines/{id}`, `POST /pipelines/{id}/stages`, `PUT /pipelines/{id}/stages/reorder`, `PATCH /pipelines/{id}/stages/{stageId}`, `PUT .../rules`.

## Tests

`tests/catalogue.test.ts`, `tests/quotes.test.ts`, `tests/quoteDocument.test.ts` (with a rendering snapshot), `tests/approvals.test.ts`, `tests/pipelines.test.ts`. They cover masking per role, the database immutability, link expiry and views, the workflow in both directions, isolation between organisations (service and database level) and the V1 no-change cases.

## Known gaps and decisions taken

- No server-side PDF (the HTML is print ready). Quote e-signature and deposits are V2.
- Approvals do not add a notification type (the type list is part of the frozen V1 contract and a Postgres enum); email and the inbox count are used. Add `APPROVAL_REQUESTED` and `APPROVAL_DECIDED` with a contract update if in-app bells are wanted.
- A sole Management member cannot approve their own request (same rule as export approvals); an organisation needs two approvers.
- One quote per deal. The `proposals` references of V1 stay as they are and do not satisfy the quote gate.
- The catalogue has no export or search entry on purpose.
- Services per pipeline are stored and returned; creating a deal does not pick a pipeline from its service by itself.
