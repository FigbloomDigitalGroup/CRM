import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMyPreferences, updateMyPreferences } from "@/services/preferenceService";

const UpdatePreferencesSchema = z.strictObject({
  theme: z.string().optional(),
  pageColour: z.string().optional(),
  toggle: z.strictObject({ light: z.string().optional(), dark: z.string().optional() }).optional(),
  density: z.string().optional(),
  startPage: z.string().nullable().optional(),
  sidebar: z
    .strictObject({ collapsed: z.boolean().optional(), hidden: z.array(z.string()).optional() })
    .optional(),
  hourFormat: z.string().optional(),
  firstDayOfWeek: z.string().optional(),
  dateFormat: z.string().optional(),
  ownColours: z.record(z.string(), z.unknown()).nullable().optional(),
  // Device-only settings: part of the shape so the refusal can say why.
  textSize: z.unknown().optional(),
  bold: z.unknown().optional(),
  higherContrast: z.unknown().optional(),
  reduceMotion: z.unknown().optional(),
});

/** The signed-in member's preferences (B1.08). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMyPreferences(ctx);
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdatePreferencesSchema);
    return updateMyPreferences(ctx, body);
  });
}
