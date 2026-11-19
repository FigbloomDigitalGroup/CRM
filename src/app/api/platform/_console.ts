import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/auth/errors";
import { consoleSecretMatches } from "@/services/platformConsoleService";
import { platformLinkEnabled } from "@/services/platformLinkService";

/**
 * The console's door into CRM (ERP/CRM_PLATFORM_CONTRACT.md): absent (404) while the link is off, and only for the
 * console's server, which sends `x-platform-secret`. A browser session gets nothing here.
 */
export function consoleGate(request: Request): NextResponse | null {
  if (!platformLinkEnabled()) return NextResponse.json({ error: "Not found", code: "NOT_FOUND", message: "Not found", fieldErrors: [] }, { status: 404 });
  if (!consoleSecretMatches(request.headers.get("x-platform-secret"))) throw new UnauthorizedError("The console's secret is missing or wrong.");
  return null;
}
