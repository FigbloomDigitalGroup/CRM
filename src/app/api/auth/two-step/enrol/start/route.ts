import { cookies } from "next/headers";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { PENDING_TWO_STEP_COOKIE_NAME } from "@/app/api/_lib/twoStepCookies";
import { beginSignInEnrolment } from "@/services/twoStepSignInService";

/** Policy-forced enrolment at sign-in (FIG-1134): the seed and the otpauth link for the authenticator app. Needs an ENROL challenge. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const token = (await cookies()).get(PENDING_TWO_STEP_COOKIE_NAME)?.value;
    return beginSignInEnrolment(token, { ipAddress: getClientInfo(request).ipAddress });
  });
}
