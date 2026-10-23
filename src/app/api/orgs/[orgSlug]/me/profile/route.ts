import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMyProfile, updateMyProfile } from "@/services/profileService";

const UpdateMyProfileSchema = z.strictObject({
  name: z.string({ error: "Your name must be text." }).optional(),
  phone: z.string({ error: "The phone number must be text." }).nullable().optional(),
  timeZone: z.string({ error: "The time zone must be text." }).nullable().optional(),
});

/** The signed-in person's own profile: name, phone, time zone and picture (B1.06). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMyProfile(ctx);
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateMyProfileSchema);
    return updateMyProfile(ctx, body);
  });
}
