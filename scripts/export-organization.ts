/**
 * Whole-organization data export (FIG-604 AC3, per FIG-444 §12 "Export &
 * Pilot Exit" -- "no dedicated export feature exists anywhere in the
 * codebase today"). One CSV file per entity type, every row scoped to a
 * single `organizationId`, written to a local output directory.
 *
 * Deliberately NOT the same thing as the per-record exports in
 * `exportService.ts` (those are role-permission-gated, resolve FK ids to
 * display names, and mask deal value for roles without
 * `deals.view.value`): this is a platform/admin operation with no
 * authenticated caller and no masking -- the whole point is to hand the
 * tenant back everything, unmasked, as part of offboarding. See
 * `docs/TENANT_OFFBOARDING.md` for the full procedure this script is one
 * step of, and `scripts/erase-data-subject.ts` for the precedent this
 * follows (standalone script, runs through `withOrgContext`/RLS via the
 * per-entity repository functions, not the schema-owner connection).
 *
 * Includes archived/soft-deleted records (`includeArchived: true`) -- an
 * offboarding export should be complete, not just what's currently visible
 * in the product's default list views.
 *
 * Usage:
 *   tsx scripts/export-organization.ts --org <slug> [--out <directory>]
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { stringify } from "csv-stringify/sync";
import { adminDb } from "../src/db/adminClient";
import { recordAuditEvent } from "../src/repositories/auditEvents";
import { listActivities } from "../src/repositories/activities";
import { listCommunications } from "../src/repositories/communications";
import { listCompanies } from "../src/repositories/companies";
import { listContacts } from "../src/repositories/contacts";
import { listDeals } from "../src/repositories/deals";
import { listLeads } from "../src/repositories/leads";
import { listTasks } from "../src/repositories/tasks";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return { orgSlug: get("--org"), outDir: get("--out") };
}

/** Generic Prisma-row -> CSV-row serializer: dates to ISO strings, Decimal to plain numbers, nested JSON (e.g. Lead.qualificationData) stringified, null/undefined to blank. No column list to maintain per entity, at the cost of raw FK ids instead of resolved names -- acceptable for a full data handoff, unlike a human-facing report. */
function toCsvRow(record: Record<string, unknown>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) {
      row[key] = "";
    } else if (value instanceof Date) {
      row[key] = value.toISOString();
    } else if (value instanceof Prisma.Decimal) {
      row[key] = value.toString();
    } else if (typeof value === "object") {
      row[key] = JSON.stringify(value);
    } else {
      row[key] = String(value);
    }
  }
  return row;
}

async function writeEntityCsv(
  outDir: string,
  entityName: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  const csvRows = rows.map(toCsvRow);
  const csv = csvRows.length > 0 ? stringify(csvRows, { header: true }) : "";
  await writeFile(path.join(outDir, `${entityName}.csv`), csv, "utf8");
  return rows.length;
}

async function main(): Promise<void> {
  const { orgSlug, outDir: outDirArg } = parseArgs(process.argv.slice(2));
  if (!orgSlug) {
    console.error("Usage: tsx scripts/export-organization.ts --org <slug> [--out <directory>]");
    process.exitCode = 1;
    return;
  }

  const org = await adminDb.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    throw new Error(`No organization with slug "${orgSlug}".`);
  }

  const outDir =
    outDirArg ?? path.join(process.cwd(), "exports", `${orgSlug}-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const [companies, contacts, leads, deals, activities, tasks, communications] =
    await Promise.all([
      listCompanies(org.id, { includeArchived: true }),
      listContacts(org.id, { includeArchived: true }),
      listLeads(org.id, { includeArchived: true }),
      listDeals(org.id, { includeArchived: true }),
      listActivities(org.id, {}),
      listTasks(org.id, {}),
      listCommunications(org.id, {}),
    ]);

  const counts = {
    companies: await writeEntityCsv(outDir, "companies", companies),
    contacts: await writeEntityCsv(outDir, "contacts", contacts),
    leads: await writeEntityCsv(outDir, "leads", leads),
    deals: await writeEntityCsv(outDir, "deals", deals),
    activities: await writeEntityCsv(outDir, "activities", activities),
    tasks: await writeEntityCsv(outDir, "tasks", tasks),
    communications: await writeEntityCsv(outDir, "communications", communications),
  };

  await recordAuditEvent({
    organizationId: org.id,
    action: "organization.exported",
    entityType: "Organization",
    entityId: org.id,
    metadata: { outDir, counts },
  });

  console.log(`Exported organization "${orgSlug}" to ${outDir}:`);
  for (const [entity, count] of Object.entries(counts)) {
    console.log(`  ${entity}: ${count}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
