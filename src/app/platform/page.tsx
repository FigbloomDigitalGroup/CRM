import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BrandMark } from "@/app/_shared/BrandMark";
import { resolveDevPlatformIdentity } from "@/auth/platformIdentity";
import { PlatformSignOut } from "./PlatformSignOut";

/**
 * The Platform Super Admin's landing (FIG-1196, B0.09). The console itself
 * (PL1 to PL15) arrives in V1.1, so signing in with the dev Super Admin shows
 * this holding page rather than a tenant view. It is a 404 for everyone else:
 * without a dev platform session (development + ALLOW_DEV_ACCOUNTS=true) there
 * is no such page, and in production there is no platform sign-in yet.
 */
export default async function PlatformHoldingPage() {
  const identity = await resolveDevPlatformIdentity(await cookies());
  if (!identity) notFound();

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Platform console arrives in V1.1</h1>
        <p>
          Signed in as <strong>{identity.name}</strong> ({identity.email}), the
          dev-only Platform Super Admin. This account belongs to the platform,
          not to any organization, so it has no tenant view and cannot open an
          organization&rsquo;s data.
        </p>
        <p className="warning">
          Development only. This account never exists in production.
        </p>
        <PlatformSignOut />
      </div>
    </div>
  );
}
