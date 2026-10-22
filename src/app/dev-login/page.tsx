import { BrandMark } from "@/app/_shared/BrandMark";
import { notFound } from "next/navigation";
import { devAccountsAllowed, isDevAccountEmail } from "@/auth/devAccounts";
import { adminDb } from "@/db/adminClient";
import { DevLoginForm } from "./DevLoginForm";

export default async function DevLoginPage() {
  // Enabled ONLY when NODE_ENV is explicitly "development" (FIG-605) and
  // ALLOW_DEV_ACCOUNTS=true (FIG-1196) -- see src/auth/devAccounts.ts and
  // src/app/api/dev-session/route.ts for why "!== production" was not safe
  // enough.
  if (!devAccountsAllowed()) {
    notFound();
  }

  const devUsers = await adminDb.user.findMany({
    where: { email: { endsWith: "@figbloom.local" } },
    include: { memberships: { include: { role: true } } },
    orderBy: { email: "asc" },
  });
  const platformIdentities = await adminDb.platformIdentity.findMany({
    where: { isDev: true },
    orderBy: { email: "asc" },
  });

  const options = [
    ...devUsers
      .filter((u) => isDevAccountEmail(u.email))
      .map((u) => ({
        email: u.email,
        name: u.name,
        roleName: u.memberships[0]?.role.name ?? "No membership",
      })),
    ...platformIdentities.map((p) => ({
      email: p.email,
      name: p.name,
      roleName: "Platform Super Admin",
    })),
  ];

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Dev login</h1>
        <p className="warning">
          Placeholder login for local development -- picks a seeded dev user
          with no password check. Unavailable outside local development; use{" "}
          <a href="/login">/login</a> to sign in with real credentials.
        </p>
        <DevLoginForm options={options} />
      </div>
    </div>
  );
}
