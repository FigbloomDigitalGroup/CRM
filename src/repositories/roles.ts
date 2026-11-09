import { adminDb } from "../db/adminClient";

/**
 * The role a member of `organizationId` may be given by key (FIG-1188, B7.06): a platform role, or a custom role of this very
 * organisation that is not archived. A custom role of another organisation is as good as unknown: null, never an error that
 * confirms it exists.
 */
export async function findAssignableRole(organizationId: string, roleKey: string) {
  const role = await adminDb.role.findUnique({ where: { key: roleKey } });
  if (!role) return null;
  if (role.organizationId === null) return role;
  return role.organizationId === organizationId && role.archivedAt === null ? role : null;
}
