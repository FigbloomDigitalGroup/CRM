import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import {
  CLIENT_LOCALES,
  TRANSLATION_REVIEW,
  createTranslator,
  formatDateFor,
  formatMoneyFor,
  formatMomentFor,
  isClientLocale,
  missingKeys,
} from "../src/lib/clientText";
import { renderQuoteHtml, type QuoteDocumentInput } from "../src/lib/quoteDocument";
import { createForm, getForm, updateForm } from "../src/services/webFormService";
import { getPublicForm, submitWebForm } from "../src/services/webFormSubmissionService";
import { previewQuote, requireLanguage, sendQuote } from "../src/services/quoteDocumentService";
import { createQuote } from "../src/services/quoteService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { commercialWorld } from "./commercialFixtures";

/** FIG-1189 (B7.07): Swahili for the client-facing quote, signing page text and web form. A language per document, English fallback shown. */

process.env.INTEGRATION_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const FIXED: QuoteDocumentInput = {
  organization: { name: "Figbloom Digital", phone: "+254 700 000 000", website: "https://figbloom.example", address: "Nairobi", accent: "#1f6f4a", showLogo: false },
  quote: {
    number: "Q-2026-0001",
    version: 2,
    currency: "KES",
    issuedOn: "2026-11-04",
    validUntil: "2026-12-04",
    terms: "50% deposit, balance on delivery.",
    discountPercent: 8,
    subtotal: 292000,
    discountAmount: 23360,
    total: 268640,
    lines: [
      { description: "CCTV camera (4MP dome), installed", unit: "camera", quantity: 12, unitPrice: 18500, lineTotal: 222000, taxable: true },
      { description: "Site survey", unit: "visit", quantity: 1, unitPrice: 5000, lineTotal: 5000, taxable: false },
    ],
  },
  preparedFor: { company: "Mwangaza Schools", contact: "Grace Wanjiru" },
  preparedBy: "Dev Sales",
};

describe("the catalogue", () => {
  it("offers English and Swahili, English is complete and Swahili is marked as awaiting review", () => {
    expect([...CLIENT_LOCALES]).toEqual(["en", "sw"]);
    expect(isClientLocale("sw")).toBe(true);
    expect(isClientLocale("fr")).toBe(false);
    expect(isClientLocale(undefined)).toBe(false);
    expect(missingKeys("en")).toEqual([]);
    expect(TRANSLATION_REVIEW).toEqual({ en: "COMPLETE", sw: "PENDING_HUMAN_REVIEW" });
  });

  it("returns Swahili text, fills placeholders, and never falls back for a key that has Swahili", () => {
    const sw = createTranslator("sw");
    expect(sw.t("doc.title", { number: "Q-1" })).toBe("Makadirio ya bei Q-1");
    expect(sw.t("sign.button")).toBe("Saini na ukubali");
    expect(sw.fellBack.size).toBe(0);
    const en = createTranslator("en");
    expect(en.t("doc.title", { number: "Q-1" })).toBe("Quote Q-1");
  });

  it("falls back to English for a key with no Swahili text, and says which one", () => {
    // The Swahili captcha line waits for review on purpose; this pins the list so a new gap is a visible decision.
    expect(missingKeys("sw")).toEqual(["form.captcha"]);
    const sw = createTranslator("sw");
    expect(sw.t("form.captcha")).toBe("Please confirm that you are a person.");
    expect([...sw.fellBack]).toEqual(["form.captcha"]);
    const en = createTranslator("en");
    en.t("form.captcha");
    expect(en.fellBack.size).toBe(0);
  });

  it("formats dates and money for the language, in the right day", () => {
    expect(formatMoneyFor("en", 268640, "KES")).toBe("KES 268,640.00");
    expect(formatMoneyFor("sw", 268640, "KES")).toMatch(/^KES 268[,.\s]?640[.,]00$/);
    expect(formatDateFor("en", "2026-12-04")).toBe("4 December 2026");
    expect(formatDateFor("sw", "2026-12-04")).toBe("4 Desemba 2026");
    // 22:30 UTC on 4 Dec is already 5 Dec in Nairobi.
    expect(formatMomentFor("en", new Date("2026-12-04T22:30:00Z"))).toContain("5 December 2026");
    expect(formatMomentFor("sw", new Date("2026-12-04T22:30:00Z"))).toContain("5 Desemba 2026");
  });
});

describe("the quote document per language", () => {
  it("English output is the default and unchanged", () => {
    expect(renderQuoteHtml(FIXED)).toBe(renderQuoteHtml({ ...FIXED, language: "en" }));
    expect(renderQuoteHtml(FIXED)).toContain('<html lang="en">');
  });

  it("snapshot: English", () => {
    expect(renderQuoteHtml({ ...FIXED, language: "en" })).toMatchSnapshot();
  });

  it("snapshot: Swahili", () => {
    expect(renderQuoteHtml({ ...FIXED, language: "sw" })).toMatchSnapshot();
  });

  it("the Swahili document is in Swahili with Swahili dates, and shows no fallback note when nothing fell back", () => {
    const html = renderQuoteHtml({ ...FIXED, language: "sw" });
    expect(html).toContain('<html lang="sw">');
    expect(html).toContain("Makadirio ya bei Q-2026-0001");
    expect(html).toContain("Toleo 2");
    expect(html).toContain("4 Desemba 2026");
    expect(html).toContain("Punguzo (8%)");
    expect(html).toContain("(bila VAT)");
    expect(html).not.toContain("Quote Q-2026-0001");
    expect(html).not.toContain("shown in English");
    expect(html).not.toContain("yameonyeshwa kwa Kiingereza");
  });

  it("when a Swahili text is missing the English shows and the page says so, in Swahili", () => {
    const partial = createTranslator("sw", { "doc.title": "Makadirio ya bei {number}" });
    const html = renderQuoteHtml({ ...FIXED, language: "sw" }, partial);
    expect(html).toContain("Makadirio ya bei Q-2026-0001");
    expect(html).toContain("Prices include VAT where it applies."); // English text, visibly
    expect(html).toContain("Some text on this page is shown in English."); // the note itself has no Swahili in this partial catalogue
    const withNote = createTranslator("sw", { "doc.title": "Makadirio ya bei {number}", "doc.fallbackNote": "Baadhi ya maandishi yameonyeshwa kwa Kiingereza." });
    expect(renderQuoteHtml({ ...FIXED, language: "sw" }, withNote)).toContain("Baadhi ya maandishi yameonyeshwa kwa Kiingereza.");
  });

  it("an unknown language is refused, a missing one means English", () => {
    expect(requireLanguage(undefined)).toBe("en");
    expect(requireLanguage("sw")).toBe("sw");
    expect(() => requireLanguage("fr")).toThrow(ValidationError);
  });
});

describe("a quote sent in Swahili", () => {
  it("previews and sends one document per language, and the share keeps the language", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }] });
    const en = await previewQuote(w.sales, quote.id, 1);
    expect(en.html).toContain('<html lang="en">');
    const sw = await previewQuote(w.sales, quote.id, 1, new Date(), "sw");
    expect(sw.html).toContain('<html lang="sw">');
    expect(sw.html).toContain("Makadirio ya bei");
    expect(sw.sha256).not.toBe(en.sha256);
    await expect(previewQuote(w.sales, quote.id, 1, new Date(), "fr")).rejects.toBeInstanceOf(ValidationError);

    const sent = await sendQuote(w.sales, quote.id, 1, { to: "mteja@example.test", language: "sw" });
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { organizationId: w.org.id } });
    expect(share.language).toBe("sw");
    expect(share.documentHtml).toContain('<html lang="sw">');
    expect(sent.signLink).toBeNull();
    // The email that carried the quote is in Swahili too.
    const mail = await adminDb.communication.findFirstOrThrow({ where: { organizationId: w.org.id, channel: "EMAIL" }, orderBy: { occurredAt: "desc" } });
    expect(`${mail.subject} ${mail.summary}`).toMatch(/Makadirio ya bei/);
    // The previewed Swahili document of a sent version is the stored one.
    const again = await previewQuote(w.sales, quote.id, 1);
    expect(again).toMatchObject({ source: "sent", sha256: share.documentSha256 });
  });

  it("sending with an unknown language is refused before anything is sent", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    await expect(sendQuote(w.sales, quote.id, 1, { to: "a@example.test", language: "de" })).rejects.toBeInstanceOf(ValidationError);
    expect(await adminDb.quoteShare.count({ where: { organizationId: w.org.id } })).toBe(0);
  });
});

describe("the public web form per language", () => {
  async function formWorld() {
    const org = await createTestOrganization("Forms Language Org");
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key: "release_override" } },
      update: { value: { release: "v1.1" } },
      create: { organizationId: org.id, key: "release_override", value: { release: "v1.1" } },
    });
    const management = await createTestContext(org.id, "MANAGEMENT");
    return { org, management };
  }
  const meta = () => ({ ipAddress: `198.51.100.${randomUUID().slice(0, 6)}`, origin: null });
  const submission = () => JSON.stringify({ name: "Amara Osei", email: `a.${randomUUID().slice(0, 6)}@example.test`, message: "Habari" });

  it("English is the default; the language is saved, validated and returned to the builder", async () => {
    const w = await formWorld();
    const form = await createForm(w.management, { name: "Default" });
    expect(form.language).toBe("en");
    await expect(createForm(w.management, { name: "Bad", language: "fr" })).rejects.toBeInstanceOf(ValidationError);
    const updated = await updateForm(w.management, form.id, { language: "sw" });
    expect(updated.language).toBe("sw");
    expect((await getForm(w.management, form.id)).language).toBe("sw");
    await expect(updateForm(w.management, form.id, { language: "de" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("the public definition carries the form's text in its language, and names what fell back", async () => {
    const w = await formWorld();
    const en = await updateForm(w.management, (await createForm(w.management, { name: "En form" })).id, { status: "PUBLISHED" });
    const enDef = await getPublicForm(w.org.slug, en.publicKey, meta());
    expect(enDef).toMatchObject({ language: "en", text: { submit: "Send", required: "Required" }, fallbackKeys: [] });
    const sw = await updateForm(w.management, (await createForm(w.management, { name: "Sw form", language: "sw" })).id, { status: "PUBLISHED" });
    const swDef = await getPublicForm(w.org.slug, sw.publicKey, meta());
    expect(swDef).toMatchObject({ language: "sw", text: { submit: "Tuma", required: "Lazima", optional: "Si lazima" } });
    expect(swDef.text.captcha).toBe("Please confirm that you are a person."); // no Swahili yet: English, and listed
    expect(swDef.fallbackKeys).toEqual(["form.captcha"]);
  });

  it("the built-in thank-you follows the form's language; the organisation's own wording is never changed", async () => {
    const w = await formWorld();
    const swDefault = await updateForm(w.management, (await createForm(w.management, { name: "Sw default", language: "sw" })).id, { status: "PUBLISHED" });
    expect((await submitWebForm(w.org.slug, swDefault.publicKey, submission(), meta())).message).toBe("Asante. Tutawasiliana nawe.");
    const swOwn = await updateForm(w.management, (await createForm(w.management, { name: "Sw own", language: "sw", successMessage: "Thanks, see you soon." })).id, { status: "PUBLISHED" });
    expect((await submitWebForm(w.org.slug, swOwn.publicKey, submission(), meta())).message).toBe("Thanks, see you soon.");
    const en = await updateForm(w.management, (await createForm(w.management, { name: "En default" })).id, { status: "PUBLISHED" });
    expect((await submitWebForm(w.org.slug, en.publicKey, submission(), meta())).message).toBe("Thank you. We will be in touch.");
  });
});
