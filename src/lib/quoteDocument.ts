/**
 * The quote document the client receives (FIG-1144, B6.12): one pure function, so the preview in the app and the document
 * that is sent are produced by the same code and can be compared byte for byte. It never carries cost or margin (it has no
 * field for them), and every piece of text is escaped. Standalone HTML with its own styles and a print stylesheet, so the
 * browser prints it to PDF. The logo is a placeholder (`LOGO_PLACEHOLDER`) because a logo link is signed and short lived: the
 * public page swaps in a fresh one when it serves the stored document.
 */

export const LOGO_PLACEHOLDER = "__QUOTE_LOGO_URL__";

export interface QuoteDocumentLine {
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxable: boolean;
}

export interface QuoteDocumentInput {
  organization: {
    name: string;
    phone: string | null;
    website: string | null;
    address: string | null;
    /** Brand colour as a hex value, already checked by the colour catalogue. */
    accent: string;
    showLogo: boolean;
  };
  quote: {
    number: string;
    version: number;
    currency: string;
    /** YYYY-MM-DD. */
    issuedOn: string;
    validUntil: string;
    terms: string | null;
    discountPercent: number;
    subtotal: number;
    discountAmount: number;
    total: number;
    lines: QuoteDocumentLine[];
  };
  preparedFor: { company: string; contact: string | null };
  preparedBy: string | null;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function formatMoney(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${n}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function safeColour(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#1f6f4a";
}

export function renderQuoteHtml(input: QuoteDocumentInput): string {
  const { organization: org, quote: q } = input;
  const accent = safeColour(org.accent);
  const rows = q.lines
    .map(
      (l) => `<tr><td>${escapeHtml(l.description)}${l.taxable ? "" : " <span class=\"note\">(no VAT)</span>"}</td><td class="num">${l.quantity}</td><td>${escapeHtml(l.unit)}</td><td class="num">${escapeHtml(formatMoney(l.unitPrice, q.currency))}</td><td class="num">${escapeHtml(formatMoney(l.lineTotal, q.currency))}</td></tr>`,
    )
    .join("");
  const contact = [org.phone, org.website, org.address].filter((x): x is string => !!x && x.trim() !== "").map(escapeHtml).join(" · ");
  const discountRow =
    q.discountAmount > 0
      ? `<tr><td colspan="4" class="num">Discount (${q.discountPercent}%)</td><td class="num">-${escapeHtml(formatMoney(q.discountAmount, q.currency))}</td></tr>`
      : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Quote ${escapeHtml(q.number)} · ${escapeHtml(org.name)}</title>
<style>
:root{--accent:${accent};--ink:#1b2420;--muted:#5b6a63;--line:#dfe6e2}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#f6f8f7}
main{max-width:820px;margin:0 auto;padding:24px 16px}.sheet{background:#fff;border:1px solid var(--line);border-radius:8px;padding:28px}
header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:3px solid var(--accent);padding-bottom:16px;margin-bottom:20px}
header img{max-height:56px;max-width:200px}h1{margin:0;font-size:22px;color:var(--accent)}.muted{color:var(--muted)}.note{color:var(--muted);font-size:12px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}.meta div{font-size:14px}.meta strong{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
table{width:100%;border-collapse:collapse}th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.num{text-align:right;white-space:nowrap}tfoot td{border-bottom:0}.total td{font-weight:700;font-size:17px;border-top:2px solid var(--ink)}
.terms{margin-top:24px;white-space:pre-wrap;font-size:14px}footer{margin-top:28px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
@media (max-width:560px){.sheet{padding:16px}header{flex-direction:column}th:nth-child(3),td:nth-child(3){display:none}}
@media print{body{background:#fff}main{padding:0;max-width:none}.sheet{border:0;padding:0}}
</style></head><body><main><div class="sheet">
<header><div><h1>Quote ${escapeHtml(q.number)}</h1><div class="muted">Version ${q.version}</div></div><div>${org.showLogo ? `<img src="${LOGO_PLACEHOLDER}" alt="${escapeHtml(org.name)}">` : `<strong>${escapeHtml(org.name)}</strong>`}</div></header>
<section class="meta"><div><strong>Prepared for</strong>${escapeHtml(input.preparedFor.company)}${input.preparedFor.contact ? `<br>${escapeHtml(input.preparedFor.contact)}` : ""}</div><div><strong>Issued</strong>${escapeHtml(formatDate(q.issuedOn))}</div><div><strong>Valid until</strong>${escapeHtml(formatDate(q.validUntil))}</div>${input.preparedBy ? `<div><strong>Prepared by</strong>${escapeHtml(input.preparedBy)}</div>` : ""}</section>
<table><thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot>${q.discountAmount > 0 ? `<tr><td colspan="4" class="num">Subtotal</td><td class="num">${escapeHtml(formatMoney(q.subtotal, q.currency))}</td></tr>` : ""}${discountRow}<tr class="total"><td colspan="4" class="num">Total</td><td class="num">${escapeHtml(formatMoney(q.total, q.currency))}</td></tr></tfoot></table>
<p class="note">Prices include VAT where it applies.</p>
${q.terms ? `<section class="terms"><strong>Terms</strong><br>${escapeHtml(q.terms)}</section>` : ""}
<footer><strong>${escapeHtml(org.name)}</strong>${contact ? `<br>${contact}` : ""}</footer>
</div></main></body></html>`;
}
