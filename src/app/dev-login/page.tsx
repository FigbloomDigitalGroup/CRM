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
    <div className="page">
      <h1>FigBloom CRM -- Dev Login</h1>
      <p className="warning">
        This is a placeholder login for local development (FIG-439). It picks
        one of the seeded dev users with no password check -- real
        authentication is a separate, not-yet-scheduled piece of work (FIG-437
        leaves the auth provider choice open). Do not build on this for anything
        beyond exercising permission logic locally.
      </p>
      <DevLoginForm options={options} />
    </div>
  );
}
