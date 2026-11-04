import { cookies } from "next/headers";
import { NotFoundError } from "@/auth/errors";
import type { PlatformPermissionKey } from "@/auth/platformPermissions";
import { requirePlatformPermission, resolvePlatformContext } from "@/auth/platformSession";

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
