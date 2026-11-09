import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteForm, getForm, updateForm } from "@/services/webFormService";

const UpdateFormSchema = z.strictObject({
  name: z.string().optional(),
  status: z.string().optional(),
  fields: z.unknown().optional(),
  leadSourceKey: z.string().nullable().optional(),
  successMessage: z.string().optional(),
  /** FIG-1189: language of the public form's own text (en or sw). */
  language: z.string().optional(),
  allowedOrigins: z.unknown().optional(),
  honeypotFieldName: z.string().optional(),
  captchaSecret: z.string().nullable().optional(),
});

type Params = { params: Promise<{ orgSlug: string; formId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, formId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getForm(ctx, formId);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, formId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateFormSchema);
    return updateForm(ctx, formId, body);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, formId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteForm(ctx, formId);
  });
}
