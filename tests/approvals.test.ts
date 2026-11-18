import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import * as contactService from "../src/services/contactService";
import { checkDealMove, moveDeal } from "../src/services/dealRuleService";
import {
  cancelApproval,
  decideApproval,
  getApproval,
  getApprovalRules,
  listApprovals,
  requestDealMoveApproval,
  requestDiscountApproval,
  updateApprovalRules,
} from "../src/services/approvalService";
import { confirmErasure, createDataSubjectRequest } from "../src/services/privacyService";
import { createNewVersion, createQuote, getQuoteVersion, updateDraftVersion } from "../src/services/quoteService";
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

async function withApprover() {
  const w = await commercialWorld();
  const managementTwo = await createTestContext(w.org.id, "MANAGEMENT");
  return { ...w, managementTwo };
}

async function discountedQuote(w: Awaited<ReturnType<typeof withApprover>>, discountPercent = 8) {
  const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 4 }], discountPercent });
  return quote;
}

describe("approvals: discount on a quote (FIG-1145, B6.13)", () => {
  it("a discount above the limit waits for an approver; approving resumes the blocked send by itself", async () => {
    const w = await withApprover();
    const quote = await discountedQuote(w);
    const item = await requestDiscountApproval(w.sales, quote.id, 1, { note: "Repeat customer", sendOnApproval: { to: "bursar@mwangaza.example" } });
    expect(item).toMatchObject({ source: "REQUEST", kind: "DISCOUNT", status: "PENDING", requesterNote: "Repeat customer", canDecide: false });
    expect(item.title).toContain("8% discount");
    expect(await getQuoteVersion(w.sales, quote.id, 1)).toMatchObject({ status: "PENDING_APPROVAL", locked: true });

    // The inbox: approvers see it and can decide it; the requester sees their own, read-only.
    const asApprover = await listApprovals(w.management);
    expect(asApprover).toMatchObject({ total: 1, pending: 1, canDecide: true });
    expect(asApprover.items[0]).toMatchObject({ id: item.id, canDecide: true });
    const asRequester = await listApprovals(w.sales);
    expect(asRequester).toMatchObject({ total: 1, canDecide: false });
    expect(asRequester.items[0]!.canDecide).toBe(false);
    expect((await listApprovals(w.salesTwo)).total).toBe(0);
    await expect(getApproval(w.salesTwo, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideApproval(w.sales, item.id, { approve: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listApprovals(w.finance)).rejects.toBeInstanceOf(ForbiddenError);

    const decided = await decideApproval(w.management, item.id, { approve: true, reason: "Fine for a repeat customer" });
    expect(decided).toMatchObject({ status: "APPROVED", resumed: true, resumeError: null, decisionReason: "Fine for a repeat customer" });
    // The quote was approved and then sent without anyone pressing send again.
    expect(await getQuoteVersion(w.management, quote.id, 1)).toMatchObject({ status: "SENT", approvedAt: expect.any(Date), sentAt: expect.any(Date) });
    expect(await adminDb.communication.count({ where: { organizationId: w.org.id, dealId: w.deal.id, channel: "EMAIL" } })).toBe(1);
    expect(await adminDb.quoteShare.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("without send-on-approval the version is simply approved and the requester sends it", async () => {
    const w = await withApprover();
    const quote = await discountedQuote(w, 10);
    const item = await requestDiscountApproval(w.sales, quote.id, 1);
    const decided = await decideApproval(w.managementTwo, item.id, { approve: true });
    expect(decided).toMatchObject({ status: "APPROVED", resumed: false });
    expect(await getQuoteVersion(w.sales, quote.id, 1)).toMatchObject({ status: "APPROVED" });
    const { sendQuote } = await import("../src/services/quoteDocumentService");
    expect((await sendQuote(w.sales, quote.id, 1, { to: "a@b.example" })).version.status).toBe("SENT");
  });

  it("a rejection needs a reason, and the requester reads that reason; they then make a new version", async () => {
    const w = await withApprover();
    const quote = await discountedQuote(w);
    const item = await requestDiscountApproval(w.sales, quote.id, 1);
    expect((await issuesOf(decideApproval(w.management, item.id, { approve: false })))[0]).toMatchObject({ code: "REASON_REQUIRED" });
    expect((await issuesOf(decideApproval(w.management, item.id, { approve: false, reason: "no" })))[0]).toMatchObject({ code: "REASON_REQUIRED" });
    const rejected = await decideApproval(w.management, item.id, { approve: false, reason: "Too deep for a first order. Try 5%." });
    expect(rejected).toMatchObject({ status: "REJECTED", decisionReason: "Too deep for a first order. Try 5%." });

    const seen = await getApproval(w.sales, item.id);
    expect(seen).toMatchObject({ status: "REJECTED", decisionReason: "Too deep for a first order. Try 5%.", canDecide: false });
    expect(await getQuoteVersion(w.sales, quote.id, 1)).toMatchObject({ status: "REJECTED", decisionReason: "Too deep for a first order. Try 5%." });
    expect((await listApprovals(w.sales, { status: "REJECTED" })).items[0]!.decisionReason).toContain("Try 5%");

    const v2 = await createNewVersion(w.sales, quote.id);
    expect(v2).toMatchObject({ version: 2, status: "DRAFT" });
    await updateDraftVersion(w.sales, quote.id, 2, { discountPercent: 5 });
    expect(await getQuoteVersion(w.sales, quote.id, 2)).toMatchObject({ approvalRequired: false });
  });

  it("refuses what makes no sense: no approval needed, not a draft, no lines, and asking twice returns the same request", async () => {
    const w = await withApprover();
    const within = await discountedQuote(w, 5);
    expect((await issuesOf(requestDiscountApproval(w.sales, within.id, 1)))[0]).toMatchObject({ code: "APPROVAL_NOT_NEEDED" });
    await updateDraftVersion(w.sales, within.id, 1, { discountPercent: 12 });
    const first = await requestDiscountApproval(w.sales, within.id, 1);
    const again = await requestDiscountApproval(w.sales, within.id, 1);
    expect(again.id).toBe(first.id);
    expect(await adminDb.approvalRequest.count({ where: { organizationId: w.org.id } })).toBe(1);

    const other = await dealOwnedBy(w.salesTwo, w.company.id);
    const { quote: empty } = await createQuote(w.salesTwo, other.id, { discountPercent: 20 });
    expect((await issuesOf(requestDiscountApproval(w.salesTwo, empty.id, 1)))[0]).toMatchObject({ code: "NO_LINES" });
    await expect(requestDiscountApproval(w.salesTwo, within.id, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is decided once, by someone else, and a switched-off rule needs no approval", async () => {
    const w = await withApprover();
    const quote = await discountedQuote(w);
    const item = await requestDiscountApproval(w.sales, quote.id, 1);
    await decideApproval(w.management, item.id, { approve: true });
    expect((await issuesOf(decideApproval(w.managementTwo, item.id, { approve: false, reason: "changed my mind" })))[0]).toMatchObject({ code: "ALREADY_DECIDED" });

    // Management asking for their own request cannot approve it.
    const mine = await dealOwnedBy(w.management, w.company.id);
    const { quote: q2 } = await createQuote(w.management, mine.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }], discountPercent: 9 });
    const own = await requestDiscountApproval(w.management, q2.id, 1);
    expect((await issuesOf(decideApproval(w.management, own.id, { approve: true })))[0]).toMatchObject({ code: "SELF_APPROVAL" });
    expect(await decideApproval(w.managementTwo, own.id, { approve: true })).toMatchObject({ status: "APPROVED" });

    await updateApprovalRules(w.management, { discount: { enabled: false } });
    const third = await dealOwnedBy(w.salesTwo, w.company.id);
    const { quote: q3 } = await createQuote(w.salesTwo, third.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }], discountPercent: 25 });
    expect((await issuesOf(requestDiscountApproval(w.salesTwo, q3.id, 1)))[0]).toMatchObject({ code: "APPROVAL_NOT_NEEDED" });
  });

  it("the requester can withdraw a waiting request; the version is closed so a new one can be made", async () => {
    const w = await withApprover();
    const quote = await discountedQuote(w);
    const item = await requestDiscountApproval(w.sales, quote.id, 1);
    await expect(cancelApproval(w.salesTwo, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelApproval(w.management, item.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await cancelApproval(w.sales, item.id)).toMatchObject({ status: "CANCELLED" });
    expect(await getQuoteVersion(w.sales, quote.id, 1)).toMatchObject({ status: "REJECTED" });
    expect((await issuesOf(cancelApproval(w.sales, item.id)))[0]).toMatchObject({ code: "ALREADY_DECIDED" });
    expect((await issuesOf(decideApproval(w.management, item.id, { approve: true })))[0]).toMatchObject({ code: "ALREADY_DECIDED" });
    expect(await createNewVersion(w.sales, quote.id)).toMatchObject({ version: 2 });
  });
});

describe("approvals: a won deal above the limit (FIG-1145)", () => {
  async function largeDealWorld() {
    const w = await withApprover();
    await updateApprovalRules(w.management, { largeDeal: { enabled: true, thresholdAmount: 100000 } });
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    return { ...w, won };
  }

  it("blocks the move with a reason; approval makes the move for the requester at once", async () => {
    const w = await largeDealWorld();
    const check = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: w.won });
    expect(check.allowed).toBe(false);
    expect(check.blockers[0]).toMatchObject({ code: "APPROVAL_REQUIRED", field: "pipelineStageId" });
    const err = await moveDeal(w.sales, w.deal.id, { pipelineStageId: w.won }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);

    const item = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: w.won, note: "Signed offline" });
    expect(item).toMatchObject({ kind: "LARGE_DEAL", status: "PENDING" });
    expect((await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: w.won })).id).toBe(item.id);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).outcome).toBe("OPEN");

    const decided = await decideApproval(w.management, item.id, { approve: true });
    expect(decided).toMatchObject({ status: "APPROVED", resumed: true });
    const after = await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } });
    expect(after).toMatchObject({ outcome: "WON", pipelineStageId: w.won });
    // The approval was spent by that move.
    expect((await adminDb.approvalRequest.findUniqueOrThrow({ where: { id: item.id } })).consumedAt).not.toBeNull();
  });

  it("a rejection leaves the deal where it is and the requester reads why; an approval is a one-use grant that expires", async () => {
    const w = await largeDealWorld();
    const item = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: w.won });
    await decideApproval(w.management, item.id, { approve: false, reason: "Contract not countersigned yet" });
    expect(await getApproval(w.sales, item.id)).toMatchObject({ status: "REJECTED", decisionReason: "Contract not countersigned yet" });
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).outcome).toBe("OPEN");
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: w.won })).blockers[0]).toMatchObject({ code: "APPROVAL_REQUIRED" });

    // A fresh request can be made after a rejection; approve it, then age the grant past its expiry before it is used.
    const second = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: w.won });
    expect(second.id).not.toBe(item.id);
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { archivedAt: new Date() } });
    const approved = await decideApproval(w.management, second.id, { approve: true });
    // The deal is archived, so the automatic move could not run: the grant is kept and the reason is recorded.
    expect(approved).toMatchObject({ status: "APPROVED", resumed: false });
    expect(approved.resumeError).toBeTruthy();
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { archivedAt: null } });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: w.won })).allowed).toBe(true);
    await adminDb.approvalRequest.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: w.won })).blockers[0]).toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect((await getApproval(w.sales, second.id)).status).toBe("EXPIRED");
  });

  it("leaves everything else alone: below the limit, other stages, a switched-off rule and V1 behaviour", async () => {
    const w = await largeDealWorld();
    const small = await dealOwnedBy(w.sales, w.company.id, "SOLUTION_PRESENTED", 50000);
    expect((await checkDealMove(w.sales, small.id, { pipelineStageId: w.won })).allowed).toBe(true);
    const negotiation = await stageIdFor(w.org.id, "NEGOTIATION");
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: negotiation })).allowed).toBe(true);
    expect((await issuesOf(requestDealMoveApproval(w.sales, small.id, { pipelineStageId: w.won })))[0]).toMatchObject({ code: "APPROVAL_NOT_NEEDED" });
    await updateApprovalRules(w.management, { largeDeal: { enabled: false } });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: w.won })).allowed).toBe(true);
    // Another salesperson cannot ask on a deal they cannot open.
    await expect(requestDealMoveApproval(w.salesTwo, w.deal.id, { pipelineStageId: w.won })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("approvals: export and erasure appear in the same inbox (FIG-1145)", () => {
  it("lists export approvals and decides them through the export service; approval starts the export for the requester", async () => {
    const w = await withApprover();
    const row = await adminDb.exportApproval.create({ data: { organizationId: w.org.id, entity: "DEAL", rowCount: 1240, reason: "Quarter review", requestedByMembershipId: w.salesTwo.membershipId } });
    const inbox = await listApprovals(w.management, { kind: "EXPORT" });
    expect(inbox.items[0]).toMatchObject({ id: row.id, source: "EXPORT", kind: "EXPORT", status: "PENDING", canDecide: true, requesterNote: "Quarter review" });
    expect((await listApprovals(w.salesTwo)).items.map((i) => i.id)).toContain(row.id);
    expect((await listApprovals(w.sales)).items.map((i) => i.id)).not.toContain(row.id);

    expect((await issuesOf(decideApproval(w.management, row.id, { approve: false })))[0]).toMatchObject({ code: "REASON_REQUIRED" });
    const decided = await decideApproval(w.managementTwo, row.id, { approve: true, reason: "Fine" });
    expect(decided).toMatchObject({ status: "APPROVED", decisionReason: "Fine" });
    expect((await adminDb.exportApproval.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("APPROVED");

    const rejectedRow = await adminDb.exportApproval.create({ data: { organizationId: w.org.id, entity: "LEAD", rowCount: 900, requestedByMembershipId: w.salesTwo.membershipId } });
    await decideApproval(w.management, rejectedRow.id, { approve: false, reason: "Use the filtered view instead" });
    expect(await getApproval(w.salesTwo, rejectedRow.id)).toMatchObject({ status: "REJECTED", decisionReason: "Use the filtered view instead" });
  });

  it("lists the second confirmation of an erasure as a deletion approval; approving erases, rejecting reopens the request", async () => {
    const w = await withApprover();
    const { contact } = await contactService.createContact(w.management, { firstName: "Peter", lastName: "Ochieng", email: "peter@savannah.example" });
    const request = await createDataSubjectRequest(w.management, { kind: "ERASURE", contactId: contact.id });
    await confirmErasure(w.management, request.id);

    const inbox = await listApprovals(w.managementTwo, { kind: "DELETION" });
    expect(inbox.items[0]).toMatchObject({ id: request.id, source: "ERASURE", kind: "DELETION", status: "PENDING", canDecide: true });
    expect((await listApprovals(w.sales)).items.some((i) => i.kind === "DELETION")).toBe(false);
    expect((await issuesOf(decideApproval(w.management, request.id, { approve: false, reason: "mine, cannot" })))[0]).toMatchObject({ code: "SELF_APPROVAL" });

    await decideApproval(w.managementTwo, request.id, { approve: false, reason: "Identity not verified" });
    expect((await adminDb.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("OPEN");
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(1);

    await confirmErasure(w.management, request.id);
    expect(await decideApproval(w.managementTwo, request.id, { approve: true })).toMatchObject({ kind: "DELETION", status: "APPROVED" });
    expect(await adminDb.contact.count({ where: { id: contact.id } })).toBe(0);
  });
});

describe("approval rules, masking, isolation and the database (FIG-1145)", () => {
  it("Management sets the rules with validation; the export threshold is the export rights threshold; deletion cannot be switched off", async () => {
    const w = await withApprover();
    const before = await getApprovalRules(w.management);
    expect(before).toMatchObject({ discount: { enabled: true, thresholdPercent: 5 }, export: { thresholdRows: 500 }, largeDeal: { enabled: false }, deletion: { locked: true } });
    await expect(updateApprovalRules(w.sales, { discount: { thresholdPercent: 10 } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getApprovalRules(w.sales)).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await issuesOf(updateApprovalRules(w.management, { discount: { thresholdPercent: 45 }, largeDeal: { thresholdAmount: -1, currency: "kes" }, deletion: { enabled: false } }));
    expect(bad.map((i) => i.code).sort()).toEqual(["INVALID_CURRENCY", "INVALID_THRESHOLD", "INVALID_THRESHOLD", "RULE_LOCKED"]);
    const after = await updateApprovalRules(w.management, { discount: { thresholdPercent: 10 }, export: { thresholdRows: 750 }, largeDeal: { enabled: true, thresholdAmount: 2_000_000 } });
    expect(after).toMatchObject({ discount: { thresholdPercent: 10 }, export: { thresholdRows: 750 }, largeDeal: { enabled: true, thresholdAmount: 2_000_000 } });
    const { loadExportRights } = await import("../src/services/privacySettings");
    expect((await loadExportRights(w.org.id)).approvalThreshold).toBe(750);
    expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, action: "approval_rules.updated" } })).toBe(1);

    // The new limit applies at once: an 8% discount no longer waits.
    const quote = await discountedQuote(w, 8);
    expect((await issuesOf(requestDiscountApproval(w.sales, quote.id, 1)))[0]).toMatchObject({ code: "APPROVAL_NOT_NEEDED" });
  });

  it("carries no money amount in any inbox row, and audits requests and decisions without one", async () => {
    const w = await withApprover();
    const dealSentinel = 7_654_321;
    const big = await adminDb.deal.update({ where: { id: w.deal.id }, data: { value: dealSentinel } });
    await updateApprovalRules(w.management, { largeDeal: { enabled: true, thresholdAmount: 100000 } });
    const won = await stageIdFor(w.org.id, "CLOSED_WON");
    const move = await requestDealMoveApproval(w.sales, big.id, { pipelineStageId: won });
    const quote = await discountedQuote(w);
    const discount = await requestDiscountApproval(w.sales, quote.id, 1);
    for (const ctx of [w.management, w.sales]) {
      const json = JSON.stringify(await listApprovals(ctx));
      expect(json).not.toContain("7654321");
      expect(json).not.toContain("7,654,321");
      expect(json).not.toContain("74000");
    }
    await decideApproval(w.management, discount.id, { approve: true });
    await decideApproval(w.managementTwo, move.id, { approve: false, reason: "Not yet signed" });
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, entityType: "ApprovalRequest" } });
    expect(audit.map((a) => a.action).sort()).toEqual(["approval.approved", "approval.rejected", "approval.requested", "approval.requested"]);
    expect(JSON.stringify(audit)).not.toContain("7654321");
  });

  it("nothing is decided without a person: a request stays pending however long it waits", async () => {
    const w = await withApprover();
    const quote = await discountedQuote(w);
    const item = await requestDiscountApproval(w.sales, quote.id, 1);
    await adminDb.approvalRequest.update({ where: { id: item.id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    expect(await getApproval(w.management, item.id)).toMatchObject({ status: "PENDING", decidedBy: null });
    expect(await getQuoteVersion(w.sales, quote.id, 1)).toMatchObject({ status: "PENDING_APPROVAL" });
  });

  it("is isolated per organisation, and the database refuses to rewrite a decision or reject without a reason", async () => {
    const a = await withApprover();
    const b = await withApprover();
    const quote = await discountedQuote(a);
    const item = await requestDiscountApproval(a.sales, quote.id, 1);
    await expect(getApproval(b.management, item.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideApproval(b.management, item.id, { approve: true })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listApprovals(b.management)).total).toBe(0);
    expect(await withOrgContext(b.org.id, (tx) => tx.approvalRequest.findMany({ where: { id: item.id } }))).toEqual([]);
    await expect(withOrgContext(b.org.id, (tx) => tx.approvalRequest.create({ data: { organizationId: a.org.id, kind: "DISCOUNT", subjectType: "X", subjectId: "y", title: "t" } }))).rejects.toThrow();

    await expect(adminDb.approvalRequest.update({ where: { id: item.id }, data: { status: "REJECTED", decidedAt: new Date(), decisionReason: "ok" } })).rejects.toThrow();
    await decideApproval(a.management, item.id, { approve: true });
    await expect(adminDb.approvalRequest.update({ where: { id: item.id }, data: { status: "REJECTED", decisionReason: "later regret" } })).rejects.toThrow(/cannot be changed/);
    await expect(adminDb.approvalRequest.update({ where: { id: item.id }, data: { decisionReason: "edited" } })).rejects.toThrow(/cannot be changed/);
    // Bookkeeping of using a grant is still allowed.
    await adminDb.approvalRequest.update({ where: { id: item.id }, data: { resumeError: "note" } });
  });
});
