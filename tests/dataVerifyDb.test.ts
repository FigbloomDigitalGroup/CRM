import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { APP_ROLE_CLOSED_TABLES, APP_ROLE_COLUMN_LIMITED_TABLES } from "../scripts/lib/appRoleRestrictedTables";
import { diffFingerprints, evaluateDuplicates, evaluateFinancials, evaluateRelations, flattenCustomFields, flattenFinancials } from "../scripts/lib/dataVerify";
import {
  bypassesRls,
  gatherCustomFields,
  gatherDuplicates,
  gatherFinancials,
  gatherForeignKeys,
  inspectLocalFiles,
  type FileRow,
} from "../scripts/lib/dataVerifyDb";
import { commercialWorld } from "./commercialFixtures";

// UC-F7: the verify-* readers against a real database. Money, orphans, duplicates and custom fields are created for real, then changed inside a
// transaction that is rolled back, to show each check can fail and that a one-cent change is seen. Files use a temporary directory.

let c: Client;
let w: Awaited<ReturnType<typeof commercialWorld>>;
let invoiceA: { id: string };
let paymentActive: { id: string };

const key = (org: string) => `${org}|KES`;
async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

beforeAll(async () => {
  c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  w = await commercialWorld();
  const day = new Date("2026-11-01");
  invoiceA = await adminDb.invoice.create({
    data: { organizationId: w.org.id, dealId: w.deal.id, companyId: w.company.id, number: "UCF7-A", amount: "1000.00", issuedOn: day, dueOn: day, status: "SENT" },
  });
  await adminDb.invoice.create({
    data: { organizationId: w.org.id, companyId: w.company.id, number: "UCF7-B", amount: "500.00", issuedOn: day, dueOn: day, status: "VOID", voidedAt: new Date(), voidReason: "test" },
  });
  paymentActive = await adminDb.paymentRecord.create({ data: { organizationId: w.org.id, invoiceId: invoiceA.id, amount: "400.00", paidOn: day } });
  await adminDb.paymentRecord.create({ data: { organizationId: w.org.id, invoiceId: invoiceA.id, amount: "100.00", paidOn: day, reversedAt: new Date(), reversalReason: "test" } });
});

afterAll(async () => {
  await c?.end().catch(() => undefined);
});

describe("the owner connection (UC-F7)", () => {
  it("bypasses row-level security, so the counts are complete", async () => {
    expect(await bypassesRls(c)).toBe(true);
  });
});

describe("verify-financials reads (UC-F7)", () => {
  it("adds up invoices, payments, reversals, outstanding and deal values for the organisation, to the cent", async () => {
    const g = (await gatherFinancials(c)).groups[key(w.org.id)];
    expect(g).toMatchObject({
      invoices: 2,
      invoicesVoid: 1,
      invoiceAmount: "1000.00",
      invoiceAmountVoid: "500.00",
      payments: 2,
      paymentAmount: "400.00",
      paymentsReversed: 1,
      paymentAmountReversed: "100.00",
      outstanding: "600.00",
      dealsOpen: 1,
      dealValueOpen: "540000.00",
    });
  });

  it("hashes every row of every money table, per organisation", async () => {
    const s = await gatherFinancials(c);
    for (const t of ["invoices", "payment_records", "deals"]) expect(s.tableHashes[t]?.[w.org.id]?.rows).toBeGreaterThan(0);
    expect(s.tableHashes.invoices[w.org.id].rows).toBe(2);
    expect(s.tableHashes.payment_records[w.org.id].rows).toBe(2);
  });

  it("is stable between two reads and the data is consistent", async () => {
    const a = flattenFinancials(await gatherFinancials(c));
    const b = flattenFinancials(await gatherFinancials(c));
    expect(diffFingerprints(a, b)).toEqual({ changed: [], missing: [], added: [] });
    expect(evaluateFinancials(await gatherFinancials(c), true, a).ok).toBe(true);
  });

  it("sees a ONE-CENT change in a single invoice, in the total and in the row hash, and the change is gone after the rollback", async () => {
    const before = flattenFinancials(await gatherFinancials(c));
    const during = await inTx(async () => {
      await c.query(`UPDATE invoices SET amount = amount + 0.01 WHERE id = $1`, [invoiceA.id]);
      return evaluateFinancials(await gatherFinancials(c), true, before);
    });
    expect(during.ok).toBe(false);
    const detail = during.checks.find((x) => x.name.startsWith("Totals"))?.detail ?? "";
    expect(detail).toContain("invoiceAmount");
    expect(detail).toContain(`hash|invoices|${w.org.id}`);
    expect(diffFingerprints(before, flattenFinancials(await gatherFinancials(c))).changed).toEqual([]);
  });

  it("sees a row that changed with every total unchanged (the hash covers the whole row)", async () => {
    const before = flattenFinancials(await gatherFinancials(c));
    const diff = await inTx(async () => {
      await c.query(`UPDATE invoices SET notes = 'edited' WHERE id = $1`, [invoiceA.id]);
      return diffFingerprints(before, flattenFinancials(await gatherFinancials(c)));
    });
    expect(diff.changed).toEqual([`hash|invoices|${w.org.id}`]);
  });

  it("flags an overpayment and a payment with no invoice", async () => {
    const base = (await gatherFinancials(c)).inconsistencies;
    const over = await inTx(async () => {
      await c.query(`UPDATE payment_records SET amount = 5000 WHERE id = $1`, [paymentActive.id]);
      return (await gatherFinancials(c)).inconsistencies;
    });
    expect(over.overpaid).toBe(base.overpaid + 1);
    const orphan = await inTx(async () => {
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(`UPDATE payment_records SET invoice_id = $2 WHERE id = $1`, [paymentActive.id, randomUUID()]);
      return (await gatherFinancials(c)).inconsistencies;
    });
    expect(orphan.paymentsWithoutInvoice).toBe(base.paymentsWithoutInvoice + 1);
  });
});

describe("verify-relations reads (UC-F7)", () => {
  it("finds every foreign key, composite ones included, validated and with no orphan", async () => {
    const fks = await gatherForeignKeys(c);
    expect(fks.length).toBeGreaterThan(300);
    expect(fks.filter((f) => f.childColumns.length > 1).length).toBeGreaterThan(100);
    expect(fks.every((f) => f.validated)).toBe(true);
    expect(evaluateRelations(fks, true).ok).toBe(true);
  });

  it("finds an orphan row made behind the constraint's back, and names the key", async () => {
    const result = await inTx(async () => {
      await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(`UPDATE payment_records SET invoice_id = $2 WHERE id = $1`, [paymentActive.id, randomUUID()]);
      return gatherForeignKeys(c);
    });
    const orphaned = result.filter((f) => f.orphans > 0);
    expect(orphaned.length).toBeGreaterThan(0);
    expect(orphaned.map((f) => f.child)).toContain("payment_records");
    expect(evaluateRelations(result, true).ok).toBe(false);
    expect((await gatherForeignKeys(c)).every((f) => f.orphans === 0)).toBe(true);
  });
});

describe("verify-duplicates reads (UC-F7)", () => {
  it("finds two accounts whose emails differ only by case", async () => {
    const suffix = randomUUID().slice(0, 8);
    const base = (await gatherDuplicates(c)).findings.find((f) => f.check.startsWith("user emails"))!.duplicateKeys;
    const made = [
      await adminDb.user.create({ data: { email: `Dup.${suffix}@example.test`, name: "A" } }),
      await adminDb.user.create({ data: { email: `dup.${suffix}@example.test`, name: "B" } }),
    ];
    try {
      const d = await gatherDuplicates(c);
      expect(d.findings.find((f) => f.check.startsWith("user emails"))!.duplicateKeys).toBe(base + 1);
      expect(evaluateDuplicates(d.findings, d.invalidIndexes, d.attributionTables, true).ok).toBe(false);
    } finally {
      await adminDb.user.deleteMany({ where: { id: { in: made.map((u) => u.id) } } });
    }
  });

  it("reports every index valid, no duplicate invoice or quote numbers, and no attribution tables yet", async () => {
    const d = await gatherDuplicates(c);
    expect(d.invalidIndexes).toEqual([]);
    expect(d.findings.find((f) => f.check.startsWith("invoice numbers"))?.duplicateKeys).toBe(0);
    expect(d.findings.every((f) => !f.tableMissing)).toBe(true);
    expect(d.attributionTables).toEqual([]);
  });
});

describe("verify-custom-fields reads (UC-F7)", () => {
  it("counts and hashes the values per definition, and finds a stored key with no definition", async () => {
    const fieldKey = `site_${randomUUID().slice(0, 6)}`;
    const def = await adminDb.customFieldDefinition.create({
      data: { organizationId: w.org.id, entityType: "DEAL", key: fieldKey, label: "Site", fieldType: "TEXT" },
    });
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { customFields: { [fieldKey]: "north" } } });
    const first = await gatherCustomFields(c);
    expect(first.values[def.id]).toMatchObject({ entity: "DEAL", key: fieldKey, rows: 1, hash: createHash("md5").update("north").digest("hex") });

    await adminDb.deal.update({ where: { id: w.deal.id }, data: { customFields: { [fieldKey]: "north", [`ghost_${randomUUID().slice(0, 6)}`]: "x" } } });
    const second = await gatherCustomFields(c);
    expect(second.orphanKeys).toBe(first.orphanKeys + 1);

    await adminDb.deal.update({ where: { id: w.deal.id }, data: { customFields: { [fieldKey]: "south" } } });
    const third = await gatherCustomFields(c);
    const d = diffFingerprints(flattenCustomFields(first), flattenCustomFields(third));
    expect(d.changed.some((k) => k.startsWith(`cf-hash|${def.id}|`))).toBe(true);
    expect(d.changed.some((k) => k.startsWith(`cf-rows|${def.id}|`))).toBe(false);
  });
});

describe("verify-files reads (UC-F7)", () => {
  let root: string;
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const newKey = () => `orgs/${randomUUID()}/attachment/${randomUUID()}`;
  const put = async (k: string, body: string) => {
    const p = join(root, ...k.split("/"));
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  };
  const row = (over: Partial<FileRow>): FileRow => ({ id: randomUUID(), storageKey: newKey(), sizeBytes: 5, checksum: null, status: "READY", purged: false, ...over });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ucf7-files-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("counts present, missing, wrong-size, wrong-checksum, purged, uploading and orphan objects", async () => {
    const good = row({ checksum: sha("hello") });
    const missing = row({ checksum: sha("x") });
    const badSize = row({ sizeBytes: 10, checksum: sha("abc") });
    const badSum = row({ checksum: sha("other") });
    const noSum = row({});
    const purged = row({ purged: true });
    const purgedStillThere = row({ purged: true });
    const uploading = row({ status: "UPLOADING" });
    await put(good.storageKey, "hello");
    await put(badSize.storageKey, "abc");
    await put(badSum.storageKey, "world");
    await put(noSum.storageKey, "12345");
    await put(purgedStillThere.storageKey, "left behind");
    await put(newKey(), "nobody points here");
    await put(`${newKey()}.tmp`, "upload in flight");

    const c1 = await inspectLocalFiles([good, missing, badSize, badSum, noSum, purged, purgedStillThere, uploading], root, "all");
    expect(c1).toEqual({
      expected: 5,
      present: 4,
      missing: 1,
      sizeMismatch: 1,
      checksumChecked: 3,
      checksumMismatch: 1,
      noChecksum: 1,
      skippedUploading: 1,
      skippedPurged: 2,
      orphanObjects: 2,
      objectsScanned: 6,
    });
  });

  it("hashes only the first N rows when asked for a sample, and none for 0, but still checks existence and size", async () => {
    const a = row({ checksum: sha("aaaaa") });
    const b = row({ checksum: sha("nope!") });
    await put(a.storageKey, "aaaaa");
    await put(b.storageKey, "bbbbb");
    const sampled = await inspectLocalFiles([a, b], root, 1);
    expect(sampled.checksumChecked).toBe(1);
    expect(sampled.checksumMismatch).toBe(0);
    const none = await inspectLocalFiles([a, b], root, 0);
    expect(none).toMatchObject({ checksumChecked: 0, present: 2, sizeMismatch: 0 });
  });

  it("prints no file name or key in its counts", async () => {
    const c2 = await inspectLocalFiles([], root, "all");
    expect(Object.values(c2).every((v) => typeof v === "number")).toBe(true);
    expect(JSON.stringify(c2)).not.toContain("orgs/");
    expect((await readFile(join(process.cwd(), "scripts", "verify-files.ts"), "utf8")).includes("console.log(row")).toBe(false);
  });
});

describe("the closed-table list matches the database (UC-F7)", () => {
  it("is exactly the set of tables the app role cannot SELECT, so a new closed table or a lost grant is caught here", async () => {
    const r = await c.query(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' AND NOT has_table_privilege('figbloom_app', c.oid, 'SELECT') ORDER BY 1`,
    );
    const existing = new Set((await c.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`)).rows.map((x) => x.relname as string));
    const expected = [...APP_ROLE_CLOSED_TABLES, ...APP_ROLE_COLUMN_LIMITED_TABLES].filter((t) => existing.has(t)).sort();
    expect(r.rows.map((x) => x.name as string)).toEqual(expected);
  });
});

describe("the commands and the CI job exist (UC-F7)", () => {
  it("has an npm script for the guard and for every verification command, each pointing at a file", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const name of ["check:migrations", "verify:migration", "verify:relations", "verify:financials", "verify:files", "verify:duplicates", "verify:custom-fields", "verify:all"]) {
      expect(pkg.scripts[name], name).toMatch(/^tsx scripts\/[a-z-]+\.ts$/);
      const file = pkg.scripts[name].replace("tsx ", "");
      await expect(readFile(join(process.cwd(), file), "utf8"), file).resolves.toBeTruthy();
    }
  });

  it("has a migration-safety CI job that the aggregate ci check waits for", async () => {
    const yml = await readFile(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    expect(yml).toContain("  migration-safety:");
    expect(yml).toMatch(/needs: \[[^\]]*migration-safety[^\]]*\]/);
    for (const step of ["npm run check:migrations", "verify:migration -- --snapshot before-counts.json --exact", "verify:relations", "verify:financials -- --compare", "verify:duplicates", "verify:custom-fields -- --compare", "No pending migrations"]) {
      expect(yml, step).toContain(step);
    }
  });
});
