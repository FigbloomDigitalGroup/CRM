import { cookies } from "next/headers";
import { NotFoundError } from "@/auth/errors";
import type { PlatformPermissionKey } from "@/auth/platformPermissions";
import { requirePlatformPermission, resolvePlatformContext } from "@/auth/platformSession";
import { globalRelease, releaseAtLeast } from "@/lib/featureFlags";

/**
 * The door for every `/api/platform/*` route (FIG-1135). Anyone who is not a
 * platform identity, a signed-in organisation user included, gets the ordinary
 * 404, so the address gives nothing away (PL15). A platform identity missing
 * the key gets 403 with the key named.
 */
export async function requirePlatformApi(key: PlatformPermissionKey) {
  const context = await resolvePlatformContext(await cookies());
  if (!context) throw new NotFoundError("Platform resource", "current");
  requirePlatformPermission(context, key);
  return context;
}

/**
 * The door for the V2 platform routes (support access, flags and limits, announcements): the same checks as `requirePlatformApi`, then
 * the deployment must be running release V2. Below V2 they answer the ordinary 404, like any other address that is not there
 * (docs/DECISIONS.md 7.1: V2 is hidden until it is released).
 */
export async function requirePlatformV2Api(key: PlatformPermissionKey) {
  const context = await requirePlatformApi(key);
  if (!releaseAtLeast(globalRelease(), "v2")) throw new NotFoundError("Platform resource", "current");
  return context;
}
