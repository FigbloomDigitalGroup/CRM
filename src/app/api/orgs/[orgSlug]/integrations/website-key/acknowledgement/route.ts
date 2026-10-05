import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getWebsiteAcknowledgementSetting,
  setWebsiteAcknowledgementSetting,
} from "@/services/notificationService";

const SetAcknowledgementSchema = z.object({
  enabled: z.boolean(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getWebsiteAcknowledgementSetting(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SetAcknowledgementSchema);
    return setWebsiteAcknowledgementSetting(ctx, body.enabled);
  });
}
