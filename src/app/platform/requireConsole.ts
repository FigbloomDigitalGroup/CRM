import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { resolveDevPlatformIdentity } from "@/auth/platformIdentity";
import { demoScreensEnabled } from "@/ui/demo/enabled";

/**
 * The only door into the console (FIG-1160). Until the real Platform sign-in exists (B6.03) the console is reachable only with the dev Super Admin's
 * session (development with ALLOW_DEV_ACCOUNTS=true) and only where demo screens are on. Anyone else, an organisation user included, gets the
 * ordinary 404, so the address gives nothing away (PL15).
 */
export async function requireConsole() {
  if (!demoScreensEnabled()) notFound();
  const identity = await resolveDevPlatformIdentity(await cookies());
  if (!identity) notFound();
  return { name: identity.name, email: identity.email };
}
