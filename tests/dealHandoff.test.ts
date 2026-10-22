import { describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import type { MailTransport } from "../src/auth/email";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { sendDealWonHandoffEmail } from "../src/notifications/email";
import { findDealHandoff } from "../src/repositories/dealHandoffs";
import { resolveEffectivePreferences } from "../src/repositories/notificationPreferences";
import * as activityService from "../src/services/activityService";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import * as handoffService from "../src/services/handoffService";
import * as notificationService from "../src/services/notificationService";
import {
  createTestContext,
  createTestOrganization,
  getLifecycleStateId,
  getLostReasonId,
  getPipelineStageId,
  getServiceId,
} from "./helpers/fixtures";

/**
 * FIG-792: winning a deal hands it to Delivery -- company service link,
 * onboarding tasks, a DEAL_WON_HANDOFF notification, the company's
 * lifecycle state, timeline note and audit -- exactly once per deal.
 */

async function setup() {
  const org = await createTestOrganization("Handoff");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "ho.mgmt");
  const delivery = await createTestContext(org.id, "DELIVERY", "ho.delivery");
  const serviceId = await getServiceId(org.id);
  const { company } = await companyService.createCompany(mgmt, {
    name: "Handoff Co",
    lifecycleStateId: await getLifecycleStateId(org.id, "PROSPECT"),
  });
  const openStageId = await getPipelineStageId(org.id);
  const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
  const deal = await dealService.createDeal(mgmt, {
    companyId: company.id,
    pipelineStageId: openStageId,
    serviceId,
    value: 1000,
  });
  return { org, mgmt, delivery, serviceId, company, deal, openStageId, wonStageId };
}

const win = (ctx: AuthContext, dealId: string, wonStageId: string, owner?: string) =>
  dealService.updateDeal(ctx, dealId, {
    pipelineStageId: wonStageId,
    handoff: owner ? { deliveryOwnerMembershipId: owner } : undefined,
  });

describe("won-deal handoff", () => {
  it("links the service, assigns the onboarding tasks, notifies the assignee, moves the company to Customer and records it", async () => {
    const { org, mgmt, delivery, serviceId, company, deal, wonStageId } = await setup();

    await win(mgmt, deal.id, wonStageId, delivery.membershipId);

    // CompanyService link for the deal's service.
    const links = await adminDb.companyService.findMany({
      where: { organizationId: org.id, companyId: company.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ serviceId, status: "ACTIVE" });
    expect(links[0]!.startDate).not.toBeNull();

    // Onboarding tasks from the default template, assigned to Delivery and
    // linked to the deal and company.
    const tasks = await adminDb.task.findMany({
      where: { organizationId: org.id, dealId: deal.id },
      orderBy: { dueAt: "asc" },
    });
    expect(tasks.map((t) => t.title)).toEqual(
      handoffService.DEFAULT_ONBOARDING_TASKS.map((t) => t.title),
    );
    expect(tasks.every((t) => t.assigneeMembershipId === delivery.membershipId)).toBe(true);
    expect(tasks.every((t) => t.companyId === company.id)).toBe(true);
    expect(tasks.every((t) => t.createdByMembershipId === mgmt.membershipId)).toBe(true);
    const day = 24 * 3600 * 1000;
    const first = tasks[0]!.dueAt!.getTime() - Date.now();
    expect(first).toBeGreaterThan(1.5 * day);
    expect(first).toBeLessThan(2.5 * day);

    // The assignee is notified with the new type.
    const notes = await adminDb.notification.findMany({
      where: { organizationId: org.id, type: "DEAL_WON_HANDOFF" },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      membershipId: delivery.membershipId,
      entityType: "Deal",
      entityId: deal.id,
    });
    expect(notes[0]!.link).toContain(`/deals/${deal.id}`);
    const feed = await notificationService.listMyNotifications(delivery);
    expect(feed.some((n) => n.type === "DEAL_WON_HANDOFF")).toBe(true);

    // Company moves to the Customer lifecycle state.
    const refreshed = await adminDb.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(refreshed.lifecycleStateId).toBe(await getLifecycleStateId(org.id, "CUSTOMER"));

    // Visible on the deal's and the company's timelines.
    const dealTimeline = await activityService.listActivitiesForDeal(mgmt, deal.id);
    expect(dealTimeline.map((a) => a.subject)).toContain("Handed off to Delivery");
    const companyTimeline = await activityService.listActivitiesForCompany(mgmt, company.id);
    expect(companyTimeline.filter((a) => a.subject === "Handed off to Delivery")).toHaveLength(1);

    // Audited, and recorded as a handoff row.
    const audit = await adminDb.auditEvent.findFirstOrThrow({
      where: { organizationId: org.id, action: "deal.handoff_created", entityId: deal.id },
    });
    expect(audit.actorMembershipId).toBe(mgmt.membershipId);
    expect(audit.metadata).toMatchObject({
      companyService: "created",
      lifecycleStateChanged: true,
    });
    const stateAudit = await adminDb.auditEvent.findFirst({
      where: { organizationId: org.id, action: "company.lifecycle_state_changed" },
    });
    expect(stateAudit).not.toBeNull();
    const handoff = await findDealHandoff(org.id, deal.id);
    expect(handoff).toMatchObject({
      deliveryOwnerMembershipId: delivery.membershipId,
      createdByMembershipId: mgmt.membershipId,
    });
  });

  it("assigns the tasks to the deal's owner when no Delivery owner is chosen", async () => {
    const { org, mgmt, deal, wonStageId } = await setup();

    await win(mgmt, deal.id, wonStageId);

    const tasks = await adminDb.task.findMany({ where: { organizationId: org.id, dealId: deal.id } });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.assigneeMembershipId === deal.ownerMembershipId)).toBe(true);
  });

  it("creates no duplicate work when a deal is re-opened and won again", async () => {
    const { org, mgmt, delivery, company, deal, openStageId, wonStageId } = await setup();

    await win(mgmt, deal.id, wonStageId, delivery.membershipId);
    const reopened = await dealService.updateDeal(mgmt, deal.id, { pipelineStageId: openStageId });
    expect(reopened.outcome).toBe("OPEN");
    const wonAgain = await win(mgmt, deal.id, wonStageId, delivery.membershipId);
    expect(wonAgain.outcome).toBe("WON");

    const where = { organizationId: org.id };
    expect(await adminDb.task.count({ where: { ...where, dealId: deal.id } })).toBe(
      handoffService.DEFAULT_ONBOARDING_TASKS.length,
    );
    expect(await adminDb.notification.count({ where: { ...where, type: "DEAL_WON_HANDOFF" } })).toBe(1);
    expect(await adminDb.dealHandoff.count({ where: { dealId: deal.id } })).toBe(1);
    expect(await adminDb.companyService.count({ where: { ...where, companyId: company.id } })).toBe(1);
    expect(
      await adminDb.auditEvent.count({ where: { ...where, action: "deal.handoff_created" } }),
    ).toBe(1);
    const timeline = await activityService.listActivitiesForDeal(mgmt, deal.id);
    expect(timeline.filter((a) => a.subject === "Handed off to Delivery")).toHaveLength(1);
  });

  it("does nothing when a deal moves between open stages or to lost", async () => {
    const { org, mgmt, deal } = await setup();
    const negotiation = await getPipelineStageId(org.id, "NEGOTIATION");
    await dealService.updateDeal(mgmt, deal.id, { pipelineStageId: negotiation });
    await dealService.updateDeal(mgmt, deal.id, {
      pipelineStageId: await getPipelineStageId(org.id, "CLOSED_LOST"),
      lostReasonId: await getLostReasonId(org.id),
    });

    expect(await adminDb.dealHandoff.count({ where: { dealId: deal.id } })).toBe(0);
    expect(await adminDb.task.count({ where: { dealId: deal.id } })).toBe(0);
    expect(await adminDb.companyService.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("reactivates an ended service link instead of creating a second one, and leaves an active one alone", async () => {
    const ended = await setup();
    const link = await adminDb.companyService.create({
      data: {
        organizationId: ended.org.id,
        companyId: ended.company.id,
        serviceId: ended.serviceId,
        status: "COMPLETED",
        endDate: new Date("2026-01-01"),
      },
    });
    await win(ended.mgmt, ended.deal.id, ended.wonStageId);
    const links = await adminDb.companyService.findMany({
      where: { organizationId: ended.org.id, companyId: ended.company.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: link.id, status: "ACTIVE", endDate: null });

    const active = await setup();
    const existing = await adminDb.companyService.create({
      data: {
        organizationId: active.org.id,
        companyId: active.company.id,
        serviceId: active.serviceId,
        status: "ACTIVE",
        notes: "already running",
      },
    });
    await win(active.mgmt, active.deal.id, active.wonStageId);
    const after = await adminDb.companyService.findMany({
      where: { organizationId: active.org.id, companyId: active.company.id },
    });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: existing.id, notes: "already running" });
  });

  it("still hands off a deal that has no service, without creating a service link", async () => {
    const { org, mgmt, company, openStageId, wonStageId } = await setup();
    const noService = await dealService.createDeal(mgmt, {
      companyId: company.id,
      pipelineStageId: openStageId,
    });

    await win(mgmt, noService.id, wonStageId);

    expect(await adminDb.companyService.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.task.count({ where: { dealId: noService.id } })).toBeGreaterThan(0);
    const audit = await adminDb.auditEvent.findFirstOrThrow({
      where: { organizationId: org.id, action: "deal.handoff_created", entityId: noService.id },
    });
    expect(audit.metadata).toMatchObject({ companyService: "none" });
  });

  it("rejects an ineligible or foreign Delivery owner before the deal changes", async () => {
    const { org, mgmt, deal, wonStageId } = await setup();
    const finance = await createTestContext(org.id, "FINANCE", "ho.finance");
    const stranger = await createTestContext(
      (await createTestOrganization("Handoff Other")).id,
      "DELIVERY",
      "ho.stranger",
    );

    await expect(win(mgmt, deal.id, wonStageId, finance.membershipId)).rejects.toThrow(ValidationError);
    await expect(win(mgmt, deal.id, wonStageId, stranger.membershipId)).rejects.toThrow(ValidationError);

    const unchanged = await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(unchanged.outcome).toBe("OPEN");
    expect(await adminDb.dealHandoff.count({ where: { dealId: deal.id } })).toBe(0);
    expect(await adminDb.task.count({ where: { dealId: deal.id } })).toBe(0);
  });

  it("never moves a stage by itself: the deal stays on the stage the person chose", async () => {
    const { mgmt, deal, wonStageId } = await setup();
    await win(mgmt, deal.id, wonStageId);
    const after = await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(after.pipelineStageId).toBe(wonStageId);
    expect(after.outcome).toBe("WON");
  });
});

describe("handoff settings", () => {
  it("uses the organization's own onboarding template and customer state", async () => {
    const { org, mgmt, delivery, company, deal, wonStageId } = await setup();
    const activeCustomer = await getLifecycleStateId(org.id, "ACTIVE_CUSTOMER");
    await handoffService.updateHandoffSettings(mgmt, {
      tasks: [
        { title: "Send welcome pack", description: "Email and post", dueInDays: 0, priority: "LOW" },
        { title: "Book training", dueInDays: 10, priority: "HIGH" },
      ],
      customerLifecycleStateId: activeCustomer,
    });

    await win(mgmt, deal.id, wonStageId, delivery.membershipId);

    const tasks = await adminDb.task.findMany({
      where: { organizationId: org.id, dealId: deal.id },
      orderBy: { dueAt: "asc" },
    });
    expect(tasks.map((t) => t.title)).toEqual(["Send welcome pack", "Book training"]);
    expect(tasks[0]).toMatchObject({ description: "Email and post", priority: "LOW" });
    expect(tasks[1]).toMatchObject({ priority: "HIGH" });
    expect(
      (await adminDb.company.findUniqueOrThrow({ where: { id: company.id } })).lifecycleStateId,
    ).toBe(activeCustomer);
  });

  it("an empty template turns the onboarding tasks off but still hands the deal off", async () => {
    const { org, mgmt, delivery, deal, wonStageId } = await setup();
    await handoffService.updateHandoffSettings(mgmt, { tasks: [], customerLifecycleStateId: null });

    await win(mgmt, deal.id, wonStageId, delivery.membershipId);

    expect(await adminDb.task.count({ where: { dealId: deal.id } })).toBe(0);
    expect(await adminDb.dealHandoff.count({ where: { dealId: deal.id } })).toBe(1);
    expect(
      await adminDb.notification.count({ where: { organizationId: org.id, type: "DEAL_WON_HANDOFF" } }),
    ).toBe(1);
  });

  it("returns the defaults until the organization saves its own, then round-trips and audits the change", async () => {
    const { org, mgmt } = await setup();
    const defaults = await handoffService.getHandoffSettings(mgmt);
    expect(defaults.tasks).toEqual(handoffService.DEFAULT_ONBOARDING_TASKS);
    expect(defaults.customerLifecycleStateId).toBeNull();

    const saved = await handoffService.updateHandoffSettings(mgmt, {
      tasks: [{ title: "  Kick-off  ", dueInDays: 3, priority: "MEDIUM" }],
      customerLifecycleStateId: null,
    });
    expect(saved.tasks).toEqual([{ title: "Kick-off", dueInDays: 3, priority: "MEDIUM" }]);
    expect(await handoffService.getHandoffSettings(mgmt)).toEqual(saved);
    expect(
      await adminDb.auditEvent.count({
        where: { organizationId: org.id, action: "handoff_settings.updated" },
      }),
    ).toBe(1);
  });

  it("is Management-only", async () => {
    const { org } = await setup();
    const sales = await createTestContext(org.id, "SALES", "ho.sales");
    await expect(handoffService.getHandoffSettings(sales)).rejects.toThrow(ForbiddenError);
    await expect(
      handoffService.updateHandoffSettings(sales, { tasks: [], customerLifecycleStateId: null }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an invalid template or a lifecycle state from another organization", async () => {
    const { mgmt } = await setup();
    const save = (tasks: handoffService.OnboardingTaskTemplate[], stateId: string | null = null) =>
      handoffService.updateHandoffSettings(mgmt, { tasks, customerLifecycleStateId: stateId });

    await expect(save([{ title: "   ", dueInDays: 1, priority: "LOW" }])).rejects.toThrow(ValidationError);
    await expect(save([{ title: "x", dueInDays: -1, priority: "LOW" }])).rejects.toThrow(ValidationError);
    await expect(save([{ title: "x", dueInDays: 1.5, priority: "LOW" }])).rejects.toThrow(ValidationError);
    await expect(save([{ title: "x", dueInDays: 366, priority: "LOW" }])).rejects.toThrow(ValidationError);
    await expect(
      save(Array.from({ length: 21 }, (_, i) => ({ title: `t${i}`, dueInDays: 1, priority: "LOW" as const }))),
    ).rejects.toThrow(ValidationError);

    const other = await createTestOrganization("Handoff Foreign State");
    const foreignState = await getLifecycleStateId(other.id, "CUSTOMER");
    await expect(save([], foreignState)).rejects.toThrow(ValidationError);
  });
});

describe("handoff tenant isolation and notifications", () => {
  it("one organization's handoffs are invisible to another, in the query helper and under RLS", async () => {
    const { org, mgmt, deal, wonStageId } = await setup();
    await win(mgmt, deal.id, wonStageId);
    const otherOrg = await createTestOrganization("Handoff Peek");

    expect(await findDealHandoff(org.id, deal.id)).not.toBeNull();
    expect(await findDealHandoff(otherOrg.id, deal.id)).toBeNull();
    const seenFromOther = await withOrgContext(otherOrg.id, (tx) => tx.dealHandoff.findMany());
    expect(seenFromOther).toEqual([]);
    const seenFromOwn = await withOrgContext(org.id, (tx) => tx.dealHandoff.findMany());
    expect(seenFromOwn).toHaveLength(1);
  });

  it("the database refuses a handoff that points at another organization's deal or member", async () => {
    const { org, mgmt, deal } = await setup();
    const otherOrg = await createTestOrganization("Handoff FK");
    const otherMember = await createTestContext(otherOrg.id, "DELIVERY", "ho.fk");

    // Deal belongs to `org`, row claims `otherOrg`.
    await expect(
      adminDb.dealHandoff.create({
        data: {
          organizationId: otherOrg.id,
          dealId: deal.id,
          deliveryOwnerMembershipId: otherMember.membershipId,
          createdByMembershipId: otherMember.membershipId,
        },
      }),
    ).rejects.toThrow();
    // Right deal and organization, but a member of the other organization.
    await expect(
      adminDb.dealHandoff.create({
        data: {
          organizationId: org.id,
          dealId: deal.id,
          deliveryOwnerMembershipId: otherMember.membershipId,
          createdByMembershipId: mgmt.membershipId,
        },
      }),
    ).rejects.toThrow();
  });

  it("DEAL_WON_HANDOFF is a notification preference like the others, on by default", async () => {
    const { org, delivery } = await setup();
    const prefs = await resolveEffectivePreferences(org.id, delivery.membershipId);
    expect(prefs.DEAL_WON_HANDOFF).toEqual({ emailEnabled: true, inAppEnabled: true });
  });

  it("the handoff email names the deal, the task count and links to it", async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const transport = { sendMail } as unknown as MailTransport;

    await sendDealWonHandoffEmail(
      "delivery@example.test",
      { dealLabel: "Handoff Co", taskCount: 3, link: "https://crm.example.test/o/x/deals/1" },
      transport,
    );

    const message = sendMail.mock.calls[0]![0];
    expect(message.to).toBe("delivery@example.test");
    expect(message.subject).toContain("Handoff Co");
    expect(message.text).toContain("3 onboarding tasks");
    expect(message.text).toContain("https://crm.example.test/o/x/deals/1");
  });
});
