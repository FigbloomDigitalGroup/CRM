import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { effectivePermissionKeys } from "../auth/permissions";
import { withOrgContext } from "../db/orgScopedClient";
import { loadFeatureConfig } from "../lib/featureConfig";
import { ADMIN_RESERVED_KEYS, isReservedKey, reservedReason, validatePermissionKeys } from "../lib/roleLimits";
import { PERMISSIONS, PERMISSION_IMPLICATIONS } from "../../prisma/seedData";
import { recordAuditEvent } from "../repositories/auditEvents";
import { invalidateMeContext } from "./meContextCache";

/**
 * Per-member permission overrides (UC-C5 step 3, FIG-1790, docs/MEMBER_ACCESS_OVERRIDES.md). Management adds (GRANT) or removes (DENY)
 * single permission keys for one member on top of the member's role. Resolution lives in `effectivePermissionKeys`; this file is the
 * rules for what may be saved: the same "grantable key" limits as custom roles, a grantor can only hand out keys they hold, nobody edits
 * their own access, and the Management role keeps the keys that run the organisation.
 */

const ASSIGN_ROLE = "role.assign";
const KNOWN = new Set(PERMISSIONS.map((p) => p.key));

export interface MemberAccessView {
  membershipId: string;
  roleKey: string;
  /** The keys the member's role gives (before overrides, release and departures). */
  roleKeys: string[];
  grant: string[];
  deny: string[];
  /** What the member can do now: role keys plus grants minus denies, after the organisation's release and departures. */
  effectiveKeys: string[];
}

export interface MemberAccessInput {
  grant: string[];
  deny: string[];
}

function bad(message: string, issues: ValidationIssue[]): ValidationError {
  return new ValidationError(message, issues);
}

async function loadTarget(ctx: AuthContext, membershipId: string) {
  const row = await withOrgContext(ctx.organizationId, (tx) =>
    tx.membership.findFirst({
      where: { id: membershipId, organizationId: ctx.organizationId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    }),
  );
  if (!row) throw new NotFoundError("Membership", membershipId);
  return row;
}

async function overridesOf(ctx: AuthContext, membershipId: string) {
  const rows = await withOrgContext(ctx.organizationId, (tx) => tx.membershipPermissionOverride.findMany({ where: { membershipId } }));
  return {
    grant: rows.filter((r) => r.effect === "GRANT").map((r) => r.permissionKey).sort(),
    deny: rows.filter((r) => r.effect === "DENY").map((r) => r.permissionKey).sort(),
  };
}

async function view(ctx: AuthContext, target: Awaited<ReturnType<typeof loadTarget>>): Promise<MemberAccessView> {
  const { grant, deny } = await overridesOf(ctx, target.id);
  const roleKeys = target.role.rolePermissions.map((rp) => rp.permission.key).sort();
  const config = await loadFeatureConfig(ctx.organizationId);
  return {
    membershipId: target.id,
    roleKey: target.role.key,
    roleKeys,
    grant,
    deny,
    effectiveKeys: effectivePermissionKeys({
      roleKey: target.role.key,
      catalogueKeys: roleKeys,
      config,
      custom: target.role.organizationId !== null,
      overrides: { grant: grant.filter((k) => !isReservedKey(k)), deny },
    }),
  };
}

export async function getMemberAccess(ctx: AuthContext, membershipId: string): Promise<MemberAccessView> {
  requirePermission(ctx, ASSIGN_ROLE);
  return view(ctx, await loadTarget(ctx, membershipId));
}

function viewIssues(keys: Set<string>) {
  return validatePermissionKeys([...keys]).filter((i) => i.code === "MISSING_VIEW_PERMISSION");
}

export async function setMemberAccess(ctx: AuthContext, membershipId: string, input: MemberAccessInput): Promise<MemberAccessView> {
  requirePermission(ctx, ASSIGN_ROLE);
  const target = await loadTarget(ctx, membershipId);
  const grant = [...new Set(input.grant)].sort();
  const deny = [...new Set(input.deny)].sort();

  if (target.id === ctx.membershipId) {
    throw bad("You cannot change your own access.", [{ path: "membershipId", message: "Ask another Management member to change your access.", code: "OWN_ACCESS" }]);
  }

  const issues: ValidationIssue[] = [];
  const roleKeys = new Set(target.role.rolePermissions.map((rp) => rp.permission.key));
  for (const key of grant) {
    if (isReservedKey(key)) issues.push({ path: "grant", message: `"${key}" cannot be added for a member. ${reservedReason(key)}`, code: "RESERVED_PERMISSION" });
    else if (!KNOWN.has(key)) issues.push({ path: "grant", message: `"${key}" is not a permission.`, code: "UNKNOWN_PERMISSION" });
    else if (!hasPermission(ctx, key)) issues.push({ path: "grant", message: `You cannot add "${key}" because you do not hold it yourself.`, code: "GRANTOR_LACKS_PERMISSION" });
  }
  for (const key of deny) {
    if (!KNOWN.has(key) && !isReservedKey(key)) issues.push({ path: "deny", message: `"${key}" is not a permission.`, code: "UNKNOWN_PERMISSION" });
    else if (target.role.key === "MANAGEMENT" && ADMIN_RESERVED_KEYS.includes(key)) {
      issues.push({ path: "deny", message: `"${key}" cannot be removed from a Management member. Running the organisation stays with the Management role.`, code: "MANAGEMENT_KEY_PROTECTED" });
    }
  }
  for (const key of grant) if (deny.includes(key)) issues.push({ path: "grant", message: `"${key}" cannot be both added and removed.`, code: "CONFLICT" });

  // A change right still needs its view right (the custom-role rule): report only problems this change creates.
  if (issues.length === 0) {
    const withImplied = (set: Set<string>) => {
      for (const k of [...set]) for (const i of PERMISSION_IMPLICATIONS[k] ?? []) set.add(i);
      return set;
    };
    const base = withImplied(new Set(roleKeys));
    const next = withImplied(new Set([...roleKeys, ...grant]));
    for (const k of deny) next.delete(k);
    const known = new Set(viewIssues(base).map((i) => i.message));
    for (const i of viewIssues(next)) if (!known.has(i.message)) issues.push({ path: "permissions", message: i.message, code: i.code });
  }
  if (issues.length > 0) throw bad("This access change is not allowed.", issues);

  const before = await overridesOf(ctx, membershipId);
  await withOrgContext(ctx.organizationId, async (tx) => {
    await tx.membershipPermissionOverride.deleteMany({ where: { membershipId, organizationId: ctx.organizationId } });
    const rows = [
      ...grant.map((permissionKey) => ({ permissionKey, effect: "GRANT" })),
      ...deny.map((permissionKey) => ({ permissionKey, effect: "DENY" })),
    ];
    if (rows.length > 0) {
      await tx.membershipPermissionOverride.createMany({
        data: rows.map((r) => ({ ...r, organizationId: ctx.organizationId, membershipId, createdBy: ctx.membershipId })),
      });
    }
  });

  const unchanged = JSON.stringify(before) === JSON.stringify({ grant, deny });
  if (!unchanged) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "membership.permissions_overridden",
      entityType: "Membership",
      entityId: membershipId,
      previousValue: before,
      newValue: { grant, deny },
      metadata: { roleKey: target.role.key },
    });
    invalidateMeContext({ organizationId: ctx.organizationId });
  }
  return view(ctx, target);
}
