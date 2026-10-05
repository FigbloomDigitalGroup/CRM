import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { inviteMember, listMemberships } from "@/services/membershipService";

const InviteMemberSchema = z.object({
  email: requiredString("email, name, and roleKey are required."),
  name: requiredString("email, name, and roleKey are required."),
  roleKey: requiredString("email, name, and roleKey are required."),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listMemberships(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, InviteMemberSchema);

    const origin = new URL(request.url).origin;
    return inviteMember(
      ctx,
      body,
      (token) => `${origin}/accept-invite?token=${token}`,
    );
  });
}
