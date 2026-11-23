/**
 * The quote document the client receives (FIG-1144, B6.12): one pure function, so the preview in the app and the document
 * that is sent are produced by the same code and can be compared byte for byte. It never carries cost or margin (it has no
 * field for them), and every piece of text is escaped. Standalone HTML with its own styles and a print stylesheet, so the
 * browser prints it to PDF. The logo is a placeholder (`LOGO_PLACEHOLDER`) because a logo link is signed and short lived: the
 * public page swaps in a fresh one when it serves the stored document.
 */

import { createTranslator, formatDateFor, formatMoneyFor, type ClientLocale, type Translator } from "./clientText";
import { LOGO_PLACEHOLDER, escapeHtml, renderDocumentShell } from "./documentShell";

// The page shell, styles and print rules are shared with the invoice document (UC-R6).
export { LOGO_PLACEHOLDER, escapeHtml };

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
    /**
     * UC-R5: the tax lines of a quote made with a tax setting. Left out for every quote made before tax (and with tax off): the document is
     * then exactly what it always was. `amount` is the tax in money; `mode` decides whether it is part of the total or added to it.
     */
    tax?: { mode: "INCLUSIVE" | "EXCLUSIVE"; rateBp: number; label: string; amount: number };
    lines: QuoteDocumentLine[];
  };
  preparedFor: { company: string; contact: string | null };
  preparedBy: string | null;
  /** The language of this document (FIG-1189); English when left out. Dates and money follow it. */
  language?: ClientLocale;
}

export function formatMoney(amount: number, currency: string): string {
  const n = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${n}`;
}

/** `translator` replaces the built-in text (tests use it to prove the visible English fallback). */
export function renderQuoteHtml(input: QuoteDocumentInput, translator?: Translator): string {
  const { organization: org, quote: q } = input;
  const locale: ClientLocale = input.language ?? "en";
  const tr = translator ?? createTranslator(locale);
  const t = tr.t;
  const money = (n: number) => formatMoneyFor(locale, n, q.currency);
  const rows = q.lines
    .map(
      (l) => `<tr><td>${escapeHtml(l.description)}${l.taxable ? "" : ` <span class="note">${escapeHtml(t("doc.noVat"))}</span>`}</td><td class="num">${l.quantity}</td><td>${escapeHtml(l.unit)}</td><td class="num">${escapeHtml(money(l.unitPrice))}</td><td class="num">${escapeHtml(money(l.lineTotal))}</td></tr>`,
    )
    .join("");
  const contact = [org.phone, org.website, org.address].filter((x): x is string => !!x && x.trim() !== "").map(escapeHtml).join(" · ");
  const discountRow =
    q.discountAmount > 0
      ? `<tr><td colspan="4" class="num">${escapeHtml(t("doc.discount", { pct: q.discountPercent }))}</td><td class="num">-${escapeHtml(money(q.discountAmount))}</td></tr>`
      : "";
  // UC-R5: tax rows and the tax note, only when the quote carries tax. Without it these stay empty and the output is unchanged.
  const tax = q.tax;
  const taxRate = tax ? String(tax.rateBp / 100) : "";
  const taxRows = !tax
    ? ""
    : tax.mode === "EXCLUSIVE"
      ? `<tr><td colspan="4" class="num">${escapeHtml(t("doc.netTotal", { label: tax.label }))}</td><td class="num">${escapeHtml(money(q.subtotal - q.discountAmount))}</td></tr><tr><td colspan="4" class="num">${escapeHtml(t("doc.taxLine", { label: tax.label, rate: taxRate }))}</td><td class="num">${escapeHtml(money(tax.amount))}</td></tr>`
      : "";
  const taxIncludedRow = tax && tax.mode === "INCLUSIVE" ? `<tr><td colspan="4" class="num note">${escapeHtml(t("doc.taxIncluded", { label: tax.label, rate: taxRate }))}</td><td class="num note">${escapeHtml(money(tax.amount))}</td></tr>` : "";
  const vatNoteText = tax ? t(tax.mode === "EXCLUSIVE" ? "doc.taxNoteExclusive" : "doc.taxNoteInclusive", { label: tax.label }) : t("doc.vatNote");
  const labels = {
    title: t("doc.title", { number: q.number }),
    version: t("doc.version", { n: q.version }),
    preparedFor: t("doc.preparedFor"),
    issued: t("doc.issued"),
    validUntil: t("doc.validUntil"),
    preparedBy: t("doc.preparedBy"),
    description: t("doc.description"),
    qty: t("doc.qty"),
    unit: t("doc.unit"),
    unitPrice: t("doc.unitPrice"),
    amount: t("doc.amount"),
    subtotal: t("doc.subtotal"),
    total: t("doc.total"),
    vatNote: vatNoteText,
    terms: t("doc.terms"),
  };
  // Asked for in a language that has no text for some key: say so on the page, once, in the language itself (which falls back too when needed).
  const fallbackNote = tr.fellBack.size > 0 ? `<p class="note">${escapeHtml(t("doc.fallbackNote"))}</p>
` : "";
  const brandHtml = org.showLogo ? `<img src="${LOGO_PLACEHOLDER}" alt="${escapeHtml(org.name)}">` : `<strong>${escapeHtml(org.name)}</strong>`;
  const bodyHtml = `<section class="meta"><div><strong>${escapeHtml(labels.preparedFor)}</strong>${escapeHtml(input.preparedFor.company)}${input.preparedFor.contact ? `<br>${escapeHtml(input.preparedFor.contact)}` : ""}</div><div><strong>${escapeHtml(labels.issued)}</strong>${escapeHtml(formatDateFor(locale, q.issuedOn))}</div><div><strong>${escapeHtml(labels.validUntil)}</strong>${escapeHtml(formatDateFor(locale, q.validUntil))}</div>${input.preparedBy ? `<div><strong>${escapeHtml(labels.preparedBy)}</strong>${escapeHtml(input.preparedBy)}</div>` : ""}</section>
<table><thead><tr><th>${escapeHtml(labels.description)}</th><th class="num">${escapeHtml(labels.qty)}</th><th>${escapeHtml(labels.unit)}</th><th class="num">${escapeHtml(labels.unitPrice)}</th><th class="num">${escapeHtml(labels.amount)}</th></tr></thead><tbody>${rows}</tbody>
<tfoot>${q.discountAmount > 0 ? `<tr><td colspan="4" class="num">${escapeHtml(labels.subtotal)}</td><td class="num">${escapeHtml(money(q.subtotal))}</td></tr>` : ""}${discountRow}${taxRows}<tr class="total"><td colspan="4" class="num">${escapeHtml(labels.total)}</td><td class="num">${escapeHtml(money(q.total))}</td></tr>${taxIncludedRow}</tfoot></table>
<p class="note">${escapeHtml(labels.vatNote)}</p>
${fallbackNote}${q.terms ? `<section class="terms"><strong>${escapeHtml(labels.terms)}</strong><br>${escapeHtml(q.terms)}</section>` : ""}`;
  return renderDocumentShell({
    locale,
    title: labels.title,
    organisationName: org.name,
    accent: org.accent,
    headingHtml: `<h1>${escapeHtml(labels.title)}</h1><div class="muted">${escapeHtml(labels.version)}</div>`,
    brandHtml,
    bodyHtml,
    contactHtml: contact,
  });
}
