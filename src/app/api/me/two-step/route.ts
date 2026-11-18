import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { getMyTwoStep } from "@/services/twoStepService";

/** Whether two-step is on for the person, how many backup codes are left, whether their organisation requires it, and their trusted devices (FIG-1134). Never a secret. */
export async function GET() {
  return handleRoute(async () => getMyTwoStep((await resolveUserContext()).userId));
}
