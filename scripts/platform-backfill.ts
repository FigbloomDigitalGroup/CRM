/**
 * Registers every existing CRM organisation with the Figbloom platform once (ERP/CRM_PLATFORM_CONTRACT.md), copying
 * its status (ACTIVE -> active, SUSPENDED or INACTIVE -> suspended). Dry run by default: it lists what it would send.
 * Running it again is harmless (registered organisations are only renamed if their name changed).
 *
 *   npx tsx scripts/platform-backfill.ts            # dry run
 *   npx tsx scripts/platform-backfill.ts --apply
 */
import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { ORGANIZATION, platformLinkEnabled, queueOrganization, runPlatformSync } from "../src/services/platformLinkService";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!platformLinkEnabled()) throw new Error("PLATFORM_LINK_ENABLED is not true: nothing to do.");
  const orgs = await adminDb.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true, status: true } });
  const links = new Set(
    (await adminDb.platformLink.findMany({ where: { entityKind: ORGANIZATION }, select: { localId: true } })).map((l) => l.localId),
  );
  for (const o of orgs) console.log(`${links.has(o.id) ? "linked " : "new    "} ${o.slug} (${o.status}) ${o.name}`);
  if (!apply) {
    console.log(`\n${orgs.length} organisation(s). Dry run: nothing sent. Run again with --apply.`);
    return;
  }
  for (const o of orgs) await queueOrganization(o.id);
  const r = await runPlatformSync();
  console.log(`\nSent ${r.sent}; ${r.failed} still waiting (retried by npm run platform:sync).`);
  if (r.failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
