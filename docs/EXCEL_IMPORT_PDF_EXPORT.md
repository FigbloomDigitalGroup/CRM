# Excel import and PDF export (FIG-1680 addition, 16 Nov 2026)

Asked for by the Sales team: bring lists in from Excel, take a readable copy out as a PDF. Both ride on the CSV paths. There is no new API route and no contract change.

## Excel import

- **Where:** the import wizards for Leads (`src/ui/screens/leads/ImportWizard.tsx`), Contacts (`contacts/ImportExport.tsx`) and Companies (`customers/ImportCsvDialog.tsx`). The button reads **Import CSV / Excel**.
- **How:** `src/ui/screens/leads/sheet.ts` (`readSheetText`) returns CSV text for a `.csv` and, for an `.xlsx`, loads the workbook in the browser (the library, `exceljs`, is fetched only when somebody picks an `.xlsx`) and writes its first sheet as CSV. From there the wizard is unchanged: column mapping, the same import route (`/leads/import`, `/contacts/import`, `/companies/import`), same permission, scope, duplicates, validation and audit. The server only ever receives CSV, so Excel can never do more than CSV could.
- **Reading rules:** first sheet; header row first; a formula gives its last calculated value; a date becomes `YYYY-MM-DD` (with a time when it has one); rich text and links give their words; blank rows are skipped. Limits: 25 MB file, 100 columns, 50,000 rows.
- **Plain messages:** a file named `.xlsx` that is not a workbook, an old `.xls`, too many columns or rows. Nothing is imported.

## PDF export

- **Where:** an **Export PDF** button beside Export CSV on Leads, Contacts, Companies and Deals, shown under the same permission key as the CSV export (`leads.export`, `contacts.export`, `companies.export`, `deals.export`).
- **How:** the screen asks the server for the same CSV as before (same endpoint, so the same permission check, scope, masking, row cap, rate limit, audit entry and Management alert), then `src/ui/screens/leads/pdfExport.ts` (`csvToPdf`, using `pdf-lib`, loaded only on demand) draws it. The PDF therefore holds exactly what the CSV holds for that role. Rule 7 (masking) needs no separate handling because nothing is read except the already-masked CSV.
- **Layout:** A4 landscape, title, a line with who exported and when, a header row repeated on every page, page numbers. Long text is cut with "...". The standard PDF font covers Western European letters; any other character prints as "?".
- **Limit:** 1,000 rows. Above that the person is told to narrow the filters or use CSV. A PDF never uses the bulk-export or approval path (that stays CSV-only), and a refusal by the server is shown with that explanation.

## Tests

- `tests/sheetImportPdfExport.test.ts`: workbook to rows (quotes, line breaks, formulas, dates, blank rows, bad file, `.xls`, 101 columns), PDF (one page, pagination, wide and non-Latin text, formula-guard apostrophe, empty, over the cap, subtitle).
- `e2e/xlsx-import-pdf-export.spec.ts`: signed in as Sales, imports an `.xlsx` of contacts and sees them created, a fake `.xlsx` is explained, and PDFs download for leads, contacts, companies and deals.
- Updated for the renamed button and heading: contacts screen, leads list and lead flow component tests, and the leads e2e spec.

## Not done

- Excel export (`.xlsx`) and PDF for reports, audit and the migration wizard (the migration wizard already reads `.xlsx` on the server).
- PDF for lists above 1,000 rows.
- Visual design review of the PDF layout.
