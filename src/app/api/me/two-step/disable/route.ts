import { z } from "zod";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveUserContext } from "@/auth/requestContext";
import { disableMyTwoStep } from "@/services/twoStepService";

const Schema = z.object({ password: requiredString("Enter your password."), code: requiredString("Enter a code from your authenticator app or a backup code.") });

/** Turn two-step off (password and a current code; refused where the organisation requires it). Alerts the person by email. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    await disableMyTwoStep((await resolveUserContext()).userId, body.password, body.code, getClientIp(request));
    return { ok: true };
  });
}
