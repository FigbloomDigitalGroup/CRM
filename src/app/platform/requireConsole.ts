import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { resolvePlatformContext } from "@/auth/platformSession";

/**
 * The only door into the console (FIG-1160). It accepts a platform session (B6.03), or the dev Super Admin's session where dev accounts are allowed
 * (never in production). Anyone else, an organisation user included, gets the ordinary 404, so the address gives nothing away (PL15). Platform admins sign in at /platform/sign-in.
 */
export async function requireConsole() {
  const identity = await resolvePlatformContext(await cookies());
  if (!identity || !identity.permissions.has("platform.console.view")) notFound();
  return { name: identity.name, email: identity.email };
}
