import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { removeMyAvatar, setMyAvatar } from "@/services/profileService";

const SetAvatarSchema = z.strictObject({
  fileId: z.string({ error: "The uploaded picture is required." }),
  crop: z
    .strictObject({
      x: z.number({ error: "The crop needs an x position." }),
      y: z.number({ error: "The crop needs a y position." }),
      size: z.number({ error: "The crop needs a size." }),
    })
    .nullable()
    .optional(),
});

/**
 * Use an uploaded picture (upload it with purpose AVATAR first). The server
 * crops, resizes and re-encodes it; the original is deleted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SetAvatarSchema);
    return setMyAvatar(ctx, body);
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return removeMyAvatar(ctx);
  });
}
