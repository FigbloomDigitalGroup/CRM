import { NextResponse } from "next/server";
import {
  applyPlatformDecision,
  platformLinkEnabled,
  UnknownOrganizationError,
  verifyPlatformSignature,
  type PlatformDecision,
} from "@/services/platformLinkService";

export const dynamic = "force-dynamic";

const answer = (status: number, code: string, message: string) => NextResponse.json({ error: message, code, message, fieldErrors: [] }, { status });

/**
 * The platform's decision webhook (ERP/CRM_PLATFORM_CONTRACT.md): the console suspended or reactivated an
 * organisation. Signed by the platform (HMAC-SHA256 over "<timestamp>.<raw body>", PLATFORM_WEBHOOK_SECRET). A 4xx
 * tells the platform not to send the same bytes again; a 5xx asks it to retry.
 */
export async function POST(request: Request) {
  if (!platformLinkEnabled()) return answer(404, "NOT_FOUND", "Not found");
  const raw = await request.text();
  const ok = verifyPlatformSignature(
    process.env.PLATFORM_WEBHOOK_SECRET ?? "",
    raw,
    request.headers.get("x-figbloom-signature"),
    request.headers.get("x-figbloom-timestamp"),
  );
  if (!ok) return answer(401, "UNAUTHORIZED", "Bad or missing signature.");
  const deliveryId = request.headers.get("x-figbloom-delivery");
  if (!deliveryId) return answer(400, "VALIDATION_FAILED", "x-figbloom-delivery is missing.");

  let decision: PlatformDecision;
  try {
    decision = JSON.parse(raw) as PlatformDecision;
    if (typeof decision?.organization?.local_id !== "string" || typeof decision.organization.id !== "string") throw new Error();
  } catch {
    return answer(400, "VALIDATION_FAILED", "Not a decision.");
  }
  try {
    const result = await applyPlatformDecision(deliveryId, decision);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof UnknownOrganizationError) return answer(404, "NOT_FOUND", err.message);
    console.error("[platform-decisions] could not apply:", err instanceof Error ? err.message : err);
    return answer(500, "INTERNAL", "Could not apply the decision; the platform will retry.");
  }
}
