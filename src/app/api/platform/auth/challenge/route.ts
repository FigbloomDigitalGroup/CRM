import { cookies } from "next/headers";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { PLATFORM_PENDING_COOKIE_NAME } from "@/app/api/platform/_lib/platformCookies";
import { platformChallengeInfo } from "@/services/platformSignInService";

/** Which second step the pending platform sign-in needs (VERIFY or ENROL). 401 when there is none or it has expired. */
export async function GET() {
  return handleRoute(async () => platformChallengeInfo((await cookies()).get(PLATFORM_PENDING_COOKIE_NAME)?.value));
}
