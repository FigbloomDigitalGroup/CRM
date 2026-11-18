import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PERMISSIONS, ROLES } from "../../prisma/seedData";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { deny } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { resolveScope, permissionMinRelease, type ScopedResource, type ScopedAction } from "../auth/permissions";
import { adminDb } from "../db/adminClient";
import {
  EDITABLE_FIELD_IDS,
  FIELD_CATALOGUE,
  grantableKeys,
  isReservedKey,
  reconcileFieldRules,
  reservedReason,
  validateFieldRules,
  validatePermissionKeys,
  type FieldRules,
  type RoleIssue,
} from "../lib/roleLimits";
import { recordAuditEvent } from "../repositories/auditEvents";
import { invalidateMeContext } from "./meContextCache";

/**
 * Roles and field access editor (FIG-1188, B7.06). Management (`roles.manage`) creates custom roles for its own organisation,
 * edits their permissions inside the platform's limits (`src/lib/roleLimits.ts`), sets field visibility, and previews the
 * effect before saving. The five platform roles are read-only here. Everything is audited. A change is effective on the
 * very next request: `resolveActiveMembership` reads the role afresh each time, and the one cache in front of it (the shell's
 * `/me/context`) is cleared for the whole organisation on every write.
 *
 * Lock-out safety is structural: a custom role can never carry a key that runs the organisation (`ADMIN_RESERVED_KEYS`), so
 * no edit here can remove the last Management member's powers, and `membershipService` still refuses to move the last active
 * Management member to another role.
 */

export const MAX_CUSTOM_ROLES = 25;
const NAME_MIN = 2;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;
const MEMBER_STATES = ["ACTIVE", "PENDING", "INACTIVE"] as const;

const MANAGE = "roles.manage";

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: "platform" | "custom";
  basedOnRoleKey: string | null;
  editable: boolean;
  permissionKeys: string[];
  fieldRules: FieldRules;
  memberCount: number;
  archivedAt: Date | null;
  updatedAt: Date;
}

function issuesToValidation(message: string, issues: RoleIssue[]): ValidationError {
  return new ValidationError(message, issues as ValidationIssue[]);
}

function canSeeRoles(ctx: AuthContext): boolean {
  return hasPermission(ctx, MANAGE) || hasPermission(ctx, "role.assign");
}

type RoleRow = Prisma.RoleGetPayload<{ include: { rolePermissions: { include: { permission: true } } } }>;

async function fieldRulesFor(organizationId: string, roleIds: string[]): Promise<Map<string, FieldRules>> {
  const rows = roleIds.length ? await adminDb.roleFieldRule.findMany({ where: { organizationId, roleId: { in: roleIds } } }) : [];
  const out = new Map<string, FieldRules>();
  for (const r of rows) out.set(r.roleId, { ...(out.get(r.roleId) ?? {}), [r.field]: r.access as FieldRules[string] });
  return out;
}

async function memberCounts(organizationId: string, roleIds: string[]): Promise<Map<string, number>> {
  const groups = await adminDb.membership.groupBy({
    by: ["roleId"],
    where: { organizationId, roleId: { in: roleIds }, status: { in: [...MEMBER_STATES] } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.roleId, g._count._all]));
}

function toView(row: RoleRow, rules: FieldRules, count: number): RoleView {
  const custom = row.organizationId !== null;
  const keys = row.rolePermissions.map((rp) => rp.permission.key).sort();
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    kind: custom ? "custom" : "platform",
    basedOnRoleKey: row.basedOnRoleKey,
    editable: custom && row.archivedAt === null,
    permissionKeys: keys,
    // A platform role's own rule for the value: its key decides (Management and Finance see all values, the others only their own).
    fieldRules: custom ? { "deal.value": "own", ...rules } : { "deal.value": keys.includes("deals.view.value") ? "all" : "own" },
    memberCount: count,
    archivedAt: row.archivedAt,
    updatedAt: row.updatedAt,
  };
}

async function loadRoleRows(organizationId: string, where: Prisma.RoleWhereInput): Promise<RoleView[]> {
  const rows = await adminDb.role.findMany({
    where: { AND: [where, { OR: [{ organizationId: null }, { organizationId }] }] },
    include: { rolePermissions: { include: { permission: true } } },
    orderBy: { name: "asc" },
  });
  const ids = rows.map((r) => r.id);
  const [rules, counts] = await Promise.all([fieldRulesFor(organizationId, ids), memberCounts(organizationId, ids)]);
  const order = new Map(ROLES.map((r, i) => [r.key, i]));
  return rows
    .map((r) => toView(r, rules.get(r.id) ?? {}, counts.get(r.id) ?? 0))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "platform" ? -1 : 1;
      if (a.kind === "platform") return (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99);
      return a.name.localeCompare(b.name);
    });
}

/** The platform roles and this organisation's custom roles (archived ones only when asked). */
export async function listRoles(ctx: AuthContext, options: { includeArchived?: boolean } = {}): Promise<{ roles: RoleView[]; limits: { maxCustomRoles: number; customRoles: number } }> {
  if (!canSeeRoles(ctx)) throw deny(ctx, MANAGE, [MANAGE, "role.assign"]);
  const roles = await loadRoleRows(ctx.organizationId, options.includeArchived ? {} : { archivedAt: null });
  return { roles, limits: { maxCustomRoles: MAX_CUSTOM_ROLES, customRoles: roles.filter((r) => r.kind === "custom" && !r.archivedAt).length } };
}

export async function getRole(ctx: AuthContext, roleId: string): Promise<RoleView> {
  if (!canSeeRoles(ctx)) throw deny(ctx, MANAGE, [MANAGE, "role.assign"]);
  const [role] = await loadRoleRows(ctx.organizationId, { id: roleId });
  if (!role) throw new NotFoundError("Role", roleId);
  return role;
}

/** What the editor shows: every permission with whether this organisation may grant it, the fields, and the starting-point roles. */
export async function getRoleCatalog(ctx: AuthContext) {
  requirePermission(ctx, MANAGE);
  const grantable = new Set(grantableKeys());
  return {
    permissions: PERMISSIONS.map((p) => ({
      key: p.key,
      area: p.area,
      description: p.description,
      grantable: grantable.has(p.key),
      reason: reservedReason(p.key),
      release: permissionMinRelease(p.key),
    })),
    fields: FIELD_CATALOGUE.map((f) => ({ id: f.id, label: f.label, governedBy: f.governedBy, editable: f.editable, options: f.options, help: f.help })),
    startingPoints: ROLES.map((r) => ({ key: r.key, name: r.name, description: r.description })),
    limits: { maxCustomRoles: MAX_CUSTOM_ROLES, nameLength: { min: NAME_MIN, max: NAME_MAX }, descriptionMax: DESCRIPTION_MAX },
  };
}

function cleanName(raw: string | undefined, issues: RoleIssue[]): string | undefined {
  if (raw === undefined) return undefined;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    issues.push({ path: "name", message: `A role name is ${NAME_MIN} to ${NAME_MAX} characters.`, code: "BAD_NAME" });
  } else if (ROLES.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    issues.push({ path: "name", message: "That is the name of a platform role. Choose another.", code: "NAME_TAKEN" });
  }
  return name;
}

function cleanDescription(raw: string | null | undefined, issues: RoleIssue[]): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const d = raw.trim();
  if (d.length > DESCRIPTION_MAX) issues.push({ path: "description", message: `At most ${DESCRIPTION_MAX} characters.`, code: "BAD_DESCRIPTION" });
  return d || null;
}

async function permissionIds(keys: string[]): Promise<Map<string, string>> {
  const rows = await adminDb.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function startingKeys(basedOnRoleKey: string): Promise<string[]> {
  const base = await adminDb.role.findFirst({
    where: { key: basedOnRoleKey, organizationId: null },
    include: { rolePermissions: { include: { permission: true } } },
  });
  if (!base) throw new ValidationError(`"${basedOnRoleKey}" is not a platform role.`, [{ path: "basedOnRoleKey", message: "Choose one of the platform roles.", code: "UNKNOWN_ROLE" }]);
  const grantable = new Set(grantableKeys());
  return base.rolePermissions.map((rp) => rp.permission.key).filter((k) => grantable.has(k));
}

/**
 * Which field rules a request means. Rules that are sent win (merged over the saved ones). Keys sent without rules mean "derive the
 * rules from the keys", except that a saved "hidden" cannot be read from keys, so it stays while the value key stays off.
 */
function rulesFromRequest(saved: FieldRules | null, keys: string[] | undefined, sent: Record<string, string> | undefined): Record<string, string> {
  if (sent !== undefined) return { ...(saved ?? {}), ...sent };
  if (keys !== undefined) return saved?.["deal.value"] === "hidden" && !keys.includes("deals.view.value") ? { "deal.value": "hidden" } : {};
  return { ...(saved ?? {}) };
}

/** Validates and reconciles a proposed permission set and field rules; throws one ValidationError listing every problem. */
function checkProposal(keys: string[], rules: Record<string, string>, extra: RoleIssue[] = []) {
  const issues = [...extra, ...validateFieldRules(rules), ...validatePermissionKeys(keys)];
  // validatePermissionKeys sees deals.view.value as needing deal view; reconciling first makes the rule and the key agree.
  const reconciled = reconcileFieldRules(keys, rules);
  const afterReconcile = validatePermissionKeys(reconciled.keys).filter((i) => !issues.some((x) => x.message === i.message));
  const all = [...issues, ...afterReconcile];
  if (all.length > 0) throw issuesToValidation("These permissions are not allowed on a custom role.", all);
  return reconciled;
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  basedOnRoleKey?: string;
  permissionKeys?: string[];
  fieldRules?: Record<string, string>;
}

export async function createRole(ctx: AuthContext, input: CreateRoleInput): Promise<RoleView> {
  requirePermission(ctx, MANAGE);
  const issues: RoleIssue[] = [];
  const name = cleanName(input.name, issues)!;
  const description = cleanDescription(input.description, issues) ?? null;
  if (issues.length > 0) throw issuesToValidation("This role is not valid.", issues);

  const live = await adminDb.role.count({ where: { organizationId: ctx.organizationId, archivedAt: null } });
  if (live >= MAX_CUSTOM_ROLES) {
    throw issuesToValidation("This organisation has reached its limit of custom roles.", [
      { path: "name", message: `At most ${MAX_CUSTOM_ROLES} custom roles. Archive one you no longer use.`, code: "ROLE_LIMIT" },
    ]);
  }

  const keys = input.permissionKeys ?? (input.basedOnRoleKey ? await startingKeys(input.basedOnRoleKey) : []);
  const { keys: finalKeys, rules } = checkProposal(keys, input.fieldRules ?? {});
  const ids = await permissionIds(finalKeys);

  let roleId: string;
  try {
    roleId = await adminDb.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          key: `custom_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          name,
          description,
          isSystem: false,
          organizationId: ctx.organizationId,
          basedOnRoleKey: input.basedOnRoleKey ?? null,
          createdByMembershipId: ctx.membershipId,
        },
      });
      await tx.rolePermission.createMany({ data: finalKeys.map((k) => ({ roleId: role.id, permissionId: ids.get(k)! })) });
      await tx.roleFieldRule.createMany({
        data: EDITABLE_FIELD_IDS.map((field) => ({ roleId: role.id, organizationId: ctx.organizationId, field, access: rules[field]! })),
      });
      return role.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw issuesToValidation("This role is not valid.", [{ path: "name", message: "This organisation already has a role with that name.", code: "NAME_TAKEN" }]);
    }
    throw err;
  }

  const created = await getRole(ctx, roleId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "role.created",
    entityType: "Role",
    entityId: roleId,
    newValue: { name, description, basedOnRoleKey: input.basedOnRoleKey ?? null, permissionKeys: created.permissionKeys, fieldRules: created.fieldRules },
  });
  invalidateMeContext({ organizationId: ctx.organizationId });
  return created;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissionKeys?: string[];
  fieldRules?: Record<string, string>;
}

async function loadCustomRole(ctx: AuthContext, roleId: string): Promise<RoleView> {
  const role = await getRole(ctx, roleId);
  if (role.kind !== "custom") {
    throw issuesToValidation("A platform role cannot be edited.", [
      { path: "roleId", message: "Platform roles are fixed. Make a custom role from it instead.", code: "PLATFORM_ROLE_FIXED" },
    ]);
  }
  if (role.archivedAt) throw new NotFoundError("Role", roleId);
  return role;
}

export async function updateRole(ctx: AuthContext, roleId: string, input: UpdateRoleInput): Promise<RoleView> {
  requirePermission(ctx, MANAGE);
  const before = await loadCustomRole(ctx, roleId);

  const issues: RoleIssue[] = [];
  const name = cleanName(input.name, issues);
  const description = cleanDescription(input.description, issues);
  if (issues.length > 0) throw issuesToValidation("This role is not valid.", issues);

  const touchesAccess = input.permissionKeys !== undefined || input.fieldRules !== undefined;
  let nextKeys = before.permissionKeys;
  let nextRules: FieldRules = before.fieldRules;
  if (touchesAccess) {
    const out = checkProposal(input.permissionKeys ?? before.permissionKeys, rulesFromRequest(before.fieldRules, input.permissionKeys, input.fieldRules));
    nextKeys = out.keys;
    nextRules = out.rules;
  }

  const ids = await permissionIds(nextKeys);
  try {
    await adminDb.$transaction(async (tx) => {
      await tx.role.update({ where: { id: roleId }, data: { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) } });
      if (touchesAccess) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({ data: nextKeys.map((k) => ({ roleId, permissionId: ids.get(k)! })) });
        await tx.roleFieldRule.deleteMany({ where: { roleId, organizationId: ctx.organizationId } });
        await tx.roleFieldRule.createMany({
          data: EDITABLE_FIELD_IDS.map((field) => ({ roleId, organizationId: ctx.organizationId, field, access: nextRules[field]! })),
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw issuesToValidation("This role is not valid.", [{ path: "name", message: "This organisation already has a role with that name.", code: "NAME_TAKEN" }]);
    }
    throw err;
  }

  const after = await getRole(ctx, roleId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "role.updated",
    entityType: "Role",
    entityId: roleId,
    previousValue: { name: before.name, description: before.description, permissionKeys: before.permissionKeys, fieldRules: before.fieldRules },
    newValue: { name: after.name, description: after.description, permissionKeys: after.permissionKeys, fieldRules: after.fieldRules },
    metadata: { membersAffected: after.memberCount },
  });
  invalidateMeContext({ organizationId: ctx.organizationId });
  return after;
}

/** Archives a custom role nobody holds any more. The row stays so the audit trail keeps pointing at a real role. */
export async function archiveRole(ctx: AuthContext, roleId: string): Promise<void> {
  requirePermission(ctx, MANAGE);
  const role = await loadCustomRole(ctx, roleId);
  if (role.memberCount > 0) {
    throw issuesToValidation(`${role.memberCount} ${role.memberCount === 1 ? "person still has" : "people still have"} this role.`, [
      { path: "roleId", message: "Move them to another role first (Settings, Members), then archive this role.", code: "ROLE_IN_USE" },
    ]);
  }
  await adminDb.role.update({ where: { id: roleId }, data: { archivedAt: new Date() } });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "role.archived",
    entityType: "Role",
    entityId: roleId,
    previousValue: { name: role.name, permissionKeys: role.permissionKeys },
  });
  invalidateMeContext({ organizationId: ctx.organizationId });
}

// ---------------------------------------------------------------------------
// Preview of effect
// ---------------------------------------------------------------------------

const PREVIEW_RESOURCES: Array<[ScopedResource, ScopedAction]> = [
  ["leads", "view"], ["leads", "edit"], ["deals", "view"], ["deals", "edit"], ["tasks", "view"], ["tasks", "edit"],
  ["companies", "view"], ["companies", "edit"], ["contacts", "view"], ["contacts", "edit"], ["proposals", "view"], ["proposals", "edit"],
];

export interface PreviewInput {
  /** The custom role being changed; omit to preview a new role. */
  roleId?: string;
  basedOnRoleKey?: string;
  permissionKeys?: string[];
  fieldRules?: Record<string, string>;
}

/**
 * What a change would do, before it is saved: the permissions gained and lost, what the role could then see and change on each
 * screen family, the people it would reach, and the field rules. Writes nothing. Invalid proposals are answered the same way
 * saving would answer them, so the editor can show the reasons while the person is still choosing.
 */
export async function previewRole(ctx: AuthContext, input: PreviewInput) {
  requirePermission(ctx, MANAGE);
  const current = input.roleId ? await loadCustomRole(ctx, input.roleId) : null;
  const baseKeys = current
    ? current.permissionKeys
    : input.basedOnRoleKey
      ? await startingKeys(input.basedOnRoleKey)
      : [];
  const proposedKeys = input.permissionKeys ?? baseKeys;
  const { keys, rules } = checkProposal(proposedKeys, rulesFromRequest(current?.fieldRules ?? null, input.permissionKeys, input.fieldRules));

  const before = new Set(current?.permissionKeys ?? []);
  const after = new Set(keys);
  const holder = { permissionKeys: keys, membershipId: "preview" };
  const was = { permissionKeys: [...before], membershipId: "preview" };

  const people = current
    ? await adminDb.membership.findMany({
        where: { organizationId: ctx.organizationId, roleId: current.id, status: { in: [...MEMBER_STATES] } },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 50,
      })
    : [];

  const warnings: string[] = [];
  if (!keys.some((k) => ["leads.view.own", "leads.view.all", "leads.view.shared", "deals.view.own", "deals.view.all", "deals.view.won", "contacts.view", "companies.view", "tasks.view.own", "tasks.view.all"].includes(k))) {
    warnings.push("This role can open no leads, deals, contacts, companies or tasks.");
  }
  if (rules["deal.value"] === "hidden") warnings.push("Deal values are hidden from this role everywhere, including deals its people own.");

  return {
    valid: true as const,
    gained: [...after].filter((k) => !before.has(k)).sort(),
    lost: [...before].filter((k) => !after.has(k)).sort(),
    permissionKeys: keys,
    scopes: PREVIEW_RESOURCES.map(([resource, action]) => {
      const next = resolveScope(holder, resource, action);
      const prev = current ? resolveScope(was, resource, action) : null;
      return { resource, action, scope: next.scope, reason: next.reason, changed: prev ? prev.scope !== next.scope : null };
    }),
    fields: FIELD_CATALOGUE.map((f) => ({
      id: f.id,
      label: f.label,
      access: f.editable ? rules[f.id]! : ("hidden" as const),
      was: current ? (f.editable ? (current.fieldRules[f.id] ?? "own") : "hidden") : null,
    })),
    people: { count: current?.memberCount ?? 0, names: people.map((p) => p.user.name) },
    warnings,
  };
}

/** True when a role key names one of the platform's own roles. */
export function isPlatformRoleKey(key: string): boolean {
  return ROLES.some((r) => r.key === key);
}

export { isReservedKey };
