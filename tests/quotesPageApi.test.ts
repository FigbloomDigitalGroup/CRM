import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { createQuote, getQuote, listQuotesPage, transitionVersion } from "../src/services/quoteService";
import { openQuoteLink, revokeQuoteShare, sendQuote } from "../src/services/quoteDocumentService";
import { createView, listViews } from "../src/services/savedViewService";
import { commercialWorld, dealOwnedBy } from "./commercialFixtures";
import { createTestContext } from "./helpers/fixtures";

/**
 * UC-R3 (FIG-1784) and UC-R4 (FIG-1777): the additive filters of the quotes list, the Finance read path (quotes.view), the link-only send
 * (`channel: "link"`) and the quotes saved view. These need the test database (written in the existing DB-backed style).
 */

const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
const without = (ctx: AuthContext, ...keys: string[]): AuthContext => ({ ...ctx, permissionKeys: ctx.permissionKeys.filter((k) => !keys.includes(k)) });

async function world() {
  const w = await commercialWorld();
  const lines = { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] };
  const second = await dealOwnedBy(w.salesTwo, w.company.id);
  const a = (await createQuote(w.sales, w.deal.id, lines)).quote;
  const b = (await createQuote(w.salesTwo, second.id, lines)).quote;
  return { ...w, second, a, b, lines };
}

describe("the quotes list's additive filters (UC-R3)", () => {
  it("q matches the quote number, the customer's name and the deal's notes, case-insensitively, and escapes wildcards", async () => {
    const w = await world();
    expect((await listQuotesPage(w.management, { q: w.a.number.toLowerCase() })).items.map((i) => i.id)).toEqual([w.a.id]);
    expect((await listQuotesPage(w.management, { q: "mwangaza" })).total).toBe(2);
    expect((await listQuotesPage(w.management, { q: "no such customer" })).total).toBe(0);
    expect((await listQuotesPage(w.management, { q: "%" })).total).toBe(0);
  });

  it("owner and companyId narrow to that deal owner and customer", async () => {
    const w = await world();
    const owner = await adminDb.deal.findUniqueOrThrow({ where: { id: w.second.id }, select: { ownerMembershipId: true } });
    expect((await listQuotesPage(w.management, { owner: owner.ownerMembershipId })).items.map((i) => i.id)).toEqual([w.b.id]);
    expect((await listQuotesPage(w.management, { companyId: w.company.id })).total).toBe(2);
    expect((await listQuotesPage(w.management, { companyId: "00000000-0000-0000-0000-000000000000" })).total).toBe(0);
  });

  it("validFrom and validTo bound the latest version's validity date, inclusive; a bad date or a reversed range is a 400", async () => {
    const w = await world();
    const until = (await getQuote(w.management, w.a.id)).versions[0]!.validUntil;
    expect((await listQuotesPage(w.management, { validFrom: until, validTo: until })).total).toBe(2);
    expect((await listQuotesPage(w.management, { validTo: "2000-01-01" })).total).toBe(0);
    await expect(listQuotesPage(w.management, { validFrom: "tomorrow" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listQuotesPage(w.management, { validFrom: "2026-12-31", validTo: "2026-01-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listQuotesPage(w.management, { expired: "maybe" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("expired=only is the derived state (sent or approved, past its date); exclude is everything else; DRAFT is never expired", async () => {
    const w = await world();
    const later = new Date(Date.now() + 400 * 86_400_000);
    // A draft past its date is not "Expired" (only sent or approved quotes are).
    expect((await listQuotesPage(w.management, { expired: "only" }, {}, later)).total).toBe(0);
    const id = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: w.a.id, version: 1 } })).id;
    await transitionVersion(w.org.id, id, ["DRAFT"], "SENT", { lock: true, sentAt: new Date() });
    expect((await listQuotesPage(w.management, { expired: "only" })).total).toBe(0);
    expect((await listQuotesPage(w.management, { expired: "only" }, {}, later)).items.map((i) => i.id)).toEqual([w.a.id]);
    expect((await listQuotesPage(w.management, { expired: "exclude" }, {}, later)).items.map((i) => i.id)).toEqual([w.b.id]);
    expect((await listQuotesPage(w.management, { status: "SENT", expired: "exclude" }, {}, later)).total).toBe(0);
  });

  it("counts: one bucket per chip, adding up to ALL, over the other filters; Expired is counted apart from Sent", async () => {
    const w = await world();
    const later = new Date(Date.now() + 400 * 86_400_000);
    const id = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: w.a.id, version: 1 } })).id;
    await transitionVersion(w.org.id, id, ["DRAFT"], "SENT", { lock: true, sentAt: new Date() });
    const now = await listQuotesPage(w.management, { counts: true });
    expect(now.statusCounts).toMatchObject({ ALL: 2, DRAFT: 1, SENT: 1, EXPIRED: 0 });
    const expired = await listQuotesPage(w.management, { counts: true }, {}, later);
    expect(expired.statusCounts).toMatchObject({ ALL: 2, DRAFT: 1, SENT: 0, EXPIRED: 1 });
    // The counts ignore the status filter itself (the chips stay whole) but follow the others.
    const narrowed = await listQuotesPage(w.management, { counts: true, status: "DRAFT", q: w.b.number });
    expect(narrowed.statusCounts).toMatchObject({ ALL: 1, DRAFT: 1 });
    expect(narrowed.items.map((i) => i.id)).toEqual([w.b.id]);
    // Without the flag the page is unchanged.
    expect(await listQuotesPage(w.management)).not.toHaveProperty("statusCounts");
  });

  it("filters never widen what a salesperson may see, counts included, and never reach another organisation", async () => {
    const w = await world();
    const other = await world();
    expect((await listQuotesPage(w.sales, { q: "mwangaza", counts: true })).items.map((i) => i.id)).toEqual([w.a.id]);
    expect((await listQuotesPage(w.sales, { counts: true })).statusCounts).toMatchObject({ ALL: 1 });
    const theirOwner = await adminDb.deal.findUniqueOrThrow({ where: { id: w.second.id }, select: { ownerMembershipId: true } });
    expect((await listQuotesPage(w.sales, { owner: theirOwner.ownerMembershipId })).items).toEqual([]);
    expect((await listQuotesPage(w.management, { q: other.a.number, companyId: other.company.id })).items).toEqual([]);
  });

  it("paging with filters reports the real total and the right slice", async () => {
    const w = await world();
    const p1 = await listQuotesPage(w.management, { q: "mwangaza" }, { page: 1, pageSize: 1 });
    const p2 = await listQuotesPage(w.management, { q: "mwangaza" }, { page: 2, pageSize: 1 });
    expect([p1.total, p2.total, p1.items.length, p2.items.length]).toEqual([2, 2, 1, 1]);
    expect(p1.items[0]!.id).not.toBe(p2.items[0]!.id);
    expect((await listQuotesPage(w.management, { q: "mwangaza" }, { page: 9, pageSize: 1 })).total).toBe(2);
  });

  it("activity: links, active, revoked and views per row, only when asked for, and no token or address in it", async () => {
    const w = await world();
    const sent = await sendQuote(w.sales, w.a.id, 1, { to: "buyer@example.test" });
    await openQuoteLink(tokenOf(sent.link), { userAgent: "test-agent" });
    const row = (await listQuotesPage(w.management, { activity: true })).items.find((i) => i.id === w.a.id)!;
    expect(row.activity).toMatchObject({ links: 1, activeLinks: 1, revokedLinks: 0, views: 1 });
    expect(JSON.stringify(row.activity)).not.toContain(tokenOf(sent.link));
    expect(JSON.stringify(row.activity)).not.toContain("buyer@example.test");
    await revokeQuoteShare(w.sales, w.a.id, sent.share.id);
    expect((await listQuotesPage(w.management, { activity: true })).items.find((i) => i.id === w.a.id)!.activity).toMatchObject({ activeLinks: 0, revokedLinks: 1 });
    expect((await listQuotesPage(w.management)).items[0]).not.toHaveProperty("activity");
  });

  it("totals stay masked in every row for a role without the deal-value right, whatever the filters", async () => {
    const w = await world();
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { outcome: "WON", wonAt: new Date() } });
    const blind = without(w.finance, "deals.view.value");
    const page = await listQuotesPage(blind, { q: "mwangaza", counts: true, activity: true });
    expect(page.items.length).toBe(1);
    for (const item of page.items) expect(item.latest).toMatchObject({ amountMasked: true, total: null, subtotal: null, discountAmount: null });
    expect(JSON.stringify(page.items)).not.toMatch(/"(total|subtotal)":\s*[1-9]/);
  });
});

describe("Finance reads quotes with quotes.view (UC-R3)", () => {
  it("the list and a quote are open to Finance for won deals only; an open deal is invisible (not refused, not leaked)", async () => {
    const w = await world();
    expect((await listQuotesPage(w.finance)).items).toEqual([]);
    await expect(getQuote(w.finance, w.a.id)).rejects.toBeInstanceOf(NotFoundError);
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { outcome: "WON", wonAt: new Date() } });
    const page = await listQuotesPage(w.finance, { counts: true });
    expect(page.items.map((i) => i.id)).toEqual([w.a.id]);
    expect(page.statusCounts).toMatchObject({ ALL: 1 });
    expect((await getQuote(w.finance, w.a.id)).number).toBe(w.a.number);
  });

  it("Finance still cannot write, send or approve", async () => {
    const w = await world();
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { outcome: "WON", wonAt: new Date() } });
    await expect(sendQuote(w.finance, w.a.id, 1, { channel: "link" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a role with none of the quote keys is still refused (Delivery)", async () => {
    const w = await world();
    const delivery = await createTestContext(w.org.id, "DELIVERY");
    await expect(listQuotesPage(delivery)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("share by link (channel: link) (UC-R4)", () => {
  it("makes the secure link without an email, locks and marks the version as sent, and keeps the link rules", async () => {
    const w = await world();
    const sent = await sendQuote(w.sales, w.a.id, 1, { channel: "link" });
    expect(sent.link).toMatch(/\/api\/public\/quotes\//);
    expect(sent.share.recipientEmail).toBeNull();
    expect(await adminDb.communication.count({ where: { organizationId: w.org.id, dealId: w.deal.id, channel: "EMAIL" } })).toBe(0);
    const version = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: w.a.id, version: 1 } });
    expect(version).toMatchObject({ status: "SENT" });
    expect(version.lockedAt).not.toBeNull();
    // Only the hash of the token is stored; the link works, then stops when revoked.
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { quoteVersionId: version.id } });
    expect(share.recipientEmail).toBe("");
    expect(share.tokenHash).not.toContain(tokenOf(sent.link));
    expect((await openQuoteLink(tokenOf(sent.link), { userAgent: "ua" })).status).toBe("ok");
    await revokeQuoteShare(w.sales, w.a.id, sent.share.id);
    expect((await openQuoteLink(tokenOf(sent.link), { userAgent: "ua" })).status).not.toBe("ok");
  });

  it("needs no recipient and no mail right, but refuses an unknown channel and online signing without an email", async () => {
    const w = await world();
    await expect(sendQuote(w.sales, w.a.id, 1, { channel: "sms" })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendQuote(w.sales, w.a.id, 1, { channel: "link", allowSigning: true })).rejects.toBeInstanceOf(ValidationError);
    // Without the mail right the email channel is refused and the link channel is not.
    const noMail = without(w.sales, "communications.create");
    await expect(sendQuote(noMail, w.a.id, 1, { to: "a@b.example" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await sendQuote(noMail, w.a.id, 1, { channel: "link" })).link).toMatch(/\/api\/public\/quotes\//);
  });

  it("is still refused for another salesperson (404)", async () => {
    const w = await world();
    await expect(sendQuote(w.salesTwo, w.a.id, 1, { channel: "link" })).rejects.toBeInstanceOf(NotFoundError);
    // The owner of a deal always sees its amounts (canSeeDealValue), so removing deals.view.value from the owner does not refuse the send.
  });

  it("a link can be made again for a sent version (a second share, the first keeps working until revoked)", async () => {
    const w = await world();
    const one = await sendQuote(w.sales, w.a.id, 1, { channel: "link" });
    const two = await sendQuote(w.sales, w.a.id, 1, { channel: "link" });
    expect(two.share.id).not.toBe(one.share.id);
    expect(tokenOf(two.link)).not.toBe(tokenOf(one.link));
  });
});

describe("the quotes saved view (UC-R3)", () => {
  it("a person who may open the list saves and reads a quotes view with the page's filters", async () => {
    const w = await world();
    await createView(w.sales, { entity: "quotes", name: "Sent to Kijani", filters: { tab: "SENT", q: "Kij", owner: "m-1", validFrom: "2026-12-01" } });
    expect((await listViews(w.sales, { entity: "quotes" })).items.map((v) => v.name)).toEqual(["Sent to Kijani"]);
  });

  it("refuses a filter the list does not offer (value filters included), and a role that cannot open the list", async () => {
    const w = await world();
    await expect(createView(w.sales, { entity: "quotes", name: "By value", filters: { valueMin: "100" } })).rejects.toBeInstanceOf(ValidationError);
    const delivery = await createTestContext(w.org.id, "DELIVERY");
    await expect(createView(delivery, { entity: "quotes", name: "Nope", filters: { tab: "SENT" } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Finance (quotes.view) may save one; a shared view is visible only to roles that may open the list", async () => {
    const w = await world();
    await createView(w.finance, { entity: "quotes", name: "Accepted", filters: { tab: "ACCEPTED" } });
    expect((await listViews(w.finance, { entity: "quotes" })).items).toHaveLength(1);
    const delivery = await createTestContext(w.org.id, "DELIVERY");
    expect((await listViews(delivery, { entity: "quotes" })).items).toEqual([]);
  });
});
