/**
 * Platform permission keys (FIG-1135, B6.03). A separate catalogue from the
 * tenant keys in `prisma/seedData.ts`: every key starts with `platform.`, no
 * tenant key does, and a tenant role can never hold one (a test enforces both).
 *
 * Note what is missing on purpose: there is no key that reads a customer
 * record, a deal value, a payment or a cost. Without break-glass a platform
 * admin sees counts and flags only (docs/DECISIONS.md 4.7); the break-glass key
 * below only lets an admin *ask* the organisation for support access (B6.12).
 */
export const PLATFORM_PERMISSIONS = [
  { key: "platform.console.view", description: "Open the platform console." },
  { key: "platform.organizations.view", description: "List organisations and see their operational counts (numbers only)." },
  { key: "platform.organizations.provision", description: "Provision a new organisation." },
  { key: "platform.organizations.suspend", description: "Suspend or reinstate an organisation." },
  { key: "platform.flags.manage", description: "Change feature flags and limits for an organisation." },
  { key: "platform.announcements.manage", description: "Publish platform announcements." },
  { key: "platform.support.request", description: "Request time-boxed support access from an organisation." },
  { key: "platform.audit.view", description: "Read the platform audit log, export it and check its integrity." },
  { key: "platform.health.manage", description: "Open and resolve incident markers on the health page." },
  { key: "platform.data_requests.manage", description: "Approve, reject, package and carry out organisations' export and deletion requests." },
  { key: "platform.admins.manage", description: "Invite, suspend and recover platform admins." },
  { key: "platform.security.manage", description: "Change platform security settings." },
  { key: "platform.preferences.manage", description: "Change the platform admin's own preferences." },
] as const;

export type PlatformPermissionKey = (typeof PLATFORM_PERMISSIONS)[number]["key"];

export const PLATFORM_PERMISSION_KEYS: readonly PlatformPermissionKey[] = PLATFORM_PERMISSIONS.map((p) => p.key);

/**
 * The only platform role today. Every active platform identity is a Platform
 * Super Admin and holds every key; finer platform roles are not in V1.1.
 */
export const PLATFORM_SUPER_ADMIN_ROLE = "PLATFORM_SUPER_ADMIN";

export function platformPermissionKeysFor(status: string): readonly PlatformPermissionKey[] {
  // A suspended identity holds nothing, so even a stale session grants no access.
  return status === "ACTIVE" ? PLATFORM_PERMISSION_KEYS : [];
}

export function isPlatformPermissionKey(key: string): key is PlatformPermissionKey {
  return (PLATFORM_PERMISSION_KEYS as readonly string[]).includes(key);
}
