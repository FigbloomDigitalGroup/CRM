# Excel import and PDF export (FIG-1680 addition, 16 Nov 2026)

Asked for by the Sales team: bring lists in from Excel, take a readable copy out as a PDF. Both ride on the CSV paths. There is no new API route and no contract change.

## Excel import

- **Where:** the import wizards for Leads (`src/ui/screens/leads/ImportWizard.tsx`), Contacts (`contacts/ImportExport.tsx`) and Companies (`customers/ImportCsvDialog.tsx`). The button reads **Import CSV / Excel**.
- **How:** `src/ui/screens/leads/sheet.ts` (`readSheetText`) returns CSV text for a `.csv` and, for an `.xlsx`, loads the workbook in the browser (the library, `exceljs`, is fetched only when somebody picks an `.xlsx`) and writes its first sheet as CSV. From there the wizard is unchanged: column mapping, the same import route (`/leads/import`, `/contacts/import`, `/companies/import`), same permission, scope, duplicates, validation and audit. The server only ever receives CSV, so Excel can never do more than CSV could.
- **Reading rules:** first sheet; the header is found even when there is a title or a summary band above the table (the row with the most different text cells in the first 40 rows; a row of totals never wins, and an ordinary sheet keeps its first row); columns with no heading are dropped; a formula gives its last calculated value; a date becomes `YYYY-MM-DD` (with a time when it has one); rich text and links give their words; blank rows are skipped. Limits: 25 MB file, 100 columns, 50,000 rows.
- **Plain messages:** a file named `.xlsx` that is not a workbook, an old `.xls`, too many columns or rows. Nothing is imported.

## Importing what the sheet has (17 Nov 2026, from a real schools sheet)

A lead import no longer fails a row because something is not in the CRM yet. Code: `importLeads` in `src/services/importService.ts`; matching of columns: `src/ui/screens/leads/columnGuess.ts`.

- **Columns are matched by name, loosely.** Exact names first, then a heading that contains a known name (four letters or more): "School Name" is the company, "Email Address" the email, "Phone Number" the phone, "Urgency Level" the temperature, "Client Feedback" the notes. Anything not matched stays "Not in the file" and can be chosen by hand. The wizard also has a new optional "Person's name" column.
- **Company:** linked when one with that name exists, created when it does not (the importer's role needs `companies.create`; without it the lead comes in unlinked, with a note). Two companies with the same name: left unlinked, with a note.
- **Email and phone are now saved** (before, they were only used to spot duplicates and were lost). They go on a contact: an existing contact with the same email is reused, otherwise one is created (`contacts.create` needed; without it, a note). With no person's name the contact takes the company's name until somebody adds the person. A cell with several numbers ("254 734 808 355 / 254 718 164 141") keeps the first as the phone and the rest in the contact's notes. An invalid email is not saved, with a note. Notes are saved on the lead (the importer used to drop them).
- **Values the organisation does not have yet are not a reason to lose the row:** an unknown status uses the default status; an unknown source or service is left blank; an unknown owner email makes the lead the importer's; a temperature that is not hot, warm or cold is left at the default. High, urgent, medium, normal and low are read as hot, hot, warm, warm and cold. Each case is listed as a note ("Imported, but ...") on the result screen and in the report, so it can be fixed on the lead later. Handing a lead to another person still needs `leads.assign` and still fails the row.
- **Still refused:** a row with nothing in any mapped column ("This row is empty").
- **Duplicates are unchanged:** with "skip", a person or company already in the CRM, or with an open lead, is reported and skipped; "create it anyway" adds the lead to the existing records. Running the same file twice skips every row the second time.
- **One company or contact per name or email**, however many rows of one file name it. Nothing is created for a row that turns out to be a duplicate. The audit entry carries how many companies and contacts the import created.

## PDF export

- **Where:** an **Export PDF** button beside Export CSV on Leads, Contacts, Companies and Deals, shown under the same permission key as the CSV export (`leads.export`, `contacts.export`, `companies.export`, `deals.export`).
- **How:** the screen asks the server for the same CSV as before (same endpoint, so the same permission check, scope, masking, row cap, rate limit, audit entry and Management alert), then `src/ui/screens/leads/pdfExport.ts` (`csvToPdf`, using `pdf-lib`, loaded only on demand) draws it. The PDF therefore holds exactly what the CSV holds for that role. Rule 7 (masking) needs no separate handling because nothing is read except the already-masked CSV.
- **Layout:** A4 landscape, title, a line with who exported and when, a header row repeated on every page, page numbers. Long text is cut with "...". The standard PDF font covers Western European letters; any other character prints as "?".
- **Limit:** 1,000 rows. Above that the person is told to narrow the filters or use CSV. A PDF never uses the bulk-export or approval path (that stays CSV-only), and a refusal by the server is shown with that explanation.

## Tests

- `tests/leadImportLenient.test.ts` (database): the schools sheet end to end (companies and contacts created, email, phone, notes, temperature, notes to add later), reuse of an existing company and contact, one company for many rows, unknown source, service and owner, an empty row, a second run, and another organisation's company never linked. `tests/importService.test.ts` was rewritten for the new rule (an unknown status or temperature no longer fails the row).
- `tests/sheetImportPdfExport.test.ts`: workbook to rows (quotes, line breaks, formulas, dates, blank rows, bad file, `.xls`, 101 columns), PDF (one page, pagination, wide and non-Latin text, formula-guard apostrophe, empty, over the cap, subtitle).
- `e2e/xlsx-import-pdf-export.spec.ts`: signed in as Sales, imports an `.xlsx` of contacts and sees them created, a fake `.xlsx` is explained, and PDFs download for leads, contacts, companies and deals.
- Updated for the renamed button and heading: contacts screen, leads list and lead flow component tests, and the leads e2e spec.

## Not done

- Excel export (`.xlsx`) and PDF for reports, audit and the migration wizard (the migration wizard already reads `.xlsx` on the server).
- PDF for lists above 1,000 rows.
- Visual design review of the PDF layout.
