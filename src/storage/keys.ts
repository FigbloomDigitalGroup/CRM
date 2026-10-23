/**
 * Storage keys are always `orgs/<organizationId>/<purpose>/<fileId>`: the
 * per-organisation prefix is how one organisation's bytes are kept apart from
 * another's (and how a purge or an offboarding finds everything of one
 * organisation). The database also checks the prefix (`files_storage_key_prefix_check`).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orgKeyPrefix(organizationId: string): string {
  if (!UUID.test(organizationId)) throw new Error("Invalid organization id for a storage key.");
  return `orgs/${organizationId}/`;
}

export function buildStorageKey(organizationId: string, purpose: string, fileId: string): string {
  if (!UUID.test(fileId)) throw new Error("Invalid file id for a storage key.");
  if (!/^[a-z]+$/.test(purpose)) throw new Error("Invalid purpose for a storage key.");
  return `${orgKeyPrefix(organizationId)}${purpose}/${fileId}`;
}

/** True when `key` is a well-formed key inside `organizationId`'s prefix and contains no traversal. */
export function keyBelongsToOrganization(key: string, organizationId: string): boolean {
  if (!UUID.test(organizationId)) return false;
  if (!key.startsWith(orgKeyPrefix(organizationId))) return false;
  const rest = key.slice(orgKeyPrefix(organizationId).length);
  return /^[a-z]+\/[0-9a-f-]{36}$/i.test(rest);
}
