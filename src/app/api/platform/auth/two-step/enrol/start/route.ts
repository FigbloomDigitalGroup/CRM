import { cookies } from "next/headers";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { PLATFORM_PENDING_COOKIE_NAME } from "@/app/api/platform/_lib/platformCookies";
import { beginPlatformEnrolment } from "@/services/platformSignInService";

/** Platform two-step set-up at sign-in: the seed and the otpauth link for the authenticator app. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const token = (await cookies()).get(PLATFORM_PENDING_COOKIE_NAME)?.value;
    return beginPlatformEnrolment(token, getClientInfo(request));
  });
}
