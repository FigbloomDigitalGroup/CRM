import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { seedOrganizationDefaults } from "../src/services/organizationDefaults";

/**
 * Upgrade step (G1.07, docs/MIGRATION_REHEARSAL.md): brings every EXISTING organization up to the current starting catalogue (lead sources,
 * statuses, pipeline stages, lost reasons, services, lifecycle states, qualification questions) by creating what is missing.
 *
 *   npx tsx scripts/backfill-organization-defaults.ts [organization slug]
 *
 * Nothing that already exists is changed, so a name, order or setting an organization edited stays as they left it. Safe to run twice.
 * Prints how many rows it added per organization.
 */
const TABLES = ["lead_sources", "lead_statuses", "pipeline_stages", "lost_reasons", "services", "customer_lifecycle_states", "custom_field_definitions"] as const;

async function counts(organizationId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = await adminDb.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, organizationId);
    out[table] = row!.n;
  }
  return out;
}

async function main() {
  const slug = process.argv[2];
  const orgs = await adminDb.organization.findMany({ where: slug ? { slug } : {}, select: { id: true, slug: true }, orderBy: { slug: "asc" } });
  if (slug && orgs.length === 0) throw new Error(`No organization with slug "${slug}".`);
  for (const org of orgs) {
    const before = await counts(org.id);
    await seedOrganizationDefaults(org.id, { fillOnly: true });
    const after = await counts(org.id);
    const added = TABLES.map((t) => [t, after[t]! - before[t]!] as const).filter(([, n]) => n > 0);
    console.log(`${org.slug}: ${added.length ? added.map(([t, n]) => `${n} ${t}`).join(", ") : "nothing to add"}`);
  }
  await adminDb.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
