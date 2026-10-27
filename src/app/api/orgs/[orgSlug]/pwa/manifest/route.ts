import { NextResponse } from "next/server";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPwaManifest } from "@/services/pwaService";

// The web app manifest for this organisation: its name and colours, so "Add to home screen" installs its own CRM (FIG-1064, S3).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return NextResponse.json(await getPwaManifest(ctx), { headers: { "Content-Type": "application/manifest+json" } });
  });
}
