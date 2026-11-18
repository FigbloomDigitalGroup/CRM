import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { applyQuoteTotalToDeal, createNewVersion, createQuote, listQuotesPage, transitionVersion } from "../src/services/quoteService";
import { getQuoteActivity, openQuoteLink, sendQuote } from "../src/services/quoteDocumentService";
import { getApproval, listApprovals } from "../src/services/approvalService";
import { commercialWorld, dealOwnedBy } from "./commercialFixtures";

const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
const NOW = new Date();

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

async function draft() {
  const w = await commercialWorld();
  const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] }, NOW);
  const versionId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id;
  return { w, quote, versionId };
}

describe("quote hardening: custom lines (R3-4)", () => {
  it("a custom line needs catalogue.manage, so it cannot walk round the discount approval", async () => {
    const w = await commercialWorld();
    await expect(createQuote(w.sales, w.deal.id, { lines: [{ description: "Cameras, special price", quantity: 10, unitPrice: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await createQuote(w.management, w.deal.id, { lines: [{ description: "Site survey", quantity: 1, unitPrice: 5000 }] });
    expect(ok.version.lines).toHaveLength(1);
  });
});

describe("quote hardening: database guards (R3-7)", () => {
  it("a draft cannot jump to another status, or be locked without leaving draft, by a direct write", async () => {
    const { versionId } = await draft();
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "APPROVED" } })).rejects.toThrow(/cannot go from DRAFT to APPROVED/);
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "APPROVED", lockedAt: new Date() } })).rejects.toThrow(/cannot go from DRAFT to APPROVED/);
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "ACCEPTED", lockedAt: new Date() } })).rejects.toThrow(/cannot go from DRAFT/);
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "SENT" } })).rejects.toThrow(/must be locked/);
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { lockedAt: new Date() } })).rejects.toThrow(/draft/);
    // The legal move still works.
    await adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "PENDING_APPROVAL", lockedAt: new Date() } });
  });

  it("a line of an open draft cannot be moved into a locked version", async () => {
    const w = await commercialWorld();
    const first = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const deal2 = await dealOwnedBy(w.sales, w.company.id);
    const second = await createQuote(w.sales, deal2.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const lockedId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: first.quote.id } })).id;
    const openVersionId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: second.quote.id } })).id;
    const openLine = await adminDb.quoteLine.findFirstOrThrow({ where: { quoteVersionId: openVersionId } });
    await transitionVersion(w.org.id, lockedId, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    await expect(adminDb.quoteLine.update({ where: { id: openLine.id }, data: { quoteVersionId: lockedId } })).rejects.toThrow(/locked/);
  });
});

describe("quote hardening: lists and ids (R3-8)", () => {
  it("pages and filters quotes by the latest version status in the database", async () => {
    const w = await commercialWorld();
    await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const all = await listQuotesPage(w.sales, {}, { pageSize: 1 });
    expect(all.total).toBe(1);
    expect(all.items).toHaveLength(1);
    expect((await listQuotesPage(w.sales, { status: "DRAFT" })).total).toBe(1);
    expect((await listQuotesPage(w.sales, { status: "SENT" })).total).toBe(0);
  });

  it("reads an old export approval by id and pages the inbox with a true total", async () => {
    const w = await commercialWorld();
    const rows = Array.from({ length: 105 }, (_, i) => ({ organizationId: w.org.id, entity: "DEAL", rowCount: 1000 + i, requestedByMembershipId: w.sales.membershipId, createdAt: new Date(NOW.getTime() - i * 60_000) }));
    await adminDb.exportApproval.createMany({ data: rows });
    const oldest = await adminDb.exportApproval.findFirstOrThrow({ where: { organizationId: w.org.id }, orderBy: { createdAt: "asc" } });
    expect(await getApproval(w.management, oldest.id)).toMatchObject({ id: oldest.id, source: "EXPORT" });
    await expect(getApproval(w.salesTwo, oldest.id)).rejects.toBeInstanceOf(NotFoundError);
    const page = await listApprovals(w.sales, {}, { pageSize: 20 });
    expect(page.total).toBe(105);
    expect(page.items).toHaveLength(20);
    expect(page.pending).toBe(105);
    const last = await listApprovals(w.sales, {}, { page: 6, pageSize: 20 });
    expect(last.items).toHaveLength(5);
  });
});

describe("quote hardening: the quote total (R3-9)", () => {
  it("copies the total only from an approved, sent or accepted version", async () => {
    const { w, quote, versionId } = await draft();
    expect((await issuesOf(applyQuoteTotalToDeal(w.sales, quote.id, 1)))[0]).toMatchObject({ code: "VERSION_NOT_FINAL" });
    await transitionVersion(w.org.id, versionId, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    await transitionVersion(w.org.id, versionId, ["PENDING_APPROVAL"], "REJECTED", { decisionReason: "no" });
    expect((await issuesOf(applyQuoteTotalToDeal(w.sales, quote.id, 1)))[0]).toMatchObject({ code: "VERSION_NOT_FINAL" });
  });
});

describe("quote hardening: sending and the public link (R2-2, R2-9, R2-10)", () => {
  async function sent() {
    const { w, quote } = await draft();
    const out = await sendQuote(w.sales, quote.id, 1, { to: "client@example.test", linkExpiresInDays: 1 }, NOW);
    return { w, quote, out, token: tokenOf(out.link) };
  }

  it("refuses a recipient that is a list or has angle brackets", async () => {
    const { w, quote } = await draft();
    for (const to of ["a@b.com,c", "<a@b.com>", "a@b.com;c@d.com", "a b@c.com"]) {
      expect((await issuesOf(sendQuote(w.sales, quote.id, 1, { to }, NOW)))[0]).toMatchObject({ code: "RECIPIENT_REQUIRED" });
    }
  });

  it("stops serving the link when the organisation is deactivated, without writing any trace", async () => {
    const { w, token } = await sent();
    expect(await openQuoteLink(token, {}, NOW)).toMatchObject({ status: "ok" });
    const before = await adminDb.quoteEvent.count({ where: { organizationId: w.org.id } });
    const activities = await adminDb.activity.count({ where: { organizationId: w.org.id } });
    await adminDb.organization.update({ where: { id: w.org.id }, data: { status: "INACTIVE" } });
    expect(await openQuoteLink(token, {}, new Date(NOW.getTime() + 2 * 3_600_000))).toEqual({ status: "not_found" });
    expect(await openQuoteLink(token, {}, new Date(NOW.getTime() + 3 * 86_400_000))).toEqual({ status: "not_found" });
    expect(await adminDb.quoteEvent.count({ where: { organizationId: w.org.id } })).toBe(before);
    expect(await adminDb.activity.count({ where: { organizationId: w.org.id } })).toBe(activities);
  });

  it("stops serving an older version once a newer one has been sent", async () => {
    const { w, quote, token } = await sent();
    await transitionVersion(w.org.id, (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id, ["SENT"], "DECLINED");
    await createNewVersion(w.sales, quote.id, {}, NOW);
    const v2 = await sendQuote(w.sales, quote.id, 2, { to: "client@example.test" }, NOW);
    expect(await openQuoteLink(token, {}, NOW)).toEqual({ status: "not_found" });
    expect(await openQuoteLink(tokenOf(v2.link), {}, NOW)).toMatchObject({ status: "ok" });
  });

  it("logs one view per link per 10 minutes and one expired visit per link per hour, while still counting views", async () => {
    const { w, quote, token } = await sent();
    const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
    for (const m of [1, 2, 3, 4, 5]) await openQuoteLink(token, {}, at(m));
    await openQuoteLink(token, {}, at(20));
    const day3 = 3 * 24 * 60;
    for (const m of [day3, day3 + 5, day3 + 30, day3 + 90]) await openQuoteLink(token, {}, at(m));
    const a = await getQuoteActivity(w.sales, quote.id, 1, at(4 * 24 * 60));
    const types = a.events.map((e) => e.type);
    expect(types.filter((t) => t === "VIEWED")).toHaveLength(2);
    expect(types.filter((t) => t === "LINK_EXPIRED_VISIT")).toHaveLength(2);
    expect(a.shares[0]).toMatchObject({ viewCount: 6 });
  });
});
