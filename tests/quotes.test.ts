import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { maskAuditSnapshot } from "../src/auth/masking";
import { computeTotals, quoteMarginPct } from "../src/lib/quotes";
import { withOrgContext } from "../src/db/orgScopedClient";
import { updateCatalogueEntry } from "../src/services/catalogueService";
import { checkDealMove, moveDeal } from "../src/services/dealRuleService";
import {
  applyQuoteTotalToDeal,
  createNewVersion,
  createQuote,
  getQuote,
  getQuoteForDeal,
  getQuoteVersion,
  listQuotesPage,
  presentVersion,
  quoteGateBlocker,
  recordQuoteResponse,
  transitionVersion,
  updateDraftVersion,
  updateQuoteSettings,
} from "../src/services/quoteService";
import { commercialWorld, dealOwnedBy, stageIdFor } from "./commercialFixtures";
import { createTestContext } from "./helpers/fixtures";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

async function versionIdOf(orgId: string, quoteId: string, version: number) {
  return (await adminDb.quoteVersion.findFirstOrThrow({ where: { organizationId: orgId, quoteId, version } })).id;
}

describe("quote arithmetic (FIG-1143)", () => {
  it("works in cents and reports a margin only when every cost is known", () => {
    const t = computeTotals(
      [
        { quantity: 12, unitPrice: 18500, unitCost: 11000 },
        { quantity: 1, unitPrice: 65000, unitCost: 42000 },
        { quantity: 1, unitPrice: 95000, unitCost: 72000 },
      ],
      8,
    );
    expect(t).toEqual({ subtotal: 382000, discountAmount: 30560, total: 351440, costTotal: 246000 });
    expect(quoteMarginPct(t.total, t.costTotal)).toBe(30);
    expect(computeTotals([{ quantity: 1, unitPrice: 10, unitCost: null }], 0).costTotal).toBeNull();
    expect(computeTotals([], 0)).toEqual({ subtotal: 0, discountAmount: 0, total: 0, costTotal: null });
    expect(computeTotals([{ quantity: 3, unitPrice: 0.1, unitCost: null }], 0).subtotal).toBe(0.3);
    expect(quoteMarginPct(0, 5)).toBeNull();
  });
});

describe("quotes (FIG-1143, B6.11)", () => {
  it("builds a quote from the catalogue, numbers it, and masks cost and margin for Sales while Management sees them", async () => {
    const w = await commercialWorld();
    const created = await createQuote(w.sales, w.deal.id, {
      lines: [
        { catalogueItemId: w.camera.id, quantity: 12 },
        { catalogueItemId: w.recorder.id, quantity: 1 },
        { description: "Site survey", unit: "visit", quantity: 1, unitPrice: "5000.00" },
      ],
      discountPercent: 8,
    });
    expect(created.quote.number).toMatch(/^Q-\d{4}-0001$/);
    const v = created.version;
    expect(v).toMatchObject({ version: 1, status: "DRAFT", locked: false, discountPercent: 8, subtotal: 292000, discountAmount: 23360, total: 268640, amountMasked: false });
    expect(v.lines).toHaveLength(3);
    expect(v.terms).toContain("16% VAT");

    // Sales owns the deal: sees prices, never cost or margin.
    expect(v).toMatchObject({ cost: null, marginPct: null, marginMasked: true });
    expect(v.lines.every((l) => l.unitCost === null)).toBe(true);
    expect(JSON.stringify(created)).not.toContain("11000");
    expect(JSON.stringify(created)).not.toContain("42000");

    const asManagement = await getQuoteVersion(w.management, created.quote.id, 1);
    expect(asManagement).toMatchObject({ marginMasked: false, total: 268640 });
    // The custom line has no cost, so no margin can be worked out even for Management.
    expect(asManagement).toMatchObject({ cost: null, marginPct: null });
  });

  it("management sees cost and margin only when every line has a cost", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }] });
    const v = await getQuoteVersion(w.management, quote.id, 1);
    expect(v).toMatchObject({ cost: 22000, marginPct: 41, subtotal: 37000, total: 37000 });
    const withCustom = await updateDraftVersion(w.sales, quote.id, 1, {
      lines: [{ lineId: v.lines[0]!.id, quantity: 2 }, { description: "Travel", quantity: 1, unitPrice: 1000 }],
    });
    expect(withCustom.total).toBe(38000);
    expect((await getQuoteVersion(w.management, quote.id, 1)).marginPct).toBeNull();
  });

  it("applies the deal value rule to amounts, and margin needs both value and margin permissions", () => {
    const row = {
      id: "v", organizationId: "o", quoteId: "q", version: 1, status: "DRAFT", discountPercent: 0, validUntil: new Date("2026-12-01"), terms: null,
      subtotal: 100, discountAmount: 0, total: 100, costTotal: 60, currency: "KES", lockedAt: null, submittedAt: null, approvedAt: null,
      decidedByMembershipId: null, decisionReason: null, sentAt: null, respondedAt: null, createdByMembershipId: null, createdAt: new Date(), updatedAt: new Date(),
      lines: [{ id: "l", organizationId: "o", quoteVersionId: "v", position: 0, catalogueItemId: null, description: "x", unit: "unit", quantity: 1, unitPrice: 100, unitCost: 60, taxable: true, lineTotal: 100, createdAt: new Date() }],
    } as unknown as Parameters<typeof presentVersion>[2];
    const noValue = presentVersion({ permissionKeys: ["quotes.create"], membershipId: "m1" }, { ownerMembershipId: "m2" }, row);
    expect(noValue).toMatchObject({ total: null, subtotal: null, discountAmount: null, cost: null, marginPct: null, amountMasked: true, marginMasked: true });
    expect(noValue.lines[0]).toMatchObject({ unitPrice: null, lineTotal: null, unitCost: null });
    expect(JSON.stringify(noValue)).not.toMatch(/"(?:total|cost|unitCost)":\s*(?:100|60)/);
    const marginOnly = presentVersion({ permissionKeys: ["deals.margin"], membershipId: "m1" }, { ownerMembershipId: "m2" }, row);
    expect(marginOnly).toMatchObject({ total: null, cost: null, marginPct: null });
    const all = presentVersion({ permissionKeys: ["deals.view.value", "deals.margin"], membershipId: "m1" }, { ownerMembershipId: "m2" }, row);
    expect(all).toMatchObject({ total: 100, cost: 60, marginPct: 40 });
  });

  it("follows deal visibility and permissions: another salesperson gets 404, Finance and Delivery are refused, one quote per deal", async () => {
    const w = await commercialWorld();
    const delivery = await createTestContext(w.org.id, "DELIVERY");
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    await expect(getQuote(w.salesTwo, quote.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuoteForDeal(w.salesTwo, w.deal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createQuote(w.salesTwo, w.deal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuote(w.finance, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getQuote(delivery, quote.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await issuesOf(createQuote(w.sales, w.deal.id)))[0]).toMatchObject({ code: "QUOTE_EXISTS" });
    // Management opens any deal. Sales lists only quotes on own deals.
    expect((await getQuote(w.management, quote.id)).number).toBe(quote.number);
    const otherDeal = await dealOwnedBy(w.salesTwo, w.company.id);
    await createQuote(w.salesTwo, otherDeal.id, {});
    expect((await listQuotesPage(w.sales)).items.map((q) => q.dealId)).toEqual([w.deal.id]);
    expect((await listQuotesPage(w.management)).total).toBe(2);
    expect((await listQuotesPage(w.management, { status: "SENT" })).total).toBe(0);
    expect((await listQuotesPage(w.management, { status: "DRAFT" })).total).toBe(2);
    await expect(listQuotesPage(delivery)).rejects.toBeInstanceOf(ForbiddenError);
    // Numbers are unique and ascending per organisation.
    const numbers = (await adminDb.quote.findMany({ where: { organizationId: w.org.id }, orderBy: { number: "asc" } })).map((q) => q.number.slice(-4));
    expect(numbers).toEqual(["0001", "0002"]);
  });

  it("validates lines, discount, quantity, validity and catalogue rules with a reason per field", async () => {
    const w = await commercialWorld();
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const bad = await issuesOf(
      createQuote(w.sales, w.deal.id, {
        discountPercent: 31,
        validUntil: past,
        lines: [
          { catalogueItemId: w.camera.id, quantity: 0 },
          { catalogueItemId: w.camera.id, quantity: 1, unitPrice: 1 },
          { catalogueItemId: "nope", quantity: 1 },
          { description: "", quantity: 1, unitPrice: 5 },
          { description: "Custom", quantity: 1 },
        ],
      }),
    );
    const codes = bad.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["INVALID_DISCOUNT", "VALIDITY_IN_PAST"]));
    const lineIssues = await issuesOf(
      createQuote(w.sales, w.deal.id, {
        lines: [
          { catalogueItemId: w.camera.id, quantity: 0 },
          { catalogueItemId: w.camera.id, quantity: 1, unitPrice: 1 },
          { catalogueItemId: "nope", quantity: 1 },
          { description: "", quantity: 1, unitPrice: 5 },
          { description: "Custom", quantity: 1 },
        ],
      }),
    );
    expect(lineIssues.map((i) => i.code)).toEqual(["INVALID_QUANTITY", "PRICE_FROM_CATALOGUE", "UNKNOWN_ITEM", "DESCRIPTION_REQUIRED", "INVALID_AMOUNT"]);
    expect(lineIssues.map((i) => i.path)).toEqual(["lines.0.quantity", "lines.1.unitPrice", "lines.2.catalogueItemId", "lines.3.description", "lines.4.unitPrice"]);

    await updateCatalogueEntry(w.management, w.recorder.id, { status: "HIDDEN" });
    expect((await issuesOf(createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.recorder.id, quantity: 1 }] })))[0]).toMatchObject({ code: "ITEM_HIDDEN" });
    expect((await issuesOf(createQuote(w.sales, w.deal.id, { currency: "USD", lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] })))[0]).toMatchObject({ code: "CURRENCY_MISMATCH" });
  });

  it("freezes price and cost on the line: a catalogue change never alters a quote, and a new version can refresh on request", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 4 }] });
    await updateCatalogueEntry(w.management, w.camera.id, { price: 20000 });
    expect((await getQuoteVersion(w.sales, quote.id, 1)).total).toBe(74000);
    // Mark it final so a new version can be made.
    const id = await versionIdOf(w.org.id, quote.id, 1);
    await transitionVersion(w.org.id, id, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    await transitionVersion(w.org.id, id, ["PENDING_APPROVAL"], "APPROVED");
    const kept = await createNewVersion(w.sales, quote.id);
    expect(kept).toMatchObject({ version: 2, status: "DRAFT", total: 74000 });
    await transitionVersion(w.org.id, await versionIdOf(w.org.id, quote.id, 2), ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    await transitionVersion(w.org.id, await versionIdOf(w.org.id, quote.id, 2), ["PENDING_APPROVAL"], "APPROVED");
    expect(await createNewVersion(w.sales, quote.id, { refreshPrices: true })).toMatchObject({ version: 3, total: 80000 });
  });

  it("makes versions immutable: the service refuses an edit, and the database refuses it even with direct access", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }], discountPercent: 3 });
    const v1 = await versionIdOf(w.org.id, quote.id, 1);

    // A draft cannot get a new version; it is edited.
    expect((await issuesOf(createNewVersion(w.sales, quote.id)))[0]).toMatchObject({ code: "DRAFT_EXISTS" });
    await transitionVersion(w.org.id, v1, ["DRAFT"], "PENDING_APPROVAL", { lock: true, submittedAt: new Date() });

    const edit = await issuesOf(updateDraftVersion(w.sales, quote.id, 1, { discountPercent: 1 }));
    expect(edit[0]).toMatchObject({ code: "VERSION_LOCKED" });
    expect((await issuesOf(createNewVersion(w.sales, quote.id)))[0]).toMatchObject({ code: "AWAITING_APPROVAL" });

    // Direct access: even the schema owner cannot change what was locked.
    await expect(adminDb.quoteVersion.update({ where: { id: v1 }, data: { discountPercent: 1 } })).rejects.toThrow(/locked/);
    await expect(adminDb.quoteVersion.update({ where: { id: v1 }, data: { total: 1 } })).rejects.toThrow(/locked/);
    await expect(adminDb.quoteVersion.update({ where: { id: v1 }, data: { terms: "new" } })).rejects.toThrow(/locked/);
    await expect(adminDb.quoteLine.create({ data: { organizationId: w.org.id, quoteVersionId: v1, position: 9, description: "x", quantity: 1, unitPrice: 1, lineTotal: 1 } })).rejects.toThrow(/locked/);
    const line = await adminDb.quoteLine.findFirstOrThrow({ where: { quoteVersionId: v1 } });
    await expect(adminDb.quoteLine.update({ where: { id: line.id }, data: { quantity: 99 } })).rejects.toThrow(/locked/);
    await expect(adminDb.quoteLine.delete({ where: { id: line.id } })).rejects.toThrow(/locked/);
    await expect(adminDb.quoteVersion.delete({ where: { id: v1 } })).rejects.toThrow(/locked/);
    // The app role, in its own organisation, is held to the same rule.
    await expect(withOrgContext(w.org.id, (tx) => tx.quoteVersion.update({ where: { id: v1 }, data: { discountPercent: 2 } }))).rejects.toThrow(/locked/);
    // Status may only move along the allowed steps.
    await expect(adminDb.quoteVersion.update({ where: { id: v1 }, data: { status: "SENT" } })).rejects.toThrow(/cannot go from/);
    await expect(adminDb.quoteVersion.update({ where: { id: v1 }, data: { status: "DRAFT" } })).rejects.toThrow(/cannot go from/);

    // After the decision the next version carries on from it; version 1 is untouched.
    await transitionVersion(w.org.id, v1, ["PENDING_APPROVAL"], "REJECTED", { decisionReason: "Too deep" });
    const v2 = await createNewVersion(w.sales, quote.id);
    expect(v2.version).toBe(2);
    const afterwards = await getQuoteVersion(w.sales, quote.id, 1);
    expect(afterwards).toMatchObject({ status: "REJECTED", discountPercent: 3, locked: true, decisionReason: "Too deep" });
    expect((await getQuote(w.sales, quote.id)).versions.map((x) => [x.version, x.status])).toEqual([[1, "REJECTED"], [2, "DRAFT"]]);

    // Deleting the deal still removes its quote (a cascade is not a statement on the locked version).
    await adminDb.deal.delete({ where: { id: w.deal.id } });
    expect(await adminDb.quote.count({ where: { id: quote.id } })).toBe(0);
  });

  it("records accepted or declined only on a sent version, and copies the total to the deal for people who may see it", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 3 }] });
    const id = await versionIdOf(w.org.id, quote.id, 1);
    expect((await issuesOf(recordQuoteResponse(w.sales, quote.id, 1, { outcome: "ACCEPTED" })))[0]).toMatchObject({ code: "NOT_SENT" });
    await transitionVersion(w.org.id, id, ["DRAFT"], "APPROVED", { lock: true });
    await transitionVersion(w.org.id, id, ["APPROVED"], "SENT", { sentAt: new Date() });
    const done = await recordQuoteResponse(w.sales, quote.id, 1, { outcome: "ACCEPTED", note: "Signed on site" });
    expect(done).toMatchObject({ status: "ACCEPTED", decisionReason: "Signed on site" });
    await expect(recordQuoteResponse(w.sales, quote.id, 1, { outcome: "DECLINED" })).rejects.toBeInstanceOf(ValidationError);

    const updated = await applyQuoteTotalToDeal(w.sales, quote.id, 1);
    expect(updated.id).toBe(w.deal.id);
    expect(Number((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).value)).toBe(55500);
    await expect(applyQuoteTotalToDeal(w.salesTwo, quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("audits quote events, with the total masked for a reader without value permissions", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const event = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: w.org.id, entityType: "Quote", entityId: quote.id, action: "quote.created" } });
    expect(event.newValue).toMatchObject({ total: 18500, version: 1 });
    expect(maskAuditSnapshot(w.finance, "Quote", event.newValue)).toMatchObject({ version: 1 });
    expect(JSON.stringify(maskAuditSnapshot({ ...w.sales, permissionKeys: [] }, "Quote", event.newValue))).not.toContain("18500");
  });

  it("is isolated per organisation", async () => {
    const a = await commercialWorld();
    const b = await commercialWorld();
    const { quote } = await createQuote(a.sales, a.deal.id, { lines: [{ catalogueItemId: a.camera.id, quantity: 1 }] });
    await expect(getQuote(b.management, quote.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateDraftVersion(b.management, quote.id, 1, { discountPercent: 1 })).rejects.toBeInstanceOf(NotFoundError);
    expect(await withOrgContext(b.org.id, (tx) => tx.quote.findMany({ where: { id: quote.id } }))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.quoteLine.findMany({ where: { organizationId: a.org.id } }))).toEqual([]);
    await expect(withOrgContext(b.org.id, (tx) => tx.quote.create({ data: { organizationId: a.org.id, dealId: a.deal.id, number: "Q-0000-0001" } }))).rejects.toThrow();
  });
});

describe("the Proposal Sent gate (FIG-1143)", () => {
  it("leaves V1 behaviour alone until the organisation switches the rule on, then blocks with a reason that names what is missing", async () => {
    const w = await commercialWorld();
    const proposalStage = await stageIdFor(w.org.id, "PROPOSAL_SENT");
    // Off by default: the move works with no quote.
    expect(await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposalStage })).toMatchObject({ allowed: true });

    await expect(updateQuoteSettings(w.sales, { requireForProposalSent: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await updateQuoteSettings(w.management, { requireForProposalSent: true, validityDays: 14 })).toMatchObject({ requireForProposalSent: true, validityDays: 14 });

    const none = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposalStage });
    expect(none.allowed).toBe(false);
    expect(none.blockers[0]).toMatchObject({ code: "QUOTE_REQUIRED", field: "pipelineStageId" });
    const err = await moveDeal(w.sales, w.deal.id, { pipelineStageId: proposalStage }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues[0]).toMatchObject({ code: "QUOTE_REQUIRED" });

    const { quote, version } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    expect(version.validUntil).toBe(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposalStage })).blockers[0]).toMatchObject({ code: "QUOTE_NOT_APPROVED" });

    const id = await versionIdOf(w.org.id, quote.id, 1);
    await transitionVersion(w.org.id, id, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposalStage })).blockers[0]?.message).toContain("waiting for approval");
    await transitionVersion(w.org.id, id, ["PENDING_APPROVAL"], "APPROVED");
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposalStage })).allowed).toBe(true);
    const moved = await moveDeal(w.sales, w.deal.id, { pipelineStageId: proposalStage });
    expect(moved.deal.pipelineStageId).toBe(proposalStage);

    // Other stages are never gated.
    const negotiation = await stageIdFor(w.org.id, "NEGOTIATION");
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: negotiation })).allowed).toBe(true);
  });

  it("calls a quote past its validity date expired", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }], validUntil: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) });
    const id = await versionIdOf(w.org.id, quote.id, 1);
    await transitionVersion(w.org.id, id, ["DRAFT"], "APPROVED", { lock: true });
    expect(await quoteGateBlocker(w.org.id, w.deal.id)).toBeNull();
    const later = new Date(Date.now() + 10 * 86_400_000);
    expect(await quoteGateBlocker(w.org.id, w.deal.id, later)).toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(await getQuoteVersion(w.sales, quote.id, 1, later)).toMatchObject({ expired: true });
    expect(await getQuoteVersion(w.sales, quote.id, 1)).toMatchObject({ expired: false });
  });
});
