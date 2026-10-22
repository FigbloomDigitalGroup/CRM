import { adminDb } from "../src/db/adminClient";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "./seedData";

/**
 * The reference data every environment needs, production included: the role
 * and permission catalogue. (The per-organization catalogues -- lead
 * statuses, sources, pipeline stages, lost reasons, services and lifecycle
 * states -- come from `seedOrganizationDefaults`, which runs when an
 * organization is created.) Every write is an upsert keyed on a stable
 * natural key, so this is safe to run repeatedly.
 */
export async function seedRolesAndPermissions() {
  for (const role of ROLES) {
    await adminDb.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  for (const permission of PERMISSIONS) {
    await adminDb.permission.upsert({
      where: { key: permission.key },
      update: { area: permission.area, description: permission.description },
      create: permission,
    });
  }

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await adminDb.role.findUniqueOrThrow({
      where: { key: roleKey },
    });
    for (const permissionKey of permissionKeys) {
      const permission = await adminDb.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await adminDb.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log(
    `Seeded ${ROLES.length} roles, ${PERMISSIONS.length} permissions.`,
  );
}
