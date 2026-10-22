import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { devAccountsAllowed } from "@/auth/devAccounts";
import {
  createPlatformCookieValue,
  createSessionCookieValue,
  DEV_PLATFORM_COOKIE_NAME,
  DEV_SESSION_COOKIE_NAME,
} from "@/auth/devSession";
import {
  findDevPlatformIdentityByEmail,
  recordDevPlatformSignIn,
} from "@/auth/platformIdentity";
import { adminDb } from "@/db/adminClient";

const DevSessionSchema = z.object({
  email: requiredString("email is required."),
});

/**
 * Dev-only placeholder login (see src/auth/devSession.ts for why this isn't
 * real auth). Body: { "email": "..." }. No password check -- exists only so
 * permission/ownership logic can be exercised through real requests.
 * Enabled ONLY when NODE_ENV is explicitly "development" (FIG-605) -- it
 * used to disable itself only for NODE_ENV === "production", which left it
 * silently live on staging, test, or any deploy that simply left NODE_ENV
 * unset. Fail-closed by default: anything other than exactly "development"
 * disables it. Since FIG-1196 it also needs ALLOW_DEV_ACCOUNTS=true
 * (`devAccountsAllowed`), and it signs in the dev Super Admin (a platform
 * identity, not a tenant user) when the email names one: that sets a
 * separate cookie, audits the sign-in, and lands on /platform.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    if (!devAccountsAllowed()) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const body = await parseJsonBody(request, DevSessionSchema);

    const platform = await findDevPlatformIdentityByEmail(body.email);
    if (platform) {
      await recordDevPlatformSignIn(platform);
      const response = NextResponse.json({
        id: platform.id,
        email: platform.email,
        name: platform.name,
        platform: true,
        landing: "/platform",
      });
      response.cookies.set(
        DEV_PLATFORM_COOKIE_NAME,
        createPlatformCookieValue(platform.id),
        { httpOnly: true, sameSite: "lax", path: "/" },
      );
      return response;
    }

    const user = await adminDb.user.findUnique({ where: { email: body.email } });
    if (!user) {
      return NextResponse.json({ error: "No such user." }, { status: 404 });
    }

    const response = NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      platform: false,
      landing: "/o/figbloom",
    });
    response.cookies.set(
      DEV_SESSION_COOKIE_NAME,
      createSessionCookieValue(user.id),
      {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    );
    return response;
  });
}

export async function DELETE() {
  if (!devAccountsAllowed()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DEV_SESSION_COOKIE_NAME);
  response.cookies.delete(DEV_PLATFORM_COOKIE_NAME);
  return response;
}
