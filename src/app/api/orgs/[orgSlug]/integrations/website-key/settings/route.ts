import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateWebsiteApiKeySettings } from "@/services/integrationService";

/**
 * Body fields are all optional (FIG-594) -- any field the caller omits is
 * left unchanged, matching `updateWebsiteApiKeySecurity`'s
 * undefined-means-unchanged contract. `captchaSecret: ""` clears it
 * (treated as null); omitting it entirely leaves whatever's already set.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as {
      allowedOrigins?: string[];
      honeypotFieldName?: string | null;
      captchaSecret?: string | null;
    };

    return updateWebsiteApiKeySettings(ctx, {
      allowedOrigins: body.allowedOrigins,
      honeypotFieldName:
        body.honeypotFieldName === "" ? null : body.honeypotFieldName,
      captchaSecret: body.captchaSecret === "" ? null : body.captchaSecret,
    });
  });
}
