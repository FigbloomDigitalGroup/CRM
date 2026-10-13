import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import * as ruleService from "../src/services/websiteLeadAssignmentRuleService";
import {
  createTestContext,
  createTestOrganization,
  getLeadSourceId,
  getServiceId,
} from "./helpers/fixtures";

const {
  listAssignmentRules,
  createAssignmentRule,
  updateAssignmentRule,
  setAssignmentRuleActive,
  reorderAssignmentRule,
} = ruleService;

describe("websiteLeadAssignmentRuleService", () => {
  it("rejects every mutation (and the listing) for a role without configuration.manage", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const leadSourceId = await getLeadSourceId(org.id);
    const rep = await createTestContext(org.id, "SALES", "rep");

    await expect(listAssignmentRules(ctx)).rejects.toThrow(ForbiddenError);
    await expect(
      createAssignmentRule(ctx, {
        name: "Website -> rep",
        leadSourceId,
        assigneeMembershipId: rep.membershipId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates a rule, sorts it after every existing one, and lists it back", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadSourceId = await getLeadSourceId(org.id);
    const rep = await createTestContext(org.id, "SALES", "rep");

    const created = await createAssignmentRule(ctx, {
      name: "Website -> Rep",
      leadSourceId,
      assigneeMembershipId: rep.membershipId,
    });
    expect(created.leadSourceId).toBe(leadSourceId);
    expect(created.assigneeMembershipId).toBe(rep.membershipId);
    expect(created.assigneeMembershipIds).toEqual([]);
    expect(created.isActive).toBe(true);

    const all = await listAssignmentRules(ctx);
    expect(all[all.length - 1]!.id).toBe(created.id);
  });

  it("creates a round-robin-group rule from a list of membership ids", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const serviceId = await getServiceId(org.id);
    const rep1 = await createTestContext(org.id, "SALES", "rep1");
    const rep2 = await createTestContext(org.id, "SALES", "rep2");

    const created = await createAssignmentRule(ctx, {
      name: "CRM leads -> sales pool",
      serviceId,
      assigneeMembershipIds: [rep1.membershipId, rep2.membershipId],
    });
    expect(created.assigneeMembershipId).toBeNull();
    expect(new Set(created.assigneeMembershipIds)).toEqual(
      new Set([rep1.membershipId, rep2.membershipId]),
    );
  });

  it("rejects a rule with neither lead source nor service set", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const rep = await createTestContext(org.id, "SALES", "rep");

    await expect(
      createAssignmentRule(ctx, { name: "Catch-all", assigneeMembershipId: rep.membershipId }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a rule with both a specific assignee and a round-robin group", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadSourceId = await getLeadSourceId(org.id);
    const rep1 = await createTestContext(org.id, "SALES", "rep1");
    const rep2 = await createTestContext(org.id, "SALES", "rep2");

    await expect(
      createAssignmentRule(ctx, {
        name: "Both",
        leadSourceId,
        assigneeMembershipId: rep1.membershipId,
        assigneeMembershipIds: [rep2.membershipId],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a rule with neither a specific assignee nor a round-robin group", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadSourceId = await getLeadSourceId(org.id);

    await expect(
      createAssignmentRule(ctx, { name: "Nobody", leadSourceId }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a lead source, service, or member id that doesn't belong to this organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctx = await createTestContext(orgA.id, "MANAGEMENT");
    const leadSourceIdFromOtherOrg = await getLeadSourceId(orgB.id);
    const repFromOtherOrg = await createTestContext(orgB.id, "SALES", "rep");

    await expect(
      createAssignmentRule(ctx, {
        name: "Cross-tenant source",
        leadSourceId: leadSourceIdFromOtherOrg,
        assigneeMembershipId: (await createTestContext(orgA.id, "SALES", "rep")).membershipId,
      }),
    ).rejects.toThrow(ValidationError);

    const leadSourceId = await getLeadSourceId(orgA.id);
    await expect(
      createAssignmentRule(ctx, {
        name: "Cross-tenant assignee",
        leadSourceId,
        assigneeMembershipId: repFromOtherOrg.membershipId,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("updates a rule's match and assignee", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadSourceId = await getLeadSourceId(org.id);
    const serviceId = await getServiceId(org.id);
    const rep1 = await createTestContext(org.id, "SALES", "rep1");
    const rep2 = await createTestContext(org.id, "SALES", "rep2");

    const created = await createAssignmentRule(ctx, {
      name: "Original",
      leadSourceId,
      assigneeMembershipId: rep1.membershipId,
    });

    const updated = await updateAssignmentRule(ctx, created.id, {
      name: "Renamed",
      serviceId,
      assigneeMembershipId: rep2.membershipId,
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.leadSourceId).toBeNull();
    expect(updated.serviceId).toBe(serviceId);
    expect(updated.assigneeMembershipId).toBe(rep2.membershipId);
  });

  it("404s updating/disabling/reordering a rule id that doesn't exist", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      updateAssignmentRule(ctx, "00000000-0000-0000-0000-000000000000", { name: "x" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      setAssignmentRuleActive(ctx, "00000000-0000-0000-0000-000000000000", false),
    ).rejects.toThrow(NotFoundError);
    await expect(
      reorderAssignmentRule(ctx, "00000000-0000-0000-0000-000000000000", "up"),
    ).rejects.toThrow(NotFoundError);
  });

  it("disables and re-enables a rule without touching its match/assignee", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadSourceId = await getLeadSourceId(org.id);
    const rep = await createTestContext(org.id, "SALES", "rep");

    const created = await createAssignmentRule(ctx, {
      name: "Toggle me",
      leadSourceId,
      assigneeMembershipId: rep.membershipId,
    });

    const disabled = await setAssignmentRuleActive(ctx, created.id, false);
    expect(disabled.isActive).toBe(false);
    expect(disabled.leadSourceId).toBe(leadSourceId);

    const reenabled = await setAssignmentRuleActive(ctx, created.id, true);
    expect(reenabled.isActive).toBe(true);
  });

  it("reorders rules, swapping sequence with the adjacent neighbor", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadSourceId = await getLeadSourceId(org.id);
    const rep = await createTestContext(org.id, "SALES", "rep");

    const first = await createAssignmentRule(ctx, {
      name: "First",
      leadSourceId,
      assigneeMembershipId: rep.membershipId,
    });
    const second = await createAssignmentRule(ctx, {
      name: "Second",
      leadSourceId,
      assigneeMembershipId: rep.membershipId,
    });

    await reorderAssignmentRule(ctx, second.id, "up");

    const all = await listAssignmentRules(ctx);
    const ids = all.map((r) => r.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });
});
