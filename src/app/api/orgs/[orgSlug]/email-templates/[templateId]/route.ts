import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { removeTemplate, updateTemplate } from "@/services/emailTemplateService";

const UpdateTemplateSchema = z.strictObject({
  name: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; templateId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, templateId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateTemplateSchema);
    return updateTemplate(ctx, templateId, body);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; templateId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, templateId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return removeTemplate(ctx, templateId);
  });
}
