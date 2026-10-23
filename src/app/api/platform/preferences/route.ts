import { cookies } from "next/headers";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { NotFoundError } from "@/auth/errors";
import { resolveDevPlatformIdentity } from "@/auth/platformIdentity";
import { getPlatformPreferences, updatePlatformPreferences } from "@/services/platformPreferenceService";

/**
 * The dev-only Platform Super Admin's preferences (B1.08). Resolves the
 * platform cookie, which exists only with dev accounts allowed, so anywhere
 * else this is a 404.
 */
async function identityOr404() {
  const identity = await resolveDevPlatformIdentity(await cookies());
  if (!identity) throw new NotFoundError("Platform identity", "current");
  return identity;
}

export async function GET() {
  return handleRoute(async () => getPlatformPreferences((await identityOr404()).id));
}

export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const identity = await identityOr404();
    const body = await parseJsonBody(request, z.record(z.string(), z.unknown()));
    return updatePlatformPreferences(identity.id, body);
  });
}
