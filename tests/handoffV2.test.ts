import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import {
  getHandoffView,
  listHandoffs,
  takeHandoff,
  updateHandoff,
  updateHandoffSettings,
} from "../src/services/handoffService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

async function setup() {
  const org = await createTestOrganization("HandoffV2");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "sales");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const delivery = await createTestContext(org.id, "DELIVERY", "d1");
  const delivery2 = await createTestContext(org.id, "DELIVERY", "d2");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const wonStage = await getPipelineStageId(org.id, "CLOSED_WON");
  const openStage = await getPipelineStageId(org.id);
  const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: org.id, key: "CCTV" } });

  const newDeal = async (value = 250000) => {
    const { company } = await companyService.createCompany(management, { name: `Handoff Co ${Math.random().toString(36).slice(2, 7)}` });
    const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: openStage, serviceId: service.id, value });
    return { company, deal };
  };
  const win = (dealId: string, handoff?: Parameters<typeof dealService.updateDeal>[2]["handoff"]) =>
    dealService.updateDeal(management, dealId, { pipelineStageId: wonStage, handoff });
  const notificationsFor = (membershipId: string) => adminDb.notification.findMany({ where: { organizationId: org.id, membershipId, type: "DEAL_WON_HANDOFF" }, orderBy: { createdAt: "asc" } });
  return { org, management, sales, otherSales, delivery, delivery2, technical, openStage, newDeal, win, notificationsFor, service };
}

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("handoff dialog options (FIG-1037, B2.08)", () => {
  it("with an owner: Onboarding at once, the dialog fields are kept, the owner and Management are told", async () => {
    const { org, management, delivery, newDeal, win, notificationsFor } = await setup();
    const { deal } = await newDeal();
    await win(deal.id, {
      deliveryOwnerMembershipId: delivery.membershipId,
      startDate: "2026-11-30",
      scope: "Install 8 cameras at the Westlands office",
      requirements: "Needs a site visit first",
      deliverables: ["Site survey", "Camera installation"],
      teamMembershipIds: [management.membershipId],
    });

    const view = await getHandoffView(delivery, deal.id);
    expect(view.handoff).toMatchObject({
      status: "ONBOARDING",
      scope: "Install 8 cameras at the Westlands office",
      requirements: "Needs a site visit first",
      deliverables: [{ title: "Site survey", done: false }, { title: "Camera installation", done: false }],
    });
    expect(view.handoff!.deliveryOwner?.membershipId).toBe(delivery.membershipId);
    expect(view.handoff!.team.map((t) => t.membershipId)).toEqual([management.membershipId]);
    expect(new Date(view.handoff!.startDate as Date).toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(view.handoff!.tasks.length).toBe(3);

    expect((await notificationsFor(delivery.membershipId)).length).toBe(1);
    expect((await notificationsFor(management.membershipId)).length).toBe(0); // the actor is not notified about their own action
    void org;
  });

  it("owner later: Awaiting owner, no tasks yet, Delivery and Management are told; then one person takes it and the tasks are created for them once", async () => {
    const { org, sales, management, delivery, delivery2, newDeal, win, notificationsFor } = await setup();
    const { deal, company } = await newDeal();
    // A salesperson wins their own deal and leaves the owner for later.
    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true } });

    const before = await getHandoffView(delivery, deal.id);
    expect(before.handoff).toMatchObject({ status: "AWAITING_OWNER", deliveryOwner: null });
    expect(before.handoff!.tasks).toEqual([]);
    expect(before.handoff!.can).toMatchObject({ take: true, edit: false, markDelivered: false });
    expect((await notificationsFor(delivery.membershipId))[0]!.title).toMatch(/needs a Delivery owner/);
    expect((await notificationsFor(delivery2.membershipId)).length).toBe(1);
    expect((await notificationsFor(management.membershipId)).map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringMatching(/handed off/)]));
    void win;

    const taken = await takeHandoff(delivery, deal.id);
    expect(taken.handoff).toMatchObject({ status: "ONBOARDING" });
    expect(taken.handoff!.deliveryOwner?.membershipId).toBe(delivery.membershipId);
    expect(taken.handoff!.tasks.length).toBe(3);
    expect(await adminDb.task.count({ where: { dealId: deal.id, assigneeMembershipId: delivery.membershipId } })).toBe(3);

    await expect(takeHandoff(delivery2, deal.id)).rejects.toThrow(/already has an owner/);
    expect(await adminDb.task.count({ where: { dealId: deal.id } })).toBe(3);
    const notes = await adminDb.activity.findMany({ where: { dealId: deal.id, companyId: company.id }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.subject)).toEqual(["Handed off to Delivery", "Delivery owner took the handoff"]);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: deal.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["deal.handoff_created", "deal.handoff_taken"]));
  });

  it("two people taking an ownerless handoff at once: exactly one gets it, and the tasks exist once", async () => {
    const { org, sales, delivery, delivery2, newDeal } = await setup();
    const { deal } = await newDeal();
    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true } });

    const results = await Promise.allSettled([takeHandoff(delivery, deal.id), takeHandoff(delivery2, deal.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const handoff = await adminDb.dealHandoff.findFirstOrThrow({ where: { dealId: deal.id } });
    expect([delivery.membershipId, delivery2.membershipId]).toContain(handoff.deliveryOwnerMembershipId);
    expect(await adminDb.task.count({ where: { dealId: deal.id } })).toBe(3);
  });

  it("template off creates no tasks, now or when someone takes it; lifecycle off leaves the company state alone", async () => {
    const { org, sales, delivery, newDeal } = await setup();
    const { deal, company } = await newDeal();
    const before = (await adminDb.company.findUniqueOrThrow({ where: { id: company.id } })).lifecycleStateId;
    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true, templateOff: true, lifecycleOff: true } });

    expect((await adminDb.company.findUniqueOrThrow({ where: { id: company.id } })).lifecycleStateId).toBe(before);
    await takeHandoff(delivery, deal.id);
    expect(await adminDb.task.count({ where: { dealId: deal.id } })).toBe(0);
  });

  it("only people in Delivery with handoff.manage can take; Sales cannot", async () => {
    const { org, sales, otherSales, newDeal } = await setup();
    const { deal } = await newDeal();
    await dealService.updateDeal(sales, deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true } });
    await expect(takeHandoff(otherSales, deal.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(takeHandoff(sales, deal.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates the dialog: dates, lengths, deliverables and team members", async () => {
    const { win, newDeal, otherSales, org } = await setup();
    const bad = async (handoff: Parameters<typeof win>[1]) => {
      const { deal } = await newDeal();
      return issuesOf(win(deal.id, handoff));
    };
    expect((await bad({ startDate: "soon" }))[0]).toMatchObject({ path: "startDate" });
    expect((await bad({ scope: "x".repeat(5001) }))[0]).toMatchObject({ path: "scope" });
    expect((await bad({ deliverables: Array.from({ length: 31 }, (_, i) => `d${i}`) }))[0]).toMatchObject({ path: "deliverables" });
    expect((await bad({ deliverables: ["  "] }))[0]).toMatchObject({ path: "deliverables.0" });
    expect((await bad({ teamMembershipIds: ["00000000-0000-0000-0000-000000000000"] }))[0]).toMatchObject({ path: "teamMembershipIds" });
    void otherSales;
    void org;
  });
});

describe("Delivery receiving (FIG-1037, B2.08)", () => {
  it("the owner updates scope and deliverables; a Delivery colleague who is not the owner cannot; Management can", async () => {
    const { management, delivery, delivery2, newDeal, win } = await setup();
    const { deal } = await newDeal();
    await win(deal.id, { deliveryOwnerMembershipId: delivery.membershipId, deliverables: ["Survey", "Install"] });

    const updated = await updateHandoff(delivery, deal.id, {
      scope: "Revised scope",
      deliverables: [{ title: "Survey", done: true }, { title: "Install", done: false }],
      teamMembershipIds: [delivery2.membershipId],
    });
    expect(updated.handoff).toMatchObject({ scope: "Revised scope", deliverables: [{ title: "Survey", done: true }, { title: "Install", done: false }] });
    expect(updated.handoff!.team.map((t) => t.membershipId)).toEqual([delivery2.membershipId]);

    await expect(updateHandoff(delivery2, deal.id, { scope: "Hijack" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateHandoff(management, deal.id, { scope: "Management edit" })).resolves.toBeDefined();
  });

  it("marking Delivered: the owner can; it moves the company to Active Customer, notes both timelines and tells Management; a delivered handoff is read-only until Management reopens it", async () => {
    const { org, management, delivery, newDeal, win, notificationsFor } = await setup();
    const { deal, company } = await newDeal();
    await win(deal.id, { deliveryOwnerMembershipId: delivery.membershipId });

    const done = await updateHandoff(delivery, deal.id, { status: "DELIVERED" });
    expect(done.handoff).toMatchObject({ status: "DELIVERED" });
    expect(done.handoff!.deliveredBy?.membershipId).toBe(delivery.membershipId);
    const active = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: org.id, key: "ACTIVE_CUSTOMER" } });
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: company.id } })).lifecycleStateId).toBe(active.id);
    expect((await adminDb.activity.findMany({ where: { dealId: deal.id } })).map((a) => a.subject)).toContain("Delivered");
    expect((await notificationsFor(management.membershipId)).map((n) => n.title)).toEqual(expect.arrayContaining([expect.stringMatching(/Delivered:/)]));

    expect((await issuesOf(updateHandoff(delivery, deal.id, { scope: "Too late" }))).length).toBe(1);
    await expect(updateHandoff(delivery, deal.id, { status: "ONBOARDING" })).rejects.toBeInstanceOf(ForbiddenError);
    const reopened = await updateHandoff(management, deal.id, { status: "ONBOARDING" });
    expect(reopened.handoff).toMatchObject({ status: "ONBOARDING", deliveredAt: null });
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: deal.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["deal.handoff_delivered", "deal.handoff_reopened"]));
  });

  it("Management may mark Delivered by default; the organisation can restrict it to the owner; an ownerless handoff cannot be delivered", async () => {
    const { org, management, sales, delivery, newDeal, win } = await setup();
    const a = await newDeal();
    await win(a.deal.id, { deliveryOwnerMembershipId: delivery.membershipId });
    await expect(updateHandoff(management, a.deal.id, { status: "DELIVERED" })).resolves.toBeDefined();

    await updateHandoffSettings(management, { tasks: [], customerLifecycleStateId: null, managementCanMarkDelivered: false });
    const b = await newDeal();
    await win(b.deal.id, { deliveryOwnerMembershipId: delivery.membershipId });
    expect((await issuesOf(updateHandoff(management, b.deal.id, { status: "DELIVERED" })))[0]).toMatchObject({ code: "HANDOFF_DELIVER_NOT_ALLOWED" });
    expect((await getHandoffView(management, b.deal.id)).handoff!.can.markDelivered).toBe(false);
    await expect(updateHandoff(delivery, b.deal.id, { status: "DELIVERED" })).resolves.toBeDefined();

    const c = await newDeal();
    await dealService.updateDeal(sales, c.deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true } });
    expect((await issuesOf(updateHandoff(management, c.deal.id, { status: "DELIVERED" })))[0]).toMatchObject({ code: "HANDOFF_NEEDS_OWNER" });
  });

  it("Delivery sees a handoff only once the deal is won, and never the deal value; Sales sees their own deal's handoff; Technical sees none", async () => {
    const { delivery, sales, otherSales, technical, newDeal, win } = await setup();
    const open = await newDeal();
    await expect(getHandoffView(delivery, open.deal.id)).rejects.toBeInstanceOf(NotFoundError);

    const { deal } = await newDeal(987654);
    await win(deal.id, { deliveryOwnerMembershipId: delivery.membershipId });
    const asDelivery = JSON.stringify(await getHandoffView(delivery, deal.id));
    expect(asDelivery).not.toMatch(/987654/);
    expect(asDelivery).toContain("Handoff Co");
    expect((await getHandoffView(sales, deal.id)).handoff).not.toBeNull();
    await expect(getHandoffView(otherSales, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getHandoffView(technical, deal.id)).rejects.toThrow();
    expect((await getHandoffView(sales, open.deal.id)).handoff).toBeNull(); // an open deal has none yet
  });

  it("the Delivery Handoffs list: status counts, the pool to take from, mine, and each role's scope", async () => {
    const { org, sales, otherSales, management, delivery, delivery2, newDeal, win } = await setup();
    const a = await newDeal();
    const b = await newDeal();
    const c = await newDeal();
    await win(a.deal.id, { deliveryOwnerMembershipId: delivery.membershipId });
    await dealService.updateDeal(sales, b.deal.id, { pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"), handoff: { ownerLater: true } });
    await win(c.deal.id, { deliveryOwnerMembershipId: delivery2.membershipId });
    await updateHandoff(delivery2, c.deal.id, { status: "DELIVERED" });

    const all = await listHandoffs(delivery);
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({ ONBOARDING: 1, AWAITING_OWNER: 1, DELIVERED: 1 });
    expect((await listHandoffs(delivery, { status: "AWAITING_OWNER" })).items.map((h) => h.dealId)).toEqual([b.deal.id]);
    expect((await listHandoffs(delivery, { mine: true })).items.map((h) => h.dealId)).toEqual([a.deal.id]);
    expect((await listHandoffs(management)).total).toBe(3);
    // A salesperson sees handoffs of their own deals only.
    expect((await listHandoffs(sales)).total).toBe(3);
    expect((await listHandoffs(otherSales)).total).toBe(0);
    await expect(listHandoffs(delivery, { status: "BOGUS" })).rejects.toBeInstanceOf(ValidationError);
    expect(JSON.stringify(all)).not.toMatch(/"value"/);
  });

  it("another organisation sees none of it", async () => {
    const one = await setup();
    const two = await setup();
    const { deal } = await one.newDeal();
    await one.win(deal.id, { deliveryOwnerMembershipId: one.delivery.membershipId });
    await expect(getHandoffView(two.delivery, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(takeHandoff(two.delivery, deal.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listHandoffs(two.delivery)).total).toBe(0);
  });
});
