import { NextResponse } from "next/server";
import { ValidationError } from "@/auth/errors";
import { logger } from "@/lib/logger";
import { resetPassword } from "@/services/authService";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    newPassword?: string;
  };
  if (!body.token || !body.newPassword) {
    return NextResponse.json(
      { error: "Token and newPassword are required." },
      { status: 400 },
    );
  }

  try {
    await resetPassword(body.token, body.newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error({ err }, "Unhandled error confirming password reset");
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
