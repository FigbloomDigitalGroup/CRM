import Image from "next/image";
import { adminDb } from "@/db/adminClient";
import { LoginForm } from "./LoginForm";

/**
 * Quick-login accounts are the seeded @figbloom.local fixtures (same query
 * as /dev-login), offered here too -- but selecting one still goes through
 * the real /api/auth/login bcrypt check, not the dev-session bypass. Local
 * development only: the query (and the section) don't run in production.
 */
async function getDevAccounts() {
  if (process.env.NODE_ENV === "production") return [];

  const devUsers = await adminDb.user.findMany({
    where: { email: { endsWith: "@figbloom.local" } },
    include: { memberships: { include: { role: true } } },
    orderBy: { email: "asc" },
  });

  return devUsers.map((u) => ({
    email: u.email,
    name: u.name,
    roleName: u.memberships[0]?.role.name ?? "No membership",
  }));
}

export default async function LoginPage() {
  const devAccounts = await getDevAccounts();

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <Image src="/figbloom-logo.jpg" alt="" width={40} height={40} priority />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Log in</h1>
        <LoginForm devAccounts={devAccounts} />
        <p className="warning">
          <a href="/forgot-password">Forgot your password?</a>
        </p>
        <p className="warning">
          No account yet? <a href="/signup">Sign up</a>
        </p>
      </div>
    </div>
  );
}
