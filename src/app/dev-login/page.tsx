import Image from "next/image";
import { notFound } from "next/navigation";
import { adminDb } from "@/db/adminClient";
import { DevLoginForm } from "./DevLoginForm";

export default async function DevLoginPage() {
  // Enabled ONLY when NODE_ENV is explicitly "development" (FIG-605) --
  // see src/app/api/dev-session/route.ts for why "!== production" wasn't
  // safe enough.
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const devUsers = await adminDb.user.findMany({
    where: { email: { endsWith: "@figbloom.local" } },
    include: { memberships: { include: { role: true } } },
    orderBy: { email: "asc" },
  });

  const options = devUsers.map((u) => ({
    email: u.email,
    name: u.name,
    roleName: u.memberships[0]?.role.name ?? "No membership",
  }));

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <Image src="/figbloom-logo.jpg" alt="" width={40} height={40} priority />
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
