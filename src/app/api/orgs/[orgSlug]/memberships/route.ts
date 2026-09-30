import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { inviteMember, listMemberships } from "@/services/membershipService";

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
    const body = (await request.json()) as {
      email?: string;
      name?: string;
      roleKey?: string;
    };
    if (!body.email || !body.name || !body.roleKey) {
      throw new ValidationError("email, name, and roleKey are required.");
    }

    const origin = new URL(request.url).origin;
    return inviteMember(
      ctx,
      { email: body.email, name: body.name, roleKey: body.roleKey },
      (token) => `${origin}/accept-invite?token=${token}`,
    );
  });
}
