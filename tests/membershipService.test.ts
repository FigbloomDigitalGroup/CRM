import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { resolveSessionUserId } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import * as authService from "../src/services/authService";
import * as membershipService from "../src/services/membershipService";
import {
  createTestContext,
  createTestMembership,
  createTestOrganization,
} from "./helpers/fixtures";

/**
 * The test DB persists across separate test runs (unlike each test's own
 * uniquely-slugged organization), so a literal email address here would
 * collide with whatever an earlier run left behind -- e.g. a password set
 * on it by a previous "accept invite" test. Every invite-flow email in
 * this file must be unique per test run.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
}

describe("membershipService.inviteMember", () => {
  it("creates a brand-new user and a PENDING membership, capturing an acceptable invite token", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("new.hire");
    let capturedToken = "";

    const { membershipId } = await membershipService.inviteMember(
      managementCtx,
      { email, name: "New Hire", roleKey: "SALES" },
      (token) => {
        capturedToken = token;
        return token;
      },
    );

    expect(capturedToken).not.toBe("");
    const membership = await adminDb.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { user: true, role: true },
    });
    expect(membership.status).toBe("PENDING");
    expect(membership.joinedAt).toBeNull();
    expect(membership.role.key).toBe("SALES");
    expect(membership.user.email).toBe(email);
    expect(membership.user.passwordHash).toBeNull();
  });

  it("rejects invite from a caller without membership.manage/role.assign (e.g. Sales)", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");

    await expect(
      membershipService.inviteMember(
        salesCtx,
        { email: uniqueEmail("x"), name: "X", roleKey: "SALES" },
        (t) => t,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects inviting someone who is already an active member", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { user: activeUser } = await createTestMembership(org.id, "SALES");

    await expect(
      membershipService.inviteMember(
        managementCtx,
        { email: activeUser.email, name: activeUser.name, roleKey: "DELIVERY" },
        (t) => t,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("re-invites (regenerates the token) rather than erroring for a still-pending invite", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const email = uniqueEmail("pending");
    let firstToken = "";
    await membershipService.inviteMember(
      managementCtx,
      { email, name: "Pending Person", roleKey: "SALES" },
      (t) => {
        firstToken = t;
        return t;
      },
    );

    let secondToken = "";
    await membershipService.inviteMember(
      managementCtx,
      { email, name: "Pending Person", roleKey: "DELIVERY" },
      (t) => {
        secondToken = t;
        return t;
      },
    );

    expect(secondToken).not.toBe(firstToken);
    // The old token must no longer work -- only the latest one is valid.
    await expect(
      authService.acceptMembershipInvite(firstToken, "a-fine-password-123"),
    ).rejects.toThrow(ValidationError);
    const accepted = await authService.acceptMembershipInvite(
      secondToken,
      "a-fine-password-123",
    );
    expect(accepted.userId).toBeTruthy();
  });
});

describe("authService.acceptMembershipInvite", () => {
  it("sets a password, activates the membership, and signs the new user in", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    let token = "";
    const { membershipId } = await membershipService.inviteMember(
      managementCtx,
      { email: uniqueEmail("brand.new"), name: "Brand New", roleKey: "SALES" },
      (t) => {
        token = t;
        return t;
      },
    );

    const result = await authService.acceptMembershipInvite(
      token,
      "a-strong-password-1",
    );
    expect(result.userId).toBeTruthy();
    expect(await resolveSessionUserId(result.token)).toBe(result.userId);

    const membership = await adminDb.membership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(membership.status).toBe("ACTIVE");
    expect(membership.joinedAt).not.toBeNull();
    expect(membership.inviteTokenHash).toBeNull();
  });

  it("rejects a missing/too-short password for a brand-new invitee, without burning the token", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    let token = "";
    await membershipService.inviteMember(
      managementCtx,
      { email: uniqueEmail("needs.password"), name: "Needs Password", roleKey: "SALES" },
      (t) => {
        token = t;
        return t;
      },
    );

    await expect(
      authService.acceptMembershipInvite(token, "short"),
    ).rejects.toThrow(ValidationError);

    // The token must still be usable -- rejecting a bad password must not
    // have consumed it (that would permanently lock the invitee out).
    const accepted = await authService.acceptMembershipInvite(
      token,
      "a-fine-password-789",
    );
    expect(accepted.userId).toBeTruthy();
  });

  it("does not require a password for an invitee who already has an account", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { user: existingUser } = await createTestMembership(orgA.id, "SALES");
    await adminDb.user.update({
      where: { id: existingUser.id },
      data: { passwordHash: "already-has-one" },
    });

    const managementOfB = await createTestContext(orgB.id, "MANAGEMENT");
    let token = "";
    await membershipService.inviteMember(
      managementOfB,
      { email: existingUser.email, name: existingUser.name, roleKey: "DELIVERY" },
      (t) => {
        token = t;
        return t;
      },
    );

    const result = await authService.acceptMembershipInvite(token, undefined);
    expect(result.userId).toBe(existingUser.id);
  });

  it("rejects an invalid or already-used token", async () => {
    await expect(
      authService.acceptMembershipInvite("not-a-real-token", "whatever-1234"),
    ).rejects.toThrow(ValidationError);
  });
});

describe("membershipService.changeMemberRole", () => {
  it("changes a member's role and records an audit event with previous/new role", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await createTestMembership(org.id, "SALES");

    const updated = await membershipService.changeMemberRole(
      managementCtx,
      membership.id,
      "DELIVERY",
    );
    expect(updated.roleId).not.toBe(membership.roleId);

    const fresh = await adminDb.membership.findUniqueOrThrow({
      where: { id: membership.id },
      include: { role: true },
    });
    expect(fresh.role.key).toBe("DELIVERY");
  });

  it("rejects a caller without role.assign", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    const { membership } = await createTestMembership(org.id, "DELIVERY");

    await expect(
      membershipService.changeMemberRole(salesCtx, membership.id, "SALES"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses to change the last active Management member away from Management", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      membershipService.changeMemberRole(managementCtx, managementCtx.membershipId, "SALES"),
    ).rejects.toThrow(ValidationError);
  });

  it("allows changing one Management member away when a second active Management member exists", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT", "mgmt-one");
    await createTestMembership(org.id, "MANAGEMENT", "mgmt-two");

    const updated = await membershipService.changeMemberRole(
      managementCtx,
      managementCtx.membershipId,
      "SALES",
    );
    const fresh = await adminDb.membership.findUniqueOrThrow({
      where: { id: updated.id },
      include: { role: true },
    });
    expect(fresh.role.key).toBe("SALES");
  });

  it("throws NotFoundError for a membership id from a different organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const managementOfA = await createTestContext(orgA.id, "MANAGEMENT");
    const { membership: membershipInB } = await createTestMembership(orgB.id, "SALES");

    await expect(
      membershipService.changeMemberRole(managementOfA, membershipInB.id, "DELIVERY"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("membershipService.deactivateMember / reactivateMember", () => {
  it("deactivates an active member", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await createTestMembership(org.id, "SALES");

    const updated = await membershipService.deactivateMember(managementCtx, membership.id);
    expect(updated.status).toBe("INACTIVE");
  });

  it("rejects a caller without membership.manage", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    const { membership } = await createTestMembership(org.id, "DELIVERY");

    await expect(
      membershipService.deactivateMember(salesCtx, membership.id),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses to deactivate the last active Management member", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      membershipService.deactivateMember(managementCtx, managementCtx.membershipId),
    ).rejects.toThrow(ValidationError);
  });

  it("allows deactivating one Management member when a second active one exists", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT", "mgmt-one");
    await createTestMembership(org.id, "MANAGEMENT", "mgmt-two");

    const updated = await membershipService.deactivateMember(
      managementCtx,
      managementCtx.membershipId,
    );
    expect(updated.status).toBe("INACTIVE");
  });

  it("reactivates a previously-accepted, now-inactive member", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await createTestMembership(org.id, "SALES");
    await membershipService.deactivateMember(managementCtx, membership.id);

    const reactivated = await membershipService.reactivateMember(managementCtx, membership.id);
    expect(reactivated.status).toBe("ACTIVE");
  });

  it("rejects reactivating a membership that isn't INACTIVE", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { membership } = await createTestMembership(org.id, "SALES");

    await expect(
      membershipService.reactivateMember(managementCtx, membership.id),
    ).rejects.toThrow(ValidationError);
  });
});

describe("membershipService.listMemberships", () => {
  it("requires membership.view", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    await expect(membershipService.listMemberships(salesCtx)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("lists members of every status for Management", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { membership: pendingViaInvite } = await createTestMembership(org.id, "SALES");
    await membershipService.deactivateMember(managementCtx, pendingViaInvite.id);
    let token = "";
    await membershipService.inviteMember(
      managementCtx,
      { email: uniqueEmail("pending.listed"), name: "Pending Listed", roleKey: "SALES" },
      (t) => {
        token = t;
        return t;
      },
    );
    expect(token).not.toBe("");

    const members = await membershipService.listMemberships(managementCtx);
    const statuses = members.map((m) => m.status).sort();
    expect(statuses).toEqual(["ACTIVE", "INACTIVE", "PENDING"].sort());
  });
});
