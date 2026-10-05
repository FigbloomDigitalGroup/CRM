import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resetPassword } from "@/services/authService";

const ConfirmPasswordResetSchema = z.object({
  token: requiredString("Token and newPassword are required."),
  newPassword: requiredString("Token and newPassword are required."),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, ConfirmPasswordResetSchema);
    await resetPassword(body.token, body.newPassword);
    return { ok: true };
  });
}
