import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import {
  createSessionCookieValue,
  DEV_SESSION_COOKIE_NAME,
} from "@/auth/devSession";
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
 * disables it.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const body = await parseJsonBody(request, DevSessionSchema);
    const user = await adminDb.user.findUnique({ where: { email: body.email } });
    if (!user) {
      return NextResponse.json({ error: "No such user." }, { status: 404 });
    }

    const response = NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
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
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DEV_SESSION_COOKIE_NAME);
  return response;
}
