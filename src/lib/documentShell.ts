/**
 * The page a client-facing document (quote, invoice) is printed on (UC-R6): one set of styles and one outer layout, so a quote and an invoice
 * look like they come from the same organisation and print the same way. Pure strings, no data of its own.
 *
 * Printing is the browser's own (decision UC-D3, no new dependency): `@page` sets A4, rows and the totals block never split across pages,
 * the table header repeats on every page, the brand colour is kept, and the on-screen "Print or save as PDF" button is hidden on paper.
 * The document carries no script (a test guards that, so stored text can never run code). The "Print or save as PDF" button lives in the
 * app, which opens the document in its own window and prints it; a client who opens the link uses the browser's own print command.
 */

import type { ClientLocale } from "./clientText";

export const LOGO_PLACEHOLDER = "__QUOTE_LOGO_URL__";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function safeColour(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#1f6f4a";
}

export function documentStyles(accent: string): string {
  return `:root{--accent:${accent};--ink:#1b2420;--muted:#5b6a63;--line:#dfe6e2}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#f6f8f7}
main{max-width:820px;margin:0 auto;padding:24px 16px}.sheet{background:#fff;border:1px solid var(--line);border-radius:8px;padding:28px}
header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:3px solid var(--accent);padding-bottom:16px;margin-bottom:20px}
header img{max-height:56px;max-width:200px}h1{margin:0;font-size:22px;color:var(--accent)}.muted{color:var(--muted)}.note{color:var(--muted);font-size:12px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}.meta div{font-size:14px}.meta strong{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.num{text-align:right;white-space:nowrap}tfoot td{border-bottom:0}.total td{font-weight:700;font-size:17px;border-top:2px solid var(--ink)}
.terms{margin-top:24px;white-space:pre-wrap;font-size:14px;overflow-wrap:anywhere}footer{margin-top:28px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
@media (max-width:560px){.sheet{padding:16px}header{flex-direction:column}th:nth-child(3),td:nth-child(3){display:none}}
@page{size:A4;margin:16mm 14mm}
@media print{body{background:#fff;font-size:12pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}main{padding:0;max-width:none}.sheet{border:0;padding:0}
thead{display:table-header-group}tfoot{display:table-footer-group}tr,header,.meta,footer{break-inside:avoid;page-break-inside:avoid}.total{break-inside:avoid}h1{break-after:avoid}.terms{orphans:3;widows:3}}`;
}

export interface DocumentShellInput {
  locale: ClientLocale;
  title: string;
  organisationName: string;
  accent: string;
  /** Already escaped. */
  headingHtml: string;
  /** Already escaped: the organisation's name or its logo placeholder image. */
  brandHtml: string;
  /** Already escaped: everything between the header and the footer. */
  bodyHtml: string;
  /** Already escaped: the organisation's contact line, or empty. */
  contactHtml: string;
}

export function renderDocumentShell(i: DocumentShellInput): string {
  return `<!doctype html>
<html lang="${i.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(i.title)} · ${escapeHtml(i.organisationName)}</title>
<style>
${documentStyles(safeColour(i.accent))}
</style></head><body><main><div class="sheet">
<header><div>${i.headingHtml}</div><div>${i.brandHtml}</div></header>
${i.bodyHtml}
<footer><strong>${escapeHtml(i.organisationName)}</strong>${i.contactHtml ? `<br>${i.contactHtml}` : ""}</footer>
</div></main></body></html>`;
}
