import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { listTrustedDevices, revokeAllTrustedDevices } from "@/services/twoStepService";

/** Devices that skip the code at sign-in (30 days each). */
export async function GET() {
  return handleRoute(async () => ({ items: await listTrustedDevices((await resolveUserContext()).userId) }));
}

/** Stop trusting every device. */
export async function DELETE() {
  return handleRoute(async () => ({ revoked: await revokeAllTrustedDevices((await resolveUserContext()).userId) }));
}
