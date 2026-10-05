import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { requestPasswordReset } from "@/services/authService";

const RequestPasswordResetSchema = z.object({
  email: requiredString("Email is required."),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, RequestPasswordResetSchema);
    const origin = new URL(request.url).origin;
    return requestPasswordReset(
      body.email,
      (token) => `${origin}/reset-password?token=${token}`,
    );
  });
}
