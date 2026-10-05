/**
 * Tenant offboarding (FIG-604 AC3, per FIG-444 §12 "Export & Pilot Exit").
 * Revokes access -- deactivates every active membership and marks the
 * organization INACTIVE -- without deleting any business data. Run
 * `scripts/export-organization.ts` FIRST if the tenant needs their data
 * handed back; this script never deletes anything, but offboarding and
 * export are two separate, independent steps (see
 * `docs/TENANT_OFFBOARDING.md`), and this one on its own leaves the data
 * retained, not exported anywhere.
 *
 * Dry run by default -- nothing changes without --confirm, same convention
 * as `scripts/erase-data-subject.ts`.
 *
 * Usage:
 *   tsx scripts/offboard-organization.ts --org <slug>
 *   tsx scripts/offboard-organization.ts --org <slug> --confirm
 */
import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { recordAuditEvent } from "../src/repositories/auditEvents";
import { deactivateMembership } from "../src/repositories/memberships";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return { orgSlug: get("--org"), confirm: argv.includes("--confirm") };
}

async function main(): Promise<void> {
  const { orgSlug, confirm } = parseArgs(process.argv.slice(2));
  if (!orgSlug) {
    console.error("Usage: tsx scripts/offboard-organization.ts --org <slug> [--confirm]");
    process.exitCode = 1;
    return;
  }

  const org = await adminDb.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    throw new Error(`No organization with slug "${orgSlug}".`);
  }
  if (org.status === "INACTIVE") {
    console.log(`Organization "${orgSlug}" is already INACTIVE.`);
    return;
  }

  const activeMemberships = await adminDb.membership.findMany({
    where: { organizationId: org.id, status: "ACTIVE" },
    include: { user: true },
  });

  console.log(`Organization: ${org.name} (${orgSlug}), status ${org.status}.`);
  console.log(`Will deactivate ${activeMemberships.length} active membership(s):`);
  for (const m of activeMemberships) {
    console.log(`  - ${m.user.name} <${m.user.email}>`);
  }
  console.log("Will mark the organization INACTIVE. No business data is deleted.");

  if (!confirm) {
    console.log("\nDry run only -- re-run with --confirm to actually offboard.");
    return;
  }

  for (const m of activeMemberships) {
    await deactivateMembership(m.id);
  }
  await adminDb.organization.update({
    where: { id: org.id },
    data: { status: "INACTIVE" },
  });

  await recordAuditEvent({
    organizationId: org.id,
    action: "organization.offboarded",
    entityType: "Organization",
    entityId: org.id,
    metadata: { deactivatedMemberships: activeMemberships.map((m) => m.id) },
  });

  console.log(`Offboarded "${orgSlug}": ${activeMemberships.length} membership(s) deactivated, organization marked INACTIVE.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
