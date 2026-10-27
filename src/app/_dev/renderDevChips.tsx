import { devAccountsAllowed, isDevAccountEmail } from "@/auth/devAccounts";
import { adminDb } from "@/db/adminClient";
import { DevChipsPanel, type DevChipAccount } from "./DevChipsPanel";

/** Order the chips the way the design lists the accounts. */
const ORDER = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"];

export async function renderDevChips() {
  if (!devAccountsAllowed()) return null;

  const users = await adminDb.user.findMany({
    where: { email: { endsWith: "@figbloom.local" } },
    include: { memberships: { include: { role: true } } },
    orderBy: { email: "asc" },
  });
  const platform = await adminDb.platformIdentity.findMany({ where: { isDev: true }, orderBy: { email: "asc" } });

  const tenant = users
    .filter((u) => isDevAccountEmail(u.email))
    .map((u) => {
      const role = u.memberships[0]?.role;
      return {
        email: u.email,
        name: u.name,
        roleName: role?.name ?? "No membership",
        note: role?.requiredFeature ? `behind flag ${role.requiredFeature}` : null,
        sort: role ? ORDER.indexOf(role.key) : ORDER.length,
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const accounts: DevChipAccount[] = [
    ...tenant.map(({ email, name, roleName, note }) => ({ email, name, roleName, note })),
    ...platform.map((p) => ({ email: p.email, name: p.name, roleName: "Platform Super Admin", note: "V1.1, dev only" })),
  ];

  // No seeded organisation, nothing to sign in to.
  if (accounts.length === 0) return null;
  return <DevChipsPanel accounts={accounts} />;
}
