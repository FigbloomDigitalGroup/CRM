import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { getMemberAccess, setMemberAccess } from "@/services/memberAccessService";

// UC-C5 step 3 (FIG-1790): per-member permission overrides. PUT replaces the whole set, so it is idempotent.
const MemberAccessSchema = z.strictObject({
  grant: z.array(z.string().min(1).max(120)).max(300).default([]),
  deny: z.array(z.string().min(1).max(120)).max(300).default([]),
});

type Params = { params: Promise<{ orgSlug: string; membershipId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    return getMemberAccess(await resolveGatedContext(orgSlug, "release.v2"), membershipId);
  });
}

export async function PUT(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    return setMemberAccess(ctx, membershipId, await parseJsonBody(request, MemberAccessSchema));
  });
}
