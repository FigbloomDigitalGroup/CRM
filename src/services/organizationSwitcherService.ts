import type { Session } from "@prisma/client";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { resolveActiveMembership } from "../repositories/memberships";
import { getMemberContext } from "./meContextService";
import { invalidateMeContext } from "./meContextCache";

/**
 * Multi-organisation membership and the organisation switcher (FIG-1133,
 * B6.01, design TB4). One person (one `users` row) can hold an active
 * membership in several organisations, each with its own role. The session
 * carries the ACTIVE organisation (`sessions.organization_id`); every request
 * still resolves its organisation from the URL slug and checks the caller's
 * membership in it (`resolveRequestContext`), so the switcher changes what the
 * shell opens, never what a route may read.
 *
 *   list    only the caller's own active memberships: name, slug, role. Nothing
 *           else about any organisation.
 *   switch  one atomic update of the session's organisation, then the new
 *           organisation's context (role, permissions, look, preferences,
 *           features) comes back in the same answer. A slug the caller has no
 *           active membership in answers exactly like an unknown slug (404), so
 *           the call cannot be used to find out which organisations exist.
 *           Audited in BOTH organisations, each entry naming neither the other
 *           organisation nor anything in it.
 *
 * V1 behaviour is unchanged: a person with one organisation sees a list of one,
 * and switching to it is a no-op.
 */
export interface MyOrganization {
  slug: string;
  name: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  current: boolean;
}

export async function listMyOrganizations(userId: string, currentOrganizationId: string | null): Promise<{ items: MyOrganization[]; currentSlug: string | null }> {
  const memberships = await adminDb.membership.findMany({
    where: { userId, status: "ACTIVE", organization: { status: "ACTIVE" } },
    include: { organization: { select: { id: true, slug: true, name: true } }, role: { select: { key: true, name: true } } },
    orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
  });
  // With no organisation on the session (or one that is gone) the oldest membership is current, like `getMemberContext`.
  const currentId = memberships.some((m) => m.organizationId === currentOrganizationId) ? currentOrganizationId : memberships[0]?.organizationId ?? null;
  const items = memberships.map((m) => ({
    slug: m.organization.slug,
    name: m.organization.name,
    membershipId: m.id,
    roleKey: m.role.key,
    roleName: m.role.name,
    current: m.organizationId === currentId,
  }));
  return { items, currentSlug: items.find((i) => i.current)?.slug ?? null };
}

export async function switchOrganization(input: { userId: string; session: Session | null; orgSlug: string }) {
  // The dev-session fallback has no server-side session to carry an organisation.
  if (!input.session) throw new ValidationError("Switching organisation needs a signed-in session.");
  const target = await adminDb.organization.findUnique({ where: { slug: input.orgSlug } });
  const targetMembership = target ? await resolveActiveMembership(input.userId, target.id) : null;
  if (!target || !targetMembership) throw new NotFoundError("Organization", input.orgSlug);
  if (target.status !== "ACTIVE") throw new ValidationError("That organisation is not available.");

  const previousOrganizationId = input.session.organizationId;
  let session = input.session;
  if (previousOrganizationId !== target.id) {
    // One statement: the session moves to the new organisation or stays where it was. A revoked session cannot be moved.
    const moved = await adminDb.session.updateMany({
      where: { id: input.session.id, userId: input.userId, revokedAt: null },
      data: { organizationId: target.id },
    });
    if (moved.count !== 1) throw new NotFoundError("Session", input.session.id);
    session = { ...input.session, organizationId: target.id };

    // Each organisation's history records its own side only.
    const previousMembership = previousOrganizationId ? await resolveActiveMembership(input.userId, previousOrganizationId) : null;
    if (previousMembership) {
      await recordAuditEvent({
        organizationId: previousOrganizationId!,
        actorMembershipId: previousMembership.membershipId,
        actorUserId: input.userId,
        action: "auth.org_switched",
        entityType: "User",
        entityId: input.userId,
        metadata: { direction: "left" },
      });
    }
    await recordAuditEvent({
      organizationId: target.id,
      actorMembershipId: targetMembership.membershipId,
      actorUserId: input.userId,
      action: "auth.org_switched",
      entityType: "User",
      entityId: input.userId,
      metadata: { direction: "entered" },
    });
    invalidateMeContext({ userId: input.userId });
  }

  return getMemberContext({ userId: input.userId, session, orgSlug: target.slug });
}
