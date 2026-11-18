import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { renderTemplate } from "@/services/emailTemplateService";

const RenderSchema = z.strictObject({
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

// Fills a template for the records an email is about. The form shows the result in the editable subject and body.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; templateId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, templateId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, RenderSchema);
    return renderTemplate(ctx, templateId, body);
  });
}
