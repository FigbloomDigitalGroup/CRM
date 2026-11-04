import { z } from "zod";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveUserContext } from "@/auth/requestContext";
import { confirmMyEnrolment } from "@/services/twoStepService";

const Schema = z.object({ code: requiredString("Enter the 6-digit code.") });

/** Finish turning two-step on with a first code. Returns the backup codes: the only time they are shown. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    return confirmMyEnrolment((await resolveUserContext()).userId, body.code, getClientIp(request));
  });
}
