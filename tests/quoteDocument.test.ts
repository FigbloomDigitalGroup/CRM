import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { LOGO_PLACEHOLDER, renderQuoteHtml, type QuoteDocumentInput } from "../src/lib/quoteDocument";
import { createQuote, getQuoteVersion, transitionVersion, updateDraftVersion } from "../src/services/quoteService";
import { updateCatalogueEntry } from "../src/services/catalogueService";
import {
  getQuoteActivity,
  hashToken,
  openQuoteLink,
  previewQuote,
  revokeQuoteShare,
  sendQuote,
} from "../src/services/quoteDocumentService";
import { commercialWorld } from "./commercialFixtures";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

const visibleText = (html: string) => html.slice(html.indexOf("</style>"));
const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);

const FIXED: QuoteDocumentInput = {
  organization: { name: "Figbloom Digital", phone: "+254 700 000 000", website: "https://figbloom.example", address: "Nairobi", accent: "#1f6f4a", showLogo: false },
  quote: {
    number: "Q-2026-0001",
    version: 2,
    currency: "KES",
    issuedOn: "2026-11-04",
    validUntil: "2026-12-04",
    terms: "50% deposit, balance on delivery.\nPrices include 16% VAT.",
    discountPercent: 8,
    subtotal: 292000,
    discountAmount: 23360,
    total: 268640,
    lines: [
      { description: "CCTV camera (4MP dome), installed", unit: "camera", quantity: 12, unitPrice: 18500, lineTotal: 222000, taxable: true },
      { description: "Site survey <script>alert(1)</script>", unit: "visit", quantity: 1, unitPrice: 5000, lineTotal: 5000, taxable: false },
    ],
  },
  preparedFor: { company: "Mwangaza Schools", contact: "Grace Wanjiru" },
  preparedBy: "Dev Sales",
};

describe("quote document rendering (FIG-1144, B6.12)", () => {
  it("renders the same document every time for the same input (snapshot)", () => {
    const html = renderQuoteHtml(FIXED);
    expect(renderQuoteHtml(FIXED)).toBe(html);
    expect(html).toMatchSnapshot();
  });

  it("escapes every piece of text, shows the discount only when there is one, and has no field for cost or margin", () => {
    const html = renderQuoteHtml(FIXED);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Discount (8%)");
    expect(html).toContain("KES 268,640.00");
    expect(visibleText(html)).not.toMatch(/cost|margin/i);
    const noDiscount = renderQuoteHtml({ ...FIXED, quote: { ...FIXED.quote, discountPercent: 0, discountAmount: 0, subtotal: 268640 } });
    expect(noDiscount).not.toContain("Discount (");
    // The logo is a placeholder the public page replaces with a fresh signed link.
    expect(renderQuoteHtml({ ...FIXED, organization: { ...FIXED.organization, showLogo: true } })).toContain(LOGO_PLACEHOLDER);
    expect(html).not.toContain(LOGO_PLACEHOLDER);
  });
});

describe("sending a quote (FIG-1144)", () => {
  const NOW = new Date();

  it("the preview matches the document that is sent, byte for byte, and keeps matching after the catalogue changes", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 3 }, { catalogueItemId: w.recorder.id, quantity: 1 }] }, NOW);
    const preview = await previewQuote(w.sales, quote.id, 1, NOW);
    expect(preview.source).toBe("draft");
    expect(preview.html).toContain("KES 120,500.00");

    const sent = await sendQuote(w.sales, quote.id, 1, { to: "bursar@mwangaza.example" }, NOW);
    expect(sent.version).toMatchObject({ status: "SENT", locked: true });
    expect(sent.share.documentSha256).toBe(preview.sha256);
    const stored = await adminDb.quoteShare.findFirstOrThrow({ where: { id: sent.share.id } });
    expect(stored.documentHtml).toBe(preview.html);

    await updateCatalogueEntry(w.management, w.camera.id, { price: 99999 });
    const after = await previewQuote(w.sales, quote.id, 1, new Date(NOW.getTime() + 3 * 86_400_000));
    expect(after).toMatchObject({ source: "sent", sha256: preview.sha256, html: preview.html });
    // The client sees the sent document, not a fresh render.
    const opened = await openQuoteLink(tokenOf(sent.link), {}, NOW);
    expect(opened).toMatchObject({ status: "ok" });
    expect(opened.status === "ok" && opened.html).toContain("KES 120,500.00");
  });

  it("never carries cost or margin, and the link is stored only as a hash", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }] }, NOW);
    const sent = await sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, NOW);
    const stored = await adminDb.quoteShare.findFirstOrThrow({ where: { id: sent.share.id } });
    expect(stored.documentHtml).not.toContain("11000");
    expect(visibleText(stored.documentHtml)).not.toMatch(/margin|cost/i);
    const token = tokenOf(sent.link);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(await getQuoteActivity(w.sales, quote.id, 1))).not.toContain(token);
    expect(await adminDb.communication.count({ where: { organizationId: w.org.id, dealId: w.deal.id, channel: "EMAIL" } })).toBe(1);
  });

  it("applies the rules before sending: approval, lines, recipient, validity, rights", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, {}, NOW);
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, NOW)))[0]).toMatchObject({ code: "NO_LINES" });
    await updateDraftVersion(w.sales, quote.id, 1, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }], discountPercent: 8 }, NOW);
    // A discount above the limit has to be approved first; the rule only makes the send wait.
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, NOW)))[0]).toMatchObject({ code: "APPROVAL_REQUIRED" });
    await updateDraftVersion(w.sales, quote.id, 1, { discountPercent: 5 }, NOW);
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, {}, NOW)))[0]).toMatchObject({ code: "RECIPIENT_REQUIRED" });
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "not-an-email" }, NOW)))[0]).toMatchObject({ code: "RECIPIENT_REQUIRED" });
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "a@b.example", linkExpiresInDays: 400 }, NOW)))[0]).toMatchObject({ code: "INVALID_LINK_DAYS" });
    const farFuture = new Date(NOW.getTime() + 90 * 86_400_000);
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, farFuture)))[0]).toMatchObject({ code: "QUOTE_EXPIRED" });
    await expect(sendQuote(w.salesTwo, quote.id, 1, { to: "a@b.example" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendQuote(w.finance, quote.id, 1, { to: "a@b.example" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewQuote(w.finance, quote.id, 1, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    // A version waiting for approval, or one that was not approved, cannot be sent.
    const id = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id;
    await transitionVersion(w.org.id, id, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, NOW)))[0]).toMatchObject({ code: "APPROVAL_PENDING" });
    await transitionVersion(w.org.id, id, ["PENDING_APPROVAL"], "REJECTED");
    expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, NOW)))[0]).toMatchObject({ code: "NOT_APPROVED" });
  });

  it("an approved version above the limit can be sent; the version is locked afterwards and a resend adds a link", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }], discountPercent: 10 }, NOW);
    const id = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id;
    await transitionVersion(w.org.id, id, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    await transitionVersion(w.org.id, id, ["PENDING_APPROVAL"], "APPROVED", { approvedAt: NOW });
    const first = await sendQuote(w.sales, quote.id, 1, { to: "a@b.example" }, NOW);
    expect(first.version.status).toBe("SENT");
    expect((await issuesOf(updateDraftVersion(w.sales, quote.id, 1, { discountPercent: 1 }, NOW)))[0]).toMatchObject({ code: "VERSION_LOCKED" });
    const again = await sendQuote(w.sales, quote.id, 1, { to: "other@b.example" }, NOW);
    expect(again.version.status).toBe("SENT");
    expect(again.link).not.toBe(first.link);
    expect((await getQuoteActivity(w.sales, quote.id, 1)).shares).toHaveLength(2);
  });

  it("uses an email template for the subject and body when one is given", async () => {
    const w = await commercialWorld();
    const { createTemplate } = await import("../src/services/emailTemplateService");
    const t = await createTemplate(w.management, { name: "Quote email", subject: "Your quote, {{contact.firstName}}", body: "Dear {{contact.firstName}}, here is the quote for {{company.name}}.\n\n{{sender.name}}" });
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] }, NOW);
    await sendQuote(w.sales, quote.id, 1, { to: "a@b.example", templateId: t.id }, NOW);
    const comm = await adminDb.communication.findFirstOrThrow({ where: { organizationId: w.org.id, dealId: w.deal.id, channel: "EMAIL" } });
    expect(comm.emailTemplateId).toBe(t.id);
    expect(comm.summary).toContain("Mwangaza Schools");
    expect(comm.summary).toMatch(/View your quote: http/);
  });
});

describe("share links, expiry and view tracking (FIG-1144)", () => {
  const NOW = new Date();

  async function sentQuote(options: { linkExpiresInDays?: number; validUntil?: string } = {}) {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }], validUntil: options.validUntil }, NOW);
    const sent = await sendQuote(w.sales, quote.id, 1, { to: "client@example.test", linkExpiresInDays: options.linkExpiresInDays }, NOW);
    return { w, quote, sent, token: tokenOf(sent.link) };
  }

  it("links expire: at the end of the quote validity, or sooner when asked, and never beyond 90 days", async () => {
    const { sent, token } = await sentQuote({ linkExpiresInDays: 2 });
    expect(sent.share.expiresAt.getTime()).toBe(NOW.getTime() + 2 * 86_400_000);
    expect(await openQuoteLink(token, {}, new Date(NOW.getTime() + 86_400_000))).toMatchObject({ status: "ok" });
    const expired = await openQuoteLink(token, {}, new Date(NOW.getTime() + 2 * 86_400_000 + 1000));
    expect(expired.status).toBe("expired");

    const byValidity = await sentQuote();
    const end = new Date(`${byValidity.w.deal.id && new Date(NOW.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)}T23:59:59.999Z`);
    expect(byValidity.sent.share.expiresAt.getTime()).toBe(end.getTime());
    expect(await openQuoteLink(byValidity.token, {}, new Date(end.getTime() + 1))).toMatchObject({ status: "expired" });

    const long = await sentQuote({ validUntil: new Date(NOW.getTime() + 200 * 86_400_000).toISOString().slice(0, 10) });
    expect(long.sent.share.expiresAt.getTime()).toBe(NOW.getTime() + 90 * 86_400_000);
  });

  it("an unknown, malformed or revoked link shows nothing; revoking needs edit rights on the deal", async () => {
    const { w, quote, sent, token } = await sentQuote();
    expect(await openQuoteLink("x".repeat(43), {}, NOW)).toEqual({ status: "not_found" });
    expect(await openQuoteLink("short", {}, NOW)).toEqual({ status: "not_found" });
    expect(await openQuoteLink("../../etc/passwd/........................", {}, NOW)).toEqual({ status: "not_found" });
    await expect(revokeQuoteShare(w.salesTwo, quote.id, sent.share.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeQuoteShare(w.finance, quote.id, sent.share.id)).rejects.toBeInstanceOf(NotFoundError);
    await revokeQuoteShare(w.sales, quote.id, sent.share.id, NOW);
    expect(await openQuoteLink(token, {}, NOW)).toEqual({ status: "not_found" });
    expect((await issuesOf(revokeQuoteShare(w.sales, quote.id, sent.share.id, NOW)))[0]).toMatchObject({ code: "ALREADY_REVOKED" });
    const types = (await getQuoteActivity(w.sales, quote.id, 1)).events.map((e) => e.type);
    expect(types).toEqual(["SENT", "LINK_REVOKED"]);
  });

  it("counts every view, logs one per 10 minutes, and writes the deal timeline once an hour at most, without any amount in it", async () => {
    const { w, quote, token } = await sentQuote();
    const open = (offsetMinutes: number) => openQuoteLink(token, { userAgent: "TestBrowser/1.0" }, new Date(NOW.getTime() + offsetMinutes * 60_000));
    await open(1);
    await open(5);
    await open(30);
    await open(70);
    const activity = await getQuoteActivity(w.sales, quote.id, 1);
    expect(activity.events.filter((e) => e.type === "VIEWED")).toHaveLength(3);
    expect(activity.shares[0]).toMatchObject({ viewCount: 4, active: true });
    expect(activity.shares[0]!.firstViewedAt).toBeTruthy();

    const timeline = await adminDb.activity.findMany({ where: { organizationId: w.org.id, dealId: w.deal.id }, orderBy: { occurredAt: "asc" } });
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ subject: expect.stringMatching(/opened by the client/), authorMembershipId: w.sales.membershipId });
    expect(timeline.map((a) => `${a.subject} ${a.description}`).join(" ")).not.toMatch(/\d{2},\d{3}|KES/);
    expect(await adminDb.quoteEvent.count({ where: { organizationId: w.org.id, userAgent: "TestBrowser/1.0" } })).toBe(3);
  });

  it("an expired visit is recorded as such and does not count as a view", async () => {
    const { w, quote, token } = await sentQuote({ linkExpiresInDays: 1 });
    await openQuoteLink(token, {}, new Date(NOW.getTime() + 3 * 86_400_000));
    const a = await getQuoteActivity(w.sales, quote.id, 1, new Date(NOW.getTime() + 4 * 86_400_000));
    expect(a.events.map((e) => e.type)).toEqual(["SENT", "LINK_EXPIRED_VISIT"]);
    expect(a.shares[0]).toMatchObject({ viewCount: 0, active: false });
  });

  it("is isolated per organisation: another organisation cannot read events or revoke, and the database walls the rows", async () => {
    const a = await sentQuote();
    const b = await commercialWorld();
    await expect(getQuoteActivity(b.management, a.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeQuoteShare(b.management, a.quote.id, a.sent.share.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewQuote(b.management, a.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withOrgContext(b.org.id, (tx) => tx.quoteShare.findMany({ where: { id: a.sent.share.id } }))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.quoteEvent.findMany({ where: { organizationId: a.w.org.id } }))).toEqual([]);
    // Management of the owning organisation sees the version as SENT.
    expect(await getQuoteVersion(a.w.management, a.quote.id, 1)).toMatchObject({ status: "SENT" });
  });
});
