import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientInfo } from "@/app/api/_lib/clientRequest";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { setSessionCookie } from "@/app/api/_lib/sessionCookie";
import { signup } from "@/services/authService";

const SignupSchema = z.object({
  email: requiredString("Name, email and password are required."),
  password: requiredString("Name, email and password are required."),
  name: requiredString("Name, email and password are required."),
});

/**
 * Creates an account and signs the caller straight in -- see
 * authService.ts#signup for why this grants no organization access on its
 * own. Body: { "email": "...", "password": "...", "name": "..." }.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request, SignupSchema);
    const client = getClientInfo(request);
    const { token, expiresAt, userId, access } = await signup(
      body.email,
      body.password,
      body.name,
      client.userAgent,
      client.ipAddress,
      client.place,
    );

    const response = NextResponse.json({ userId, awaitingAccess: access.awaitingAccess, access });
    setSessionCookie(response, token, expiresAt);
    return response;
  });
}
