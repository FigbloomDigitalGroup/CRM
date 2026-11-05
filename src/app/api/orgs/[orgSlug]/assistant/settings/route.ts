import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { getAssistantSettings, updateAssistantSettings } from "@/services/assistantService";

const UpdateSchema = z.strictObject({
  enabled: z.boolean().optional(),
  summaries: z.boolean().optional(),
  drafts: z.boolean().optional(),
  scoring: z.boolean().optional(),
  retention: z.boolean().optional(),
  dailyLimitPerUser: z.number().int().optional(),
  dailyLimitPerOrg: z.number().int().optional(),
});

// Is Ask Figbloom on, what is allowed, how many questions are left today (FIG-1152).
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    return getAssistantSettings(await resolveGatedContext(orgSlug, "release.v11"));
  });
}

// Management: the organisation switch (off by default), the options and the daily limits.
export async function PUT(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v11");
    return updateAssistantSettings(ctx, await parseJsonBody(request, UpdateSchema));
  });
}
