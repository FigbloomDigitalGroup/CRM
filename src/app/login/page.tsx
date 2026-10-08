import { adminDb } from "@/db/adminClient";
import { LoginForm } from "./LoginForm";
import { LoginHero } from "./LoginHero";

/**
 * Quick-login accounts are the seeded @figbloom.local fixtures (same query
 * as /dev-login), offered here too -- but selecting one still goes through
 * the real /api/auth/login bcrypt check, not the dev-session bypass. Local
 * development only: the query (and the section) don't run in production,
 * or when HIDE_DEV_LOGIN_ACCOUNTS=true (e.g. a demo/staging run of `next
 * dev` where NODE_ENV is still "development" but the list shouldn't show).
 */
async function getDevAccounts() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.HIDE_DEV_LOGIN_ACCOUNTS === "true"
  ) {
    return [];
  }

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
    <div className="lg-page">
      <LoginHero />
      <main className="lg-right">
        <LoginForm devAccounts={devAccounts} />
        <div className="lg-rf">
          Protected by role-based access &middot; Figbloom Digital Group
        </div>
      </main>
    </div>
  );
}
