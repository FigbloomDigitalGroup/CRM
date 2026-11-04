import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveStorageDriver } from "../src/storage";
import { buildStorageKey } from "../src/storage/keys";
import { S3Driver } from "../src/storage/s3Driver";
import { StorageObjectTooLargeError } from "../src/storage/types";

/**
 * FIG-1257 (P1.13): the unchanged S3 driver against a real S3-compatible store.
 * Start it with `docker compose -f docker-compose.storage.yml up -d --wait`.
 * Skips cleanly when the store is not reachable. Override with S3_TEST_*.
 * The defaults are the dev-only values from docker-compose.storage.yml.
 */
const env = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:59000",
  region: process.env.S3_TEST_REGION ?? "us-east-1",
  bucket: process.env.S3_TEST_BUCKET ?? "figbloom-crm-test",
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "devminioadmin",
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "dev-only-minio-secret",
};

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(env.endpoint, { signal: AbortSignal.timeout(1500) });
    await res.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

const up = await reachable();
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const png = { contentType: "image/png" };

describe.skipIf(!up)("S3 driver against the local object store", () => {
  let driver: S3Driver;
  beforeAll(() => {
    driver = new S3Driver({ ...env, forcePathStyle: true });
  });

  it("is what STORAGE_DRIVER=s3 selects", () => {
    const chosen = resolveStorageDriver({
      NODE_ENV: "development",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: env.endpoint,
      S3_REGION: env.region,
      S3_BUCKET: env.bucket,
      S3_ACCESS_KEY_ID: env.accessKeyId,
      S3_SECRET_ACCESS_KEY: env.secretAccessKey,
      S3_FORCE_PATH_STYLE: "true",
    } as NodeJS.ProcessEnv);
    expect(chosen.name).toBe("s3");
  });

  it("uploads, reads, sizes and deletes an object (and deleting twice is fine)", async () => {
    const key = buildStorageKey(ORG_A, "attachment", randomUUID());
    expect(await driver.headObject(key)).toBeNull();
    await driver.putObject(key, PNG, png);
    expect(await driver.headObject(key)).toEqual({ size: PNG.length });
    expect((await driver.getObject(key, 1000)).equals(PNG)).toBe(true);
    await expect(driver.getObject(key, 5)).rejects.toThrow(StorageObjectTooLargeError);
    await driver.deleteObject(key);
    await driver.deleteObject(key);
    expect(await driver.headObject(key)).toBeNull();
  });

  it("accepts an upload through a signed link and serves it back through a signed download link", async () => {
    const key = buildStorageKey(ORG_A, "avatar", randomUUID());
    const upload = await driver.signUpload(key, { contentType: "image/png", expiresInSeconds: 60, maxBytes: 1000 });
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(PNG) });
    expect(put.ok).toBe(true);

    const download = await driver.signDownload(key, {
      expiresInSeconds: 60,
      fileName: "me.png",
      contentType: "image/png",
      disposition: "attachment",
    });
    const got = await fetch(download.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    await driver.deleteObject(key);
  });

  it("keeps the bucket private: no unsigned read, no unsigned listing, no unsigned write", async () => {
    const key = buildStorageKey(ORG_A, "attachment", randomUUID());
    await driver.putObject(key, PNG, png);
    const base = `${env.endpoint}/${env.bucket}`;
    expect((await fetch(`${base}/${key}`)).status).toBe(403);
    expect((await fetch(`${base}/`)).status).toBe(403);
    const other = buildStorageKey(ORG_A, "attachment", randomUUID());
    expect((await fetch(`${base}/${other}`, { method: "PUT", body: "x" })).status).toBe(403);
    await driver.deleteObject(key);
  });

  it("a link for one organisation's file does not open another organisation's file", async () => {
    const keyA = buildStorageKey(ORG_A, "attachment", randomUUID());
    const keyB = buildStorageKey(ORG_B, "attachment", randomUUID());
    await driver.putObject(keyA, PNG, png);
    await driver.putObject(keyB, Buffer.concat([PNG, Buffer.from("B")]), png);

    const opts = { expiresInSeconds: 60, fileName: "a.png", contentType: "image/png", disposition: "inline" as const };
    const linkA = await driver.signDownload(keyA, opts);
    expect((await fetch(linkA.url)).status).toBe(200);

    // The same signature pointed at the other organisation's object is refused.
    const forged = linkA.url.replace(keyA, keyB);
    expect(forged).not.toBe(linkA.url);
    expect((await fetch(forged)).status).toBe(403);

    // So is a link that has expired.
    const old = new S3Driver({ ...env, forcePathStyle: true, now: () => new Date(Date.now() - 3_600_000) });
    const expired = await old.signDownload(keyA, opts);
    expect((await fetch(expired.url)).status).toBe(403);

    await driver.deleteObject(keyA);
    await driver.deleteObject(keyB);
  });

  it("rejects wrong credentials", async () => {
    const bad = new S3Driver({ ...env, secretAccessKey: "not-the-secret", forcePathStyle: true });
    await expect(bad.putObject(buildStorageKey(ORG_A, "attachment", randomUUID()), PNG, png)).rejects.toThrow(/403/);
  });

  // purgeDeletedFiles() removes bytes with driver.deleteObject(storageKey) and then
  // stamps the record. The byte removal is what depends on the store, and is
  // proven here; the record side is covered by the database-backed file tests.
  it("retention purge: bytes are gone after deleteObject, the way purgeDeletedFiles removes them", async () => {
    const keys = [0, 1, 2].map(() => buildStorageKey(ORG_A, "attachment", randomUUID()));
    for (const k of keys) await driver.putObject(k, PNG, png);
    for (const k of keys) await driver.deleteObject(k);
    for (const k of keys) expect(await driver.headObject(k)).toBeNull();
  });
});
