import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { getPlatformSecuritySettings, updatePlatformSecuritySettings } from "@/services/platformAdminService";

const Schema = z
  .object({
    idleHours: z.number().optional(),
    absoluteHours: z.number().optional(),
    reverifyMinutes: z.number().optional(),
    maxFailedAttempts: z.number().optional(),
    lockoutMinutes: z.number().optional(),
  })
  .strict();

/** Platform security settings (PL14): session limits, how long a verification counts, the lock. Needs `platform.security.manage`. */
export async function GET() {
  return handleRoute(async () => getPlatformSecuritySettings(await requirePlatformApi("platform.security.manage")));
}

/** Change settings (needs a recent verification). The minimum of two active admins is a rule, not a setting. */
export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.security.manage");
    return updatePlatformSecuritySettings(context, await parseJsonBody(request, Schema));
  });
}
