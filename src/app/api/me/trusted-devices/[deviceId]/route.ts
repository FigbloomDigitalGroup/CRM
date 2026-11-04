import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveUserContext } from "@/auth/requestContext";
import { revokeTrustedDevice } from "@/services/twoStepService";

/** Stop trusting one device. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  return handleRoute(async () => {
    const { deviceId } = await params;
    await revokeTrustedDevice((await resolveUserContext()).userId, deviceId);
    return { ok: true };
  });
}
