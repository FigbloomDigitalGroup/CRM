import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { CLIENT_LOCALES, DEFAULT_CLIENT_LOCALE, createTranslator, formatDateFor, formatMoneyFor, isClientLocale, missingKeys, type ClientTextKey } from "../src/lib/clientText";
import { renderQuoteHtml, type QuoteDocumentInput } from "../src/lib/quoteDocument";
import { createQuote } from "../src/services/quoteService";
import { previewQuote, sendQuote } from "../src/services/quoteDocumentService";
import { getSigningPage, signQuote } from "../src/services/quoteSignatureService";
import { createForm, updateForm } from "../src/services/webFormService";
import { getPublicForm } from "../src/services/webFormSubmissionService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { commercialWorld } from "./commercialFixtures";

/**
 * FIG-1189 (B7.07) close-out: proof for the acceptance criteria that had no test of their own. Key parity, the deliberate fallback list,
 * rule 7 (no internal value in either language), the language the signer saw, the unsupported-locale path, and one snapshot per locale
 * of the public web form definition. (Snapshots of the quote document are in clientLanguage.test.ts; of the signing page in
 * tests/components/commercial/m17closeSwahiliSign.test.tsx.)
 */

process.env.INTEGRATION_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

/** Keys that have no Swahili text ON PURPOSE (waiting for native review). Adding a key here is a visible decision. */
const DELIBERATE_FALLBACK: ClientTextKey[] = ["form.captcha"];

/** The whole catalogue. `Record<ClientTextKey, true>` makes a key added to or removed from the catalogue a type error here. */
const ALL_KEYS: Record<ClientTextKey, true> = {
  "doc.title": true, "doc.version": true, "doc.preparedFor": true, "doc.issued": true, "doc.validUntil": true, "doc.preparedBy": true,
  "doc.description": true, "doc.qty": true, "doc.unit": true, "doc.unitPrice": true, "doc.amount": true, "doc.subtotal": true,
  "doc.discount": true, "doc.total": true, "doc.noVat": true, "doc.vatNote": true, "doc.terms": true, "doc.fallbackNote": true,
  "mail.subject": true, "mail.body": true, "mail.viewLink": true, "mail.validUntil": true, "mail.signLink": true,
  "sign.title": true, "sign.for": true, "sign.valid": true, "sign.item": true, "sign.qty": true, "sign.amount": true, "sign.subtotal": true,
  "sign.discount": true, "sign.total": true, "sign.name": true, "sign.email": true, "sign.consent": true, "sign.button": true,
  "sign.signing": true, "sign.needName": true, "sign.signedTitle": true, "sign.signedBy": true, "sign.audit": true, "sign.seal": true,
  "sign.invalidTitle": true, "sign.invalidBody": true, "sign.expiredTitle": true, "sign.expiredBody": true, "sign.error": true, "sign.language": true,
  "form.submit": true, "form.required": true, "form.optional": true, "form.thanks": true, "form.captcha": true, "form.fixFields": true,
};
const KEYS = Object.keys(ALL_KEYS) as ClientTextKey[];

describe("key parity between English and Swahili", () => {
  it("every English key has Swahili text, except the listed deliberate fallbacks", () => {
    expect(missingKeys("sw")).toEqual(DELIBERATE_FALLBACK);
    expect(missingKeys("en")).toEqual([]);
  });

  it("every key shows something in both languages, Swahili differs from English wherever it has its own text, and only the listed keys fall back", () => {
    const en = createTranslator("en");
    const sw = createTranslator("sw");
    for (const key of KEYS) {
      const e = en.t(key);
      const s = sw.t(key);
      expect(e.trim(), key).not.toBe("");
      expect(s.trim(), key).not.toBe("");
      if (!DELIBERATE_FALLBACK.includes(key)) expect(s, `${key} is identical to English`).not.toBe(e);
    }
    expect([...sw.fellBack]).toEqual(DELIBERATE_FALLBACK);
    expect(en.fellBack.size).toBe(0);
  });

  it("the placeholders in every Swahili text are exactly those of the English text", () => {
    const en = createTranslator("en");
    const sw = createTranslator("sw");
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of KEYS) expect(holes(sw.t(key)), key).toEqual(holes(en.t(key)));
  });
});

describe("unsupported and default locales, formats", () => {
  it("an unsupported locale tag is not a client locale and English is the default", () => {
    expect(DEFAULT_CLIENT_LOCALE).toBe("en");
    for (const bad of ["fr", "SW", "sw-KE", "", null, 3, {}]) expect(isClientLocale(bad)).toBe(false);
    expect([...CLIENT_LOCALES]).toEqual(["en", "sw"]);
  });

  it("a placeholder with no value is left visible, never replaced by 'undefined'", () => {
    expect(createTranslator("sw").t("doc.title")).toBe("Makadirio ya bei {number}");
  });

  it("formats KES per language: two decimals, the currency code first, and dates in the language's month names", () => {
    expect(formatMoneyFor("en", 1234.5, "KES")).toBe("KES 1,234.50");
    expect(formatMoneyFor("sw", 1234.5, "KES")).toMatch(/^KES 1[,.\s]?234[.,]50$/);
    expect(formatDateFor("sw", "2026-03-01")).toBe("1 Machi 2026");
    expect(formatDateFor("en", "2026-03-01")).toBe("1 March 2026");
  });
});

const DOC: QuoteDocumentInput = {
  organization: { name: "Figbloom Digital", phone: null, website: null, address: null, accent: "#1f6f4a", showLogo: false },
  quote: { number: "Q-1", version: 1, currency: "KES", issuedOn: "2026-11-04", validUntil: "2026-12-04", terms: null, discountPercent: 0, subtotal: 100, discountAmount: 0, total: 100, lines: [{ description: "Item", unit: "unit", quantity: 1, unitPrice: 100, lineTotal: 100, taxable: true }] },
  preparedFor: { company: "Acme", contact: null },
  preparedBy: null,
};

/** The document without its stylesheet (CSS has a `margin` property that is not a margin figure). */
const body = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "");

async function setV2(orgId: string) {
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: "release_override" } },
    update: { value: { release: "v2" } },
    create: { organizationId: orgId, key: "release_override", value: { release: "v2" } },
  });
}

describe("rule 7: no internal value in either language", () => {
  it("the quote document, the stored share and the signing page data carry no cost or margin, in English or Swahili", async () => {
    const w = await commercialWorld();
    await setV2(w.org.id);
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 3 }] });
    const row = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 }, include: { lines: true } });
    expect(Number(row.lines[0]!.unitCost)).toBe(11000); // the cost exists on the record...
    for (const language of ["en", "sw"] as const) {
      const preview = await previewQuote(w.sales, quote.id, 1, new Date(), language);
      expect(body(preview.html)).not.toMatch(/11,000|33,000|unitCost|costTotal|margin/i); // ...and is nowhere in the document
    }
    const sent = await sendQuote(w.sales, quote.id, 1, { to: "mteja@example.test", language: "sw", allowSigning: true });
    const token = sent.signLink!.slice(sent.signLink!.lastIndexOf("/") + 1);
    const page = JSON.stringify(await getSigningPage(token));
    expect(page).not.toMatch(/cost|margin|decisionReason|11000|33000/i);
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { organizationId: w.org.id } });
    expect(body(share.documentHtml)).not.toMatch(/11,000|33,000|unitCost|margin/i);
  });

  it("the document template has no field for internal values", () => {
    expect(body(renderQuoteHtml({ ...DOC, language: "sw" }))).not.toMatch(/cost|margin|internal/i);
  });
});

describe("the signing page language and the signed record", () => {
  async function sentSwahili() {
    const w = await commercialWorld();
    await setV2(w.org.id);
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const result = await sendQuote(w.sales, quote.id, 1, { to: "mteja@example.test", language: "sw", allowSigning: true });
    const versionId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id;
    return { versionId, token: result.signLink!.slice(result.signLink!.lastIndexOf("/") + 1) };
  }
  const meta = (n: number) => ({ ipAddress: `203.0.113.${n}`, userAgent: "ua" });

  it("the page data is readable with the token alone (no sign-in) and starts in the document's language", async () => {
    const { token } = await sentSwahili();
    const res = await getSigningPage(token);
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.page.documentLanguage).toBe("sw");
  });

  it("a signer who switched to English is recorded as English, with the English consent wording", async () => {
    const { token, versionId } = await sentSwahili();
    await signQuote(token, { signerName: "Grace Wanjiru", consent: true, signature: { kind: "TYPED" }, language: "en" }, meta(5));
    const row = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    expect(row.language).toBe("en");
    expect(row.consentText).toBe(createTranslator("en").t("sign.consent"));
  });

  it("an unsupported language on signing falls back to the document's language, and the recorded wording matches", async () => {
    const { token, versionId } = await sentSwahili();
    await signQuote(token, { signerName: "Grace Wanjiru", consent: true, signature: { kind: "TYPED" }, language: "fr" }, meta(6));
    const row = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    expect(row.language).toBe("sw");
    expect(row.consentText).toBe(createTranslator("sw").t("sign.consent"));
  });

  it("a signer who gives no language is recorded in the document's language", async () => {
    const { token, versionId } = await sentSwahili();
    await signQuote(token, { signerName: "Grace Wanjiru", consent: true, signature: { kind: "TYPED" } }, meta(7));
    expect((await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } })).language).toBe("sw");
  });
});

describe("snapshots of the public web form definition, per language", () => {
  async function publishedForm(language: "en" | "sw") {
    const org = await createTestOrganization(`Form Snap ${language}`);
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key: "release_override" } },
      update: { value: { release: "v1.1" } },
      create: { organizationId: org.id, key: "release_override", value: { release: "v1.1" } },
    });
    const management = await createTestContext(org.id, "MANAGEMENT");
    const form = await updateForm(management, (await createForm(management, { name: "Contact us", language })).id, { status: "PUBLISHED" });
    const def = await getPublicForm(org.slug, form.publicKey, { ipAddress: "198.51.100.77", origin: null });
    return { language: def.language, text: def.text, fallbackKeys: def.fallbackKeys };
  }

  it("English", async () => {
    expect(await publishedForm("en")).toMatchInlineSnapshot(`
      {
        "fallbackKeys": [],
        "language": "en",
        "text": {
          "captcha": "Please confirm that you are a person.",
          "fixFields": "Please check the fields marked below.",
          "optional": "Optional",
          "required": "Required",
          "submit": "Send",
        },
      }
    `);
  });

  it("Swahili (the captcha line is English and listed as a fallback)", async () => {
    expect(await publishedForm("sw")).toMatchInlineSnapshot(`
      {
        "fallbackKeys": [
          "form.captcha",
        ],
        "language": "sw",
        "text": {
          "captcha": "Please confirm that you are a person.",
          "fixFields": "Tafadhali angalia sehemu zilizowekwa alama hapa chini.",
          "optional": "Si lazima",
          "required": "Lazima",
          "submit": "Tuma",
        },
      }
    `);
  });
});
