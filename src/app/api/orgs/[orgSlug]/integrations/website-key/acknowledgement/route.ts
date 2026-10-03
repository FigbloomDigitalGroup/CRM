import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getWebsiteAcknowledgementSetting,
  setWebsiteAcknowledgementSetting,
} from "@/services/notificationService";

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
    const body = (await request.json()) as { enabled?: boolean };
    return setWebsiteAcknowledgementSetting(ctx, Boolean(body.enabled));
  });
}
