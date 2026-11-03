import { devAccountsAllowed, isDevAccountEmail, previewChipsAllowed } from "@/auth/devAccounts";
import { adminDb } from "@/db/adminClient";
import { DevChipsPanel, type DevChipAccount } from "./DevChipsPanel";

/** Order the chips the way the design lists the accounts. */
const ORDER = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"];

export async function renderDevChips() {
  const preview = !devAccountsAllowed() && previewChipsAllowed();
  if (!devAccountsAllowed() && !preview) return null;

  const users = await adminDb.user.findMany({
    where: { email: { endsWith: "@figbloom.local" } },
    include: { memberships: { include: { role: true } } },
    orderBy: { email: "asc" },
  });
  // The dev Super Admin signs in through the no-password dev route. Outside development that route is open only for this identity and only in the
  // preview build (Given, 2 Nov 2026; CLAUDE.md rule 10); tenant users in the preview sign in through the real password login.
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
    ...platform.map((p) => ({ email: p.email, name: p.name, roleName: "Platform Super Admin", note: "V1.1, dev only", platform: true as const })),
  ];

  // No seeded organisation, nothing to sign in to.
  if (accounts.length === 0) return null;
  return <DevChipsPanel accounts={accounts} viaPassword={preview} />;
}
