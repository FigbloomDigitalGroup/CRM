/**
 * The invoice document (UC-R6): the same page, styles and print rules as the quote document (`documentShell.ts`), as one pure function.
 *
 * What it can show is fixed by its input: the number, dates, the customer, the amount and the notes. It has NO field for payments received,
 * a balance, an overdue state or a cost, so a document made for a person who may not see payments (Sales, rule 7) cannot carry them, and
 * nothing is left for a caller to forget to mask. Until invoices have line items (UC-B1), the amount is shown as one line.
 */

import { createTranslator, formatDateFor, formatMoneyFor, type ClientLocale, type Translator } from "./clientText";
import { LOGO_PLACEHOLDER, escapeHtml, renderDocumentShell } from "./documentShell";

export interface InvoiceDocumentInput {
  organization: { name: string; phone: string | null; website: string | null; address: string | null; accent: string; showLogo: boolean };
  invoice: {
    number: string;
    currency: string;
    /** YYYY-MM-DD. */
    issuedOn: string;
    dueOn: string;
    amount: number;
    notes: string | null;
    /** What the amount is for, one line (the deal or service name); the heading "Description" is used when empty. */
    description?: string | null;
  };
  billedTo: { company: string; contact: string | null };
  language?: ClientLocale;
}

export function renderInvoiceHtml(input: InvoiceDocumentInput, translator?: Translator): string {
  const { organization: org, invoice: inv } = input;
  const locale: ClientLocale = input.language ?? "en";
  const t = (translator ?? createTranslator(locale)).t;
  const money = (n: number) => formatMoneyFor(locale, n, inv.currency);
  const title = t("doc.invoiceTitle", { number: inv.number });
  const contact = [org.phone, org.website, org.address].filter((x): x is string => !!x && x.trim() !== "").map(escapeHtml).join(" · ");
  const bodyHtml = `<section class="meta"><div><strong>${escapeHtml(t("doc.billedTo"))}</strong>${escapeHtml(input.billedTo.company)}${input.billedTo.contact ? `<br>${escapeHtml(input.billedTo.contact)}` : ""}</div><div><strong>${escapeHtml(t("doc.issued"))}</strong>${escapeHtml(formatDateFor(locale, inv.issuedOn))}</div><div><strong>${escapeHtml(t("doc.dueOn"))}</strong>${escapeHtml(formatDateFor(locale, inv.dueOn))}</div></section>
<table><thead><tr><th>${escapeHtml(t("doc.description"))}</th><th class="num">${escapeHtml(t("doc.amount"))}</th></tr></thead><tbody><tr><td>${escapeHtml(inv.description?.trim() || t("doc.description"))}</td><td class="num">${escapeHtml(money(inv.amount))}</td></tr></tbody>
<tfoot><tr class="total"><td class="num">${escapeHtml(t("doc.total"))}</td><td class="num">${escapeHtml(money(inv.amount))}</td></tr></tfoot></table>
${inv.notes ? `<section class="terms"><strong>${escapeHtml(t("doc.invoiceNotes"))}</strong><br>${escapeHtml(inv.notes)}</section>` : ""}`;
  return renderDocumentShell({
    locale,
    title,
    organisationName: org.name,
    accent: org.accent,
    headingHtml: `<h1>${escapeHtml(title)}</h1>`,
    brandHtml: org.showLogo ? `<img src="${LOGO_PLACEHOLDER}" alt="${escapeHtml(org.name)}">` : `<strong>${escapeHtml(org.name)}</strong>`,
    bodyHtml,
    contactHtml: contact,
  });
}
