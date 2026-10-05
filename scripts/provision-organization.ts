/**
 * Platform-admin tenant provisioning (FIG-604). Creates a new organization,
 * seeds it with FigBloom's default reference-data catalogs (lead sources,
 * statuses, pipeline stages, lifecycle states, lost reasons, services --
 * review/edit these under Settings before go-live, per
 * IMPLEMENTATION_NOTES.md), and invites the first admin through the real
 * accept-invite email flow. All the actual logic lives in
 * `src/services/organizationProvisioningService.ts` (so it's covered by
 * `tests/organizationProvisioningService.test.ts`) -- this file is just the
 * CLI argument-parsing wrapper, following the same convention as
 * `scripts/erase-data-subject.ts`.
 *
 * Usage:
 *   tsx scripts/provision-organization.ts \
 *     --name "Acme Ltd" --slug acme-ltd \
 *     --admin-email jane@acme.co.ke --admin-name "Jane Doe" \
 *     [--role MANAGEMENT]
 */
import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { provisionOrganization } from "../src/services/organizationProvisioningService";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    name: get("--name"),
    slug: get("--slug"),
    adminEmail: get("--admin-email"),
    adminName: get("--admin-name"),
    role: get("--role"),
  };
}

async function main(): Promise<void> {
  const { name, slug, adminEmail, adminName, role } = parseArgs(process.argv.slice(2));

  if (!name || !slug || !adminEmail || !adminName) {
    console.error(
      "Usage: tsx scripts/provision-organization.ts --name <name> --slug <slug> --admin-email <email> --admin-name <name> [--role MANAGEMENT|SALES|DELIVERY|FINANCE|RESTRICTED_TECHNICAL]",
    );
    process.exitCode = 1;
    return;
  }

  const result = await provisionOrganization({
    name,
    slug,
    adminEmail,
    adminName,
    adminRoleKey: role,
  });

  console.log(`Provisioned organization "${result.organizationSlug}" (${result.organizationId}).`);
  console.log("Default reference-data catalogs seeded -- review/edit them under Settings before go-live.");
  console.log(`Invited ${adminEmail} (membership ${result.adminMembershipId}).`);
  console.log(`Accept-invite link (sent by email, or logged above if no SMTP provider is configured):`);
  console.log(result.acceptUrl);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
