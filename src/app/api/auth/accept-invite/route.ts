import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { setPendingTwoStepCookie } from "@/app/api/_lib/twoStepCookies";
import { TRUSTED_DEVICE_COOKIE_NAME } from "@/services/twoStepService";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { limitInviteAccept } from "@/auth/publicLimits";
import { acceptMembershipInvite } from "@/services/authService";

const AcceptInviteSchema = z.object({
  token: requiredString("token is required."),
  // Only required when the invitee has no password yet -- a business rule
  // checked in authService.ts, not a shape rule enforceable here.
  password: z.string().optional(),
});

export async function POST(request: Request) {
  return handleRoute(async () => {
    const client = getClientInfo(request);
    await limitInviteAccept(client.ipAddress);
    const body = await parseJsonBody(request, AcceptInviteSchema);
    const trusted = (await cookies()).get(TRUSTED_DEVICE_COOKIE_NAME)?.value;
    const result = await acceptMembershipInvite(
      body.token,
      body.password,
      client.userAgent,
      client.ipAddress,
      client.place,
      trusted,
    );

    if ("twoStepRequired" in result) {
      // Same handoff as password sign-in: no session until the second step is done.
      const pending = NextResponse.json({
        userId: result.userId,
        organizationSlug: result.organizationSlug,
        twoStepRequired: true,
        twoStepPurpose: result.purpose,
        twoStepUrl: "/two-step",
      });
      setPendingTwoStepCookie(pending, result.challengeToken, result.challengeExpiresAt);
      return pending;
    }
    const { token, expiresAt, userId, organizationSlug } = result;

    const response = NextResponse.json({ userId, organizationSlug });
    setSessionCookie(response, token, expiresAt);
    return response;
  });
}
