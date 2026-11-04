import { cookies } from "next/headers";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { PENDING_TWO_STEP_COOKIE_NAME } from "@/app/api/_lib/twoStepCookies";
import { tenantTwoStep } from "@/auth/twoStep/stores";

/** Which second step the pending sign-in needs (VERIFY: enter a code; ENROL: set up two-step first). 401 when there is none or it has expired. */
export async function GET() {
  return handleRoute(async () => {
    const challenge = await tenantTwoStep.loadChallenge((await cookies()).get(PENDING_TWO_STEP_COOKIE_NAME)?.value);
    return { purpose: challenge.purpose, expiresAt: challenge.expiresAt.toISOString(), attemptsLeft: Math.max(0, 5 - challenge.attempts) };
  });
}
