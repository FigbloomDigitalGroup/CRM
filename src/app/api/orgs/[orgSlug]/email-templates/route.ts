import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createTemplate, listMergeFields, listTemplates } from "@/services/emailTemplateService";

const ListQuerySchema = z.object({ includeInactive: z.enum(["true", "false"]).optional() });
const CreateTemplateSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  subject: z.string({ error: "subject is required." }),
  body: z.string({ error: "body is required." }),
});

// Email templates for "Send and log email" (FIG-797). Anyone who can send email can list the active ones.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return {
      items: await listTemplates(ctx, { includeInactive: query.includeInactive === "true" }),
      mergeFields: listMergeFields(),
    };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateTemplateSchema);
    return createTemplate(ctx, body);
  });
}
