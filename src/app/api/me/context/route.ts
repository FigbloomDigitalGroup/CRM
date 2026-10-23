import { cookies } from "next/headers";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { MeContextSchema } from "@/api/dto/meContext";
import { respond } from "@/api/respond";
import { UnauthorizedError } from "@/auth/errors";
import { resolveDevPlatformIdentity } from "@/auth/platformIdentity";
import { resolveUserContext } from "@/auth/requestContext";
import { getMemberContext, getPlatformContext } from "@/services/meContextService";

/**
 * Everything the shell needs to draw itself, in one call and the same shape for
 * every role (B1.10). Works for an account still waiting for access (the
 * organisation, role and look are `null`). `?org=<slug>` opens another
 * organisation the person belongs to. A dev Platform Super Admin gets the
 * platform variant.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const orgSlug = new URL(request.url).searchParams.get("org");
    let identity;
    try {
      identity = await resolveUserContext();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        const platform = await resolveDevPlatformIdentity(await cookies());
        if (platform) return respond(MeContextSchema, await getPlatformContext(platform));
      }
      throw err;
    }
    return respond(MeContextSchema, await getMemberContext({ userId: identity.userId, session: identity.session, orgSlug }));
  });
}
