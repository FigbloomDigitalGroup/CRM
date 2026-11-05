import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { beginMyEnrolment } from "@/services/twoStepService";

/** Start turning two-step on: a fresh seed and an otpauth link for the authenticator app. Shown once. */
export async function POST(request: Request) {
  return handleRoute(async () => beginMyEnrolment((await resolveUserContext()).userId, getClientIp(request)));
}
