import { z } from "zod";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveUserContext } from "@/auth/requestContext";
import { regenerateMyBackupCodes } from "@/services/twoStepService";

const Schema = z.object({ password: requiredString("Enter your password."), code: requiredString("Enter a code from your authenticator app or a backup code.") });

/** Replace all backup codes (password and a current code). The new codes are shown once; the old ones stop working. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    return { backupCodes: await regenerateMyBackupCodes((await resolveUserContext()).userId, body.password, body.code, getClientIp(request)) };
  });
}
