import Image from "next/image";
import { adminDb } from "@/db/adminClient";
import { DevLoginForm } from "./DevLoginForm";

export default async function DevLoginPage() {
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
          Placeholder login for local development (FIG-439) -- picks a seeded
          dev user with no password check. Real authentication is separate,
          not-yet-scheduled work (FIG-437 leaves the auth provider choice
          open). Do not build on this beyond exercising permission logic
          locally.
        </p>
        <DevLoginForm options={options} />
      </div>
    </div>
  );
}
