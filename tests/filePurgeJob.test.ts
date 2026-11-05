import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import "../src/jobs/definitions";
import { getJobDefinition, listJobDefinitions } from "../src/jobs/registry";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { FILES_PURGE_JOB_TYPE } from "../src/jobs/handlers/filePurge";
import * as fileService from "../src/services/fileService";
import { setStorageDriverForTests } from "../src/storage";
import { LocalDriver } from "../src/storage/localDriver";
import { setScanHookForTests } from "../src/storage/scan";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const SECRET = "file-purge-job-test-secret";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
const DAY = 86_400_000;

let dir: string;
let driver: LocalDriver;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-purge-"));
  driver = new LocalDriver({ rootDir: dir, signingSecret: SECRET, baseUrl: "http://localhost:3000" });
  setStorageDriverForTests(driver);
  setScanHookForTests(null);
});
/** Organisations this file created: their still-due files are purged at the end so they never linger in the shared test database. */
const createdOrgIds: string[] = [];

afterAll(async () => {
  // Rows left unpurged here (the "not yet due" and "other organisation" cases) would be picked up by any later unscoped
  // purge, for example the one in tests/files.test.ts, and break its exact counts.
  for (const organizationId of createdOrgIds) {
    await fileService.purgeDeletedFiles({ organizationId, now: new Date(Date.now() + 400 * DAY) });
  }
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
});

/** Puts bytes in the store and records the file the way the upload flow would, without the HTTP detour. */
async function seedFile(organizationId: string, ownerMembershipId: string, status: "DELETED" | "QUARANTINED" | "READY", ageDays: number) {
  const id = crypto.randomUUID();
  const storageKey = `orgs/${organizationId}/attachment/${id}`;
  const data = status === "QUARANTINED" ? EICAR : PNG;
  await driver.putObject(storageKey, data, { contentType: "image/png" });
  const when = new Date(Date.now() - ageDays * DAY);
  const file = await adminDb.file.create({
    data: {
      id,
      organizationId,
      ownerMembershipId,
      purpose: "ATTACHMENT",
      name: "x.png",
      sizeBytes: data.length,
      mimeType: "image/png",
      checksumSha256: createHash("sha256").update(data).digest("hex"),
      storageKey,
      status,
      deletedAt: status === "DELETED" ? when : null,
      quarantineReason: status === "QUARANTINED" ? "Malware was detected in the file." : null,
    },
  });
  if (status === "QUARANTINED") {
    // `updated_at` is the quarantine time; the client always sets it to now, so backdate it directly.
    await adminDb.$executeRaw`UPDATE files SET updated_at = ${when} WHERE id = ${id}`;
  }
  return file;
}

async function twoOrgs() {
  const a = await createTestOrganization("PurgeA");
  const b = await createTestOrganization("PurgeB");
  const ma = await createTestContext(a.id, "SALES", "p.a");
  const mb = await createTestContext(b.id, "SALES", "p.b");
  createdOrgIds.push(a.id, b.id);
  return { a, b, ma, mb };
}

describe("files.purge job", () => {
  it("is registered, runs daily and its handler runs", async () => {
    const def = getJobDefinition(FILES_PURGE_JOB_TYPE);
    expect(def).toBeDefined();
    expect(def?.schedule?.everyMs).toBe(DAY);
    expect(listJobDefinitions().map((d) => d.type)).toContain("files.purge");

    const { a, ma } = await twoOrgs();
    const old = await seedFile(a.id, ma.membershipId, "DELETED", 31);
    const run = await enqueueAndRunNow({ organizationId: a.id, type: FILES_PURGE_JOB_TYPE });
    expect(run.outcome).toBe("succeeded");
    expect(await driver.headObject(old.storageKey)).toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: old.id } })).purgedAt).not.toBeNull();
  });

  it("purges a deleted file after the retention period and not before", async () => {
    const { a, ma } = await twoOrgs();
    const recent = await seedFile(a.id, ma.membershipId, "DELETED", 29);
    const old = await seedFile(a.id, ma.membershipId, "DELETED", 31);
    const ready = await seedFile(a.id, ma.membershipId, "READY", 400);
    await enqueueAndRunNow({ organizationId: a.id, type: FILES_PURGE_JOB_TYPE });
    expect(await driver.headObject(recent.storageKey)).not.toBeNull();
    expect(await driver.headObject(old.storageKey)).toBeNull();
    expect(await driver.headObject(ready.storageKey)).not.toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: recent.id } })).purgedAt).toBeNull();
  });

  it("removes the bytes of a quarantined file after the retention period but keeps the row and its audit trail", async () => {
    const { a, ma } = await twoOrgs();
    const fresh = await seedFile(a.id, ma.membershipId, "QUARANTINED", 5);
    const old = await seedFile(a.id, ma.membershipId, "QUARANTINED", 31);
    await adminDb.auditEvent.create({
      data: { organizationId: a.id, actorMembershipId: ma.membershipId, action: "file.quarantined", entityType: "File", entityId: old.id, metadata: {} },
    });
    await enqueueAndRunNow({ organizationId: a.id, type: FILES_PURGE_JOB_TYPE });
    expect(await driver.headObject(fresh.storageKey)).not.toBeNull();
    expect(await driver.headObject(old.storageKey)).toBeNull();
    const row = await adminDb.file.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.status).toBe("QUARANTINED");
    expect(row.purgedAt).not.toBeNull();
    expect(await adminDb.auditEvent.findFirst({ where: { organizationId: a.id, action: "file.quarantined", entityId: old.id } })).toBeTruthy();
  });

  it("is idempotent and tolerates an object that is already gone", async () => {
    const { a, ma } = await twoOrgs();
    const gone = await seedFile(a.id, ma.membershipId, "DELETED", 40);
    await driver.deleteObject(gone.storageKey);
    const first = await fileService.purgeDeletedFiles({ organizationId: a.id });
    expect(first.purged).toBe(1);
    const purgedAt = (await adminDb.file.findUniqueOrThrow({ where: { id: gone.id } })).purgedAt;
    expect(purgedAt).not.toBeNull();
    expect((await fileService.purgeDeletedFiles({ organizationId: a.id })).purged).toBe(0);
    const second = await enqueueAndRunNow({ organizationId: a.id, type: FILES_PURGE_JOB_TYPE });
    expect(second.outcome).toBe("succeeded");
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: gone.id } })).purgedAt).toEqual(purgedAt);
  });

  it("one organisation's purge never touches another's files", async () => {
    const { a, b, ma, mb } = await twoOrgs();
    const mine = await seedFile(a.id, ma.membershipId, "DELETED", 60);
    const mineQ = await seedFile(a.id, ma.membershipId, "QUARANTINED", 60);
    const theirs = await seedFile(b.id, mb.membershipId, "DELETED", 60);
    const theirsQ = await seedFile(b.id, mb.membershipId, "QUARANTINED", 60);
    await enqueueAndRunNow({ organizationId: a.id, type: FILES_PURGE_JOB_TYPE });
    expect(await driver.headObject(mine.storageKey)).toBeNull();
    expect(await driver.headObject(mineQ.storageKey)).toBeNull();
    expect(await driver.headObject(theirs.storageKey)).not.toBeNull();
    expect(await driver.headObject(theirsQ.storageKey)).not.toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: theirs.id } })).purgedAt).toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: theirsQ.id } })).purgedAt).toBeNull();
  });
});
