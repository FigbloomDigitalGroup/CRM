import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getWhatsAppConfig, updateWhatsAppConfig } from "@/services/integrationRegistryService";

const UpdateWhatsAppSchema = z.strictObject({
  number: z.string().nullable().optional(),
  defaultMessage: z.string().optional(),
  templates: z
    .array(z.strictObject({ key: z.string().optional(), label: z.string(), body: z.string() }))
    .optional(),
});

// Click-to-chat configuration (FIG-1060, B4.03): the organisation number and the messages wa.me links open with.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getWhatsAppConfig(ctx);
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateWhatsAppSchema);
    return updateWhatsAppConfig(ctx, body);
  });
}
