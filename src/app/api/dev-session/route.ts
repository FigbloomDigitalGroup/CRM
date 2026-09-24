import { NextResponse } from "next/server";
import {
  createSessionCookieValue,
  DEV_SESSION_COOKIE_NAME,
} from "@/auth/devSession";
import { adminDb } from "@/db/adminClient";

/**
 * Dev-only placeholder login (see src/auth/devSession.ts for why this is
 * not the FIG-437 authentication implementation). Body: { "email": "..." }.
 * No password check -- this only exists so FIG-439's permission/ownership
 * logic can be exercised through real requests before real auth exists.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string };
  if (!body.email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

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
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DEV_SESSION_COOKIE_NAME);
  return response;
}
