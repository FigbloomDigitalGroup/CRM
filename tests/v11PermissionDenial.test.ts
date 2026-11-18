/**
 * G2.01 (FIG-1156): what the generated V1.1 matrix cannot prove, proved with valid requests.
 *
 * In tests/apiWalkV11.test.ts some cells are V (the synthesised body failed validation before the permission was judged) or H (the record
 * is hidden from that role), so they do not show that a role without the permission is refused. Here every V1.1 write that a role must not
 * make is made with a valid input, as each role that lacks the permission, against a real record the role can reach where one exists.
 * Every attempt must be refused, and nothing may change.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { createPipeline, updatePipeline, updatePipelineStage } from "../src/services/pipelineService";
import { createCatalogueEntry, updateCatalogueEntry } from "../src/services/catalogueService";
import { createSequence, deleteSequence, updateSequence } from "../src/services/followUpService";
import { createForm, updateForm } from "../src/services/webFormService";
import { askAssistant, updateAssistantSettings } from "../src/services/assistantService";
import { setTarget } from "../src/services/forecastService";
import { cancelApproval, decideApproval, updateApprovalRules } from "../src/services/approvalService";
import { createNewVersion, createQuote, updateDraftVersion, updateQuoteSettings } from "../src/services/quoteService";
import { sendQuote } from "../src/services/quoteDocumentService";
import { deleteChannel } from "../src/services/chatService";
import { buildWorldV11, type WorldV11 } from "./helpers/worldV11";

const REFUSED = ["ForbiddenError", "NotFoundError"];
const refused = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e: Error) => e);
  expect(error, "the call must be refused").not.toBeNull();
  expect(REFUSED, `refused with ${error?.name}: ${error?.message}`).toContain(error!.name);
};

describe("V1.1 writes that a role without the permission must be refused, with valid inputs (G2.01)", () => {
  let w: WorldV11;
  const nonManagers = () => [w.ctx.SALES, w.ctx.DELIVERY, w.ctx.FINANCE, w.ctx.RESTRICTED_TECHNICAL];

  beforeAll(async () => {
    w = await buildWorldV11("DenyWrites");
    expect(w.missing).toEqual([]);
  }, 300_000);

  it("keeps catalogue writes to Management", async () => {
    const before = await adminDb.catalogueItem.count({ where: { organizationId: w.organization.id } });
    for (const ctx of nonManagers()) {
      await refused(createCatalogueEntry(ctx, { name: "Planted", price: 1 }));
      await refused(updateCatalogueEntry(ctx, w.ids.itemId!, { name: "Renamed" }));
    }
    expect(await adminDb.catalogueItem.count({ where: { organizationId: w.organization.id } })).toBe(before);
    expect((await adminDb.catalogueItem.findUniqueOrThrow({ where: { id: w.ids.itemId! } })).name).not.toBe("Renamed");
  });

  it("keeps pipeline, stage and approval-rule changes, quote settings and sales targets to Management", async () => {
    for (const ctx of nonManagers()) {
      await refused(createPipeline(ctx, { name: "Planted", stages: [{ name: "One" }, { name: "Two" }] } as any));
      await refused(updatePipeline(ctx, w.ids.pipelineId!, { name: "Renamed" }));
      await refused(updatePipelineStage(ctx, w.ids.pipelineId!, w.ids.stageId!, { name: "Renamed" }));
      await refused(updateApprovalRules(ctx, { discount: { enabled: true, thresholdPercent: 5 } } as any));
      await refused(updateQuoteSettings(ctx, { validityDays: 1 }));
      await refused(setTarget(ctx, { month: "2026-12", membershipId: null, amount: 1 }));
    }
    expect(await adminDb.pipeline.count({ where: { organizationId: w.organization.id, name: { in: ["Planted", "Renamed"] } } })).toBe(0);
  });

  it("keeps sequence writes to Management, and web forms", async () => {
    for (const ctx of nonManagers()) {
      await refused(createSequence(ctx, { name: "Planted", subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "TASK", title: "x" }] }));
      await refused(updateSequence(ctx, w.ids.sequenceId!, { name: "Renamed" } as any));
      await refused(deleteSequence(ctx, w.ids.sequenceId!));
      await refused(createForm(ctx, { name: "Planted form" }));
      await refused(updateForm(ctx, w.ids.formId!, { name: "Renamed form" } as any));
    }
    expect(await adminDb.followUpSequence.count({ where: { organizationId: w.organization.id, name: { in: ["Planted", "Renamed"] } } })).toBe(0);
    expect(await adminDb.followUpSequence.count({ where: { id: w.ids.sequenceId! } })).toBe(1);
    expect(await adminDb.webForm.count({ where: { organizationId: w.organization.id, name: { in: ["Planted form", "Renamed form"] } } })).toBe(0);
  });

  it("keeps assistant settings to Management and the assistant itself away from Restricted Technical", async () => {
    for (const ctx of nonManagers()) await refused(updateAssistantSettings(ctx, { enabled: false } as any));
    await refused(askAssistant(w.ctx.RESTRICTED_TECHNICAL, w.organization.slug, { question: "What is next for this lead?" }));
  });

  it("lets only Management decide an approval, and only its requester or Management cancel it", async () => {
    const approval = await adminDb.approvalRequest.findFirstOrThrow({ where: { organizationId: w.organization.id, status: "PENDING" } });
    for (const ctx of nonManagers()) await refused(decideApproval(ctx, approval.id, { approve: true }));
    for (const ctx of [w.ctx.DELIVERY, w.ctx.FINANCE, w.ctx.RESTRICTED_TECHNICAL]) await refused(cancelApproval(ctx, approval.id));
    expect((await adminDb.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");
    // The requester (Sales) may not approve their own request either.
    await refused(decideApproval(w.ctx.SALES, approval.id, { approve: true }));
  });

  it("keeps quote writes to the roles with quotes.create, and to the deal's owner among them", async () => {
    const versions = () => adminDb.quoteVersion.count({ where: { quoteId: w.ids.quoteId! } });
    const before = await versions();
    for (const ctx of [w.ctx.DELIVERY, w.ctx.FINANCE, w.ctx.RESTRICTED_TECHNICAL]) {
      await refused(createQuote(ctx, w.ids.dealId!, { lines: [{ catalogueItemId: w.ids.itemId!, quantity: 1 }] }));
      await refused(createNewVersion(ctx, w.ids.quoteId!));
      await refused(updateDraftVersion(ctx, w.ids.quoteId!, 1, { discountPercent: 0 }));
      await refused(sendQuote(ctx, w.ids.quoteId!, 1, { recipientEmail: "buyer@example.test" } as any));
    }
    expect(await versions()).toBe(before);
  });

  it("keeps a chat channel's deletion to people who may manage channels", async () => {
    for (const ctx of [w.ctx.SALES, w.ctx.DELIVERY, w.ctx.FINANCE, w.ctx.RESTRICTED_TECHNICAL]) await refused(deleteChannel(ctx, w.ids.channelId!));
    expect(await adminDb.chatChannel.count({ where: { id: w.ids.channelId!, archivedAt: null } })).toBe(1);
  });
});
