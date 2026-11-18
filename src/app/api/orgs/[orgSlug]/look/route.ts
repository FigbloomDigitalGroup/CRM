import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getOrganizationLook, updateOrganizationLook } from "@/services/organizationLookService";

const UpdateLookSchema = z.strictObject({
  displayName: z.string().nullable().optional(),
  logoFileId: z.string().nullable().optional(),
  defaultTheme: z.string().optional(),
  defaultPageColour: z.string().optional(),
  showLogoOnClientPages: z.boolean({ error: "Show logo on client pages must be true or false." }).optional(),
  allowPersonalisation: z.boolean({ error: "Allow personalisation must be true or false." }).optional(),
});

/** How the organisation looks: name, logo, default theme and page colour. Every member reads it (B1.09). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getOrganizationLook(ctx);
  });
}

/** Management only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateLookSchema);
    return updateOrganizationLook(ctx, body);
  });
}
