import { z } from "zod";
import { getClientIp } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { reverify } from "@/services/platformAdminService";

const Schema = z.object({ code: requiredString("Enter a code from your authenticator app or a backup code.") });

/** Verify it's you (PL11): a fresh code renews this session's verification, which sensitive platform actions require. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.console.view");
    const body = await parseJsonBody(request, Schema);
    return reverify(context, body.code, getClientIp(request));
  });
}
