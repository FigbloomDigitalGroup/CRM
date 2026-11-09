import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createForm, listForms } from "@/services/webFormService";

const CreateFormSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  fields: z.unknown().optional(),
  leadSourceKey: z.string().nullable().optional(),
  successMessage: z.string().optional(),
  /** FIG-1189: language of the public form's own text (en or sw). */
  language: z.string().optional(),
  allowedOrigins: z.unknown().optional(),
  honeypotFieldName: z.string().optional(),
  /** Write only: never returned. */
  captchaSecret: z.string().nullable().optional(),
});

// Web forms that create leads (FIG-1151, S6#2). Management only (configuration.manage).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listForms(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateFormSchema);
    return withIdempotency(ctx, request, body, () => createForm(ctx, body));
  });
}
