import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/services/authService";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  if (!body.email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const result = await requestPasswordReset(
    body.email,
    (token) => `${origin}/reset-password?token=${token}`,
  );
  return NextResponse.json(result);
}
