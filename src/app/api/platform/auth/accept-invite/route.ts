import { z } from "zod";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { acceptPlatformInvite } from "@/services/platformAdminService";

const Schema = z.object({
  token: requiredString("The link is incomplete."),
  password: requiredString("Choose a password."),
  name: z.string().optional(),
});

/** A platform admin opens the emailed link and chooses a password (an invitation creates the admin; a recovery link resets it). No session: they sign in next and set up two-step. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, Schema);
    return acceptPlatformInvite(body.token, body.password, body.name ?? null, getClientIp(request));
  });
}
