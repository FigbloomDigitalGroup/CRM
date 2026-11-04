import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { resolvePlatformContext } from "@/auth/platformSession";
import { demoScreensEnabled } from "@/ui/demo/enabled";

/**
 * The only door into the console (FIG-1160). It accepts a platform session (B6.03) or the dev Super Admin's session (development with ALLOW_DEV_ACCOUNTS=true), and only where demo screens are on. Anyone else, an organisation user included, gets the
 * ordinary 404, so the address gives nothing away (PL15).
 */
export async function requireConsole() {
  if (!demoScreensEnabled()) notFound();
  const identity = await resolvePlatformContext(await cookies());
  if (!identity || !identity.permissions.has("platform.console.view")) notFound();
  return { name: identity.name, email: identity.email };
}
