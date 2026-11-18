import { adminDb } from "../src/db/adminClient";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "./seedData";

export interface CatalogueSyncResult {
  roles: number;
  permissions: number;
  /** role key -> permission keys added / removed by this sync. */
  changes: Record<string, { added: string[]; removed: string[] }>;
}

/**
 * The reference data every environment needs, production included: the role
 * and permission catalogue. (The per-organization catalogues -- lead
 * statuses, sources, pipeline stages, lost reasons, services and lifecycle
 * states -- come from `seedOrganizationDefaults`, which runs when an
 * organization is created.)
 *
 * This is a RECONCILING sync (B1.01): the code's catalogue is the truth, so a
 * permission a role no longer has is removed from the database, not merely
 * left behind by an upsert. Every role whose permission set changed gets one
 * `role.permissions_changed` audit event in each organisation that has a
 * member holding that role, so Management can see why access moved. Safe to
 * run repeatedly: a second run changes nothing and writes no audit events.
 */
export async function seedRolesAndPermissions(): Promise<CatalogueSyncResult> {
  for (const role of ROLES) {
    const data = {
      name: role.name,
      description: role.description,
      requiredFeature: role.requiredFeature ?? null,
    };
    await adminDb.role.upsert({
      where: { key: role.key },
      update: data,
      create: { key: role.key, ...data },
    });
  }

  for (const permission of PERMISSIONS) {
    await adminDb.permission.upsert({
      where: { key: permission.key },
      update: { area: permission.area, description: permission.description },
      create: permission,
    });
  }

  const permissionByKey = new Map(
    (await adminDb.permission.findMany()).map((p) => [p.key, p.id]),
  );
  const changes: CatalogueSyncResult["changes"] = {};

  for (const role of ROLES) {
    const roleRow = await adminDb.role.findUniqueOrThrow({
      where: { key: role.key },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const wanted = new Set(ROLE_PERMISSIONS[role.key] ?? []);
    const existing = new Set(roleRow.rolePermissions.map((rp) => rp.permission.key));

    const added = [...wanted].filter((k) => !existing.has(k)).sort();
    const removed = [...existing].filter((k) => !wanted.has(k)).sort();

    for (const key of added) {
      const permissionId = permissionByKey.get(key);
      if (!permissionId) throw new Error(`Unknown permission "${key}" for ${role.key}`);
      await adminDb.rolePermission.create({
        data: { roleId: roleRow.id, permissionId },
      });
    }
    if (removed.length > 0) {
      await adminDb.rolePermission.deleteMany({
        where: {
          roleId: roleRow.id,
          permission: { key: { in: removed } },
        },
      });
    }

    if (added.length === 0 && removed.length === 0) continue;
    changes[role.key] = { added, removed };

    const orgs = await adminDb.membership.findMany({
      where: { roleId: roleRow.id },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    for (const { organizationId } of orgs) {
      await adminDb.auditEvent.create({
        data: {
          organizationId,
          action: "role.permissions_changed",
          entityType: "Role",
          entityId: roleRow.id,
          previousValue: { permissions: [...existing].sort() },
          newValue: { permissions: [...wanted].sort() },
          metadata: { roleKey: role.key, added, removed, source: "catalogue_sync" },
        },
      });
    }
  }

  console.log(
    `Seeded ${ROLES.length} roles, ${PERMISSIONS.length} permissions` +
      (Object.keys(changes).length
        ? ` (changed: ${Object.keys(changes).join(", ")}).`
        : " (no changes)."),
  );
  return { roles: ROLES.length, permissions: PERMISSIONS.length, changes };
}
