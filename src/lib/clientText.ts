/**
 * Text for what a client sees: the quote document, the signing page and the public web form (FIG-1189, B7.07).
 *
 * One catalogue of keys. English is complete; a Swahili entry may be missing, and then the English text is used and the translator
 * records the key in `fellBack`, so a page can say so ("Some text is shown in English"), never leave a hole. A language is chosen per
 * document (a quote share, a web form), never guessed from the browser. Dates and money are formatted for the language.
 *
 * REVIEW: the Swahili text was drafted by the build team and reviewed and approved by a native Swahili speaker (Given, 12 Nov 2026), so
 * `TRANSLATION_REVIEW.sw` is "COMPLETE" (docs/M17_LANE_B_ESIGN_SWAHILI.md). Corrections are still made here.
 */

export const CLIENT_LOCALES = ["en", "sw"] as const;
export type ClientLocale = (typeof CLIENT_LOCALES)[number];
export const DEFAULT_CLIENT_LOCALE: ClientLocale = "en";

export const TRANSLATION_REVIEW: Record<ClientLocale, "COMPLETE" | "PENDING_HUMAN_REVIEW"> = { en: "COMPLETE", sw: "COMPLETE" };

export function isClientLocale(value: unknown): value is ClientLocale {
  return typeof value === "string" && (CLIENT_LOCALES as readonly string[]).includes(value);
}

const EN = {
  // The quote document
  "doc.title": "Quote {number}",
  "doc.version": "Version {n}",
  "doc.preparedFor": "Prepared for",
  "doc.issued": "Issued",
  "doc.validUntil": "Valid until",
  "doc.preparedBy": "Prepared by",
  "doc.description": "Description",
  "doc.qty": "Qty",
  "doc.unit": "Unit",
  "doc.unitPrice": "Unit price",
  "doc.amount": "Amount",
  "doc.subtotal": "Subtotal",
  "doc.discount": "Discount ({pct}%)",
  "doc.total": "Total",
  "doc.noVat": "(no VAT)",
  "doc.vatNote": "Prices include VAT where it applies.",
  "doc.terms": "Terms",
  "doc.fallbackNote": "Some text on this page is shown in English.",
  // The email that carries the quote
  "mail.subject": "Quote {number} from {organisation}",
  "mail.body": "Hello,\n\nPlease find your quote {number} (version {version}) from {organisation}.",
  "mail.viewLink": "View your quote: {link}",
  "mail.validUntil": "This link works until {date}.",
  "mail.signLink": "Sign your quote online: {link}",
  // The signing page
  "sign.title": "Quote {number}",
  "sign.for": "Prepared for {company}",
  "sign.valid": "Valid until {date}",
  "sign.item": "Item",
  "sign.qty": "Qty",
  "sign.amount": "Amount",
  "sign.subtotal": "Subtotal",
  "sign.discount": "Discount ({pct}%)",
  "sign.total": "Total (incl. VAT)",
  "sign.name": "Your full name",
  "sign.email": "Your email address (optional)",
  "sign.consent": "I agree to the scope, prices and terms in this quote, and I accept that typing my name is my signature.",
  "sign.button": "Sign and accept",
  "sign.signing": "Signing...",
  "sign.needName": "Type your full name and tick the box to sign.",
  "sign.signedTitle": "Signed. Thank you.",
  "sign.signedBy": "Signed by {name} on {time}",
  "sign.audit": "Your signature, the time and your device address are kept as a record.",
  "sign.seal": "Record reference: {seal}",
  "sign.invalidTitle": "This link is not valid",
  "sign.invalidBody": "It may have been replaced by a newer version. Please ask the sender for a new link.",
  "sign.expiredTitle": "This link has expired",
  "sign.expiredBody": "Ask {organisation} to send you a new link.",
  "sign.error": "The quote could not be signed. Please try again or contact the sender.",
  "sign.language": "Language",
  // The public web form
  "form.submit": "Send",
  "form.required": "Required",
  "form.optional": "Optional",
  "form.thanks": "Thank you. We will be in touch.",
  "form.captcha": "Please confirm that you are a person.",
  "form.fixFields": "Please check the fields marked below.",
} as const;

export type ClientTextKey = keyof typeof EN;

/** Swahili. A key left out falls back to English on purpose (see the file header): the captcha line waits for review. */
const SW: Partial<Record<ClientTextKey, string>> = {
  "doc.title": "Makadirio ya bei {number}",
  "doc.version": "Toleo {n}",
  "doc.preparedFor": "Imeandaliwa kwa",
  "doc.issued": "Imetolewa",
  "doc.validUntil": "Inatumika hadi",
  "doc.preparedBy": "Imeandaliwa na",
  "doc.description": "Maelezo",
  "doc.qty": "Idadi",
  "doc.unit": "Kipimo",
  "doc.unitPrice": "Bei ya kimoja",
  "doc.amount": "Kiasi",
  "doc.subtotal": "Jumla ndogo",
  "doc.discount": "Punguzo ({pct}%)",
  "doc.total": "Jumla",
  "doc.noVat": "(bila VAT)",
  "doc.vatNote": "Bei zinajumuisha VAT pale inapohusika.",
  "doc.terms": "Masharti",
  "doc.fallbackNote": "Baadhi ya maandishi kwenye ukurasa huu yameonyeshwa kwa Kiingereza.",
  "mail.subject": "Makadirio ya bei {number} kutoka {organisation}",
  "mail.body": "Habari,\n\nTafadhali pata makadirio yako ya bei {number} (toleo {version}) kutoka {organisation}.",
  "mail.viewLink": "Tazama makadirio yako: {link}",
  "mail.validUntil": "Kiungo hiki kinafanya kazi hadi {date}.",
  "mail.signLink": "Saini makadirio yako mtandaoni: {link}",
  "sign.title": "Makadirio ya bei {number}",
  "sign.for": "Imeandaliwa kwa {company}",
  "sign.valid": "Inatumika hadi {date}",
  "sign.item": "Huduma",
  "sign.qty": "Idadi",
  "sign.amount": "Kiasi",
  "sign.subtotal": "Jumla ndogo",
  "sign.discount": "Punguzo ({pct}%)",
  "sign.total": "Jumla (pamoja na VAT)",
  "sign.name": "Jina lako kamili",
  "sign.email": "Barua pepe yako (si lazima)",
  "sign.consent": "Nakubali huduma, bei na masharti yaliyomo kwenye makadirio haya, na ninakubali kwamba kuandika jina langu ni sahihi yangu.",
  "sign.button": "Saini na ukubali",
  "sign.signing": "Inasaini...",
  "sign.needName": "Andika jina lako kamili na uweke tiki ili usaini.",
  "sign.signedTitle": "Imesainiwa. Asante.",
  "sign.signedBy": "Imesainiwa na {name} tarehe {time}",
  "sign.audit": "Sahihi yako, muda na anwani ya kifaa chako vinahifadhiwa kama kumbukumbu.",
  "sign.seal": "Namba ya kumbukumbu: {seal}",
  "sign.invalidTitle": "Kiungo hiki si halali",
  "sign.invalidBody": "Huenda kimebadilishwa na toleo jipya. Tafadhali mwombe mtumaji kiungo kipya.",
  "sign.expiredTitle": "Kiungo hiki kimeisha muda",
  "sign.expiredBody": "Mwombe {organisation} akutumie kiungo kipya.",
  "sign.error": "Makadirio hayakuweza kusainiwa. Tafadhali jaribu tena au wasiliana na mtumaji.",
  "sign.language": "Lugha",
  "form.submit": "Tuma",
  "form.required": "Lazima",
  "form.optional": "Si lazima",
  "form.thanks": "Asante. Tutawasiliana nawe.",
  "form.fixFields": "Tafadhali angalia sehemu zilizowekwa alama hapa chini.",
};

const CATALOGUES: Record<ClientLocale, Partial<Record<ClientTextKey, string>>> = { en: EN, sw: SW };

export interface Translator {
  locale: ClientLocale;
  /** Text for a key with `{name}` placeholders filled in. Falls back to English and remembers that it did. */
  t(key: ClientTextKey, vars?: Record<string, string | number>): string;
  /** The keys that were shown in English although another language was asked for. */
  fellBack: Set<ClientTextKey>;
}

function fill(text: string, vars?: Record<string, string | number>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

/** `catalogue` replaces the built-in text for one locale (tests use it to prove the fallback). */
export function createTranslator(locale: ClientLocale, catalogue: Partial<Record<ClientTextKey, string>> = CATALOGUES[locale]): Translator {
  const fellBack = new Set<ClientTextKey>();
  return {
    locale,
    fellBack,
    t(key, vars) {
      const own = catalogue[key];
      if (own !== undefined) return fill(own, vars);
      if (locale !== DEFAULT_CLIENT_LOCALE) fellBack.add(key);
      return fill(EN[key], vars);
    },
  };
}

/** Keys with no Swahili text yet, for the review checklist and the tests. */
export function missingKeys(locale: ClientLocale): ClientTextKey[] {
  return (Object.keys(EN) as ClientTextKey[]).filter((k) => CATALOGUES[locale][k] === undefined);
}

/** Intl locale tags: English keeps the formats the quote document always used, Swahili uses Kenyan Swahili. */
const MONEY_TAG: Record<ClientLocale, string> = { en: "en-KE", sw: "sw-KE" };
const DATE_TAG: Record<ClientLocale, string> = { en: "en-GB", sw: "sw-KE" };

export function formatMoneyFor(locale: ClientLocale, amount: number, currency: string): string {
  const n = new Intl.NumberFormat(MONEY_TAG[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${currency} ${n}`;
}

/** A long date for an ISO day (YYYY-MM-DD), in UTC so the day never shifts. */
export function formatDateFor(locale: ClientLocale, iso: string): string {
  return new Intl.DateTimeFormat(DATE_TAG[locale], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

/** A date and time for a moment, shown in East Africa Time (the organisations' time zone). */
export function formatMomentFor(locale: ClientLocale, moment: Date): string {
  return new Intl.DateTimeFormat(DATE_TAG[locale], { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(moment);
}
