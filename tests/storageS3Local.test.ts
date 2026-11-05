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

/** S3_PUBLIC_ENDPOINT: links for browsers use the public host; nothing here needs the store. */
describe("S3 driver public endpoint (URL inspection)", () => {
  const base = {
    endpoint: "http://objectstore:8333",
    region: "us-east-1",
    bucket: "figbloom-crm-test",
    accessKeyId: "devminioadmin",
    secretAccessKey: "dev-only-minio-secret",
    forcePathStyle: true,
    now: () => new Date("2026-11-04T10:00:00Z"),
  };
  const key = buildStorageKey(ORG_A, "attachment", "11111111-1111-1111-1111-111111111111");
  const down = { expiresInSeconds: 60, fileName: "a.png", contentType: "image/png", disposition: "attachment" as const };
  const up = { contentType: "image/png", expiresInSeconds: 60, maxBytes: 1000 };

  it("signs upload and download links for the public host", async () => {
    const d = new S3Driver({ ...base, publicEndpoint: "http://localhost:59100" });
    const u = new URL((await d.signUpload(key, up)).url);
    const g = new URL((await d.signDownload(key, down)).url);
    for (const url of [u, g]) {
      expect(url.origin).toBe("http://localhost:59100");
      expect(url.pathname).toBe(`/figbloom-crm-test/${key}`);
      expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    }
  });

  it("the signature depends on the host (signed for the public one, not the internal one)", async () => {
    const pub = new S3Driver({ ...base, publicEndpoint: "http://localhost:59100" });
    const plain = new S3Driver({ ...base, endpoint: "http://localhost:59100" });
    const a = new URL((await pub.signDownload(key, down)).url);
    const b = new URL((await plain.signDownload(key, down)).url);
    expect(a.searchParams.get("X-Amz-Signature")).toBe(b.searchParams.get("X-Amz-Signature"));
    const internal = new URL((await new S3Driver(base).signDownload(key, down)).url);
    expect(internal.searchParams.get("X-Amz-Signature")).not.toBe(a.searchParams.get("X-Amz-Signature"));
  });

  it("unset means links use the internal endpoint, as before", async () => {
    const d = new S3Driver(base);
    expect(new URL((await d.signUpload(key, up)).url).origin).toBe("http://objectstore:8333");
    expect(new URL((await d.signDownload(key, down)).url).origin).toBe("http://objectstore:8333");
  });

  it("server-side calls keep using the internal endpoint", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(Buffer.alloc(3), { status: 200, headers: { "content-length": "3" } });
    }) as typeof fetch;
    const d = new S3Driver({ ...base, publicEndpoint: "http://localhost:59100", fetchImpl });
    await d.putObject(key, Buffer.alloc(3), png);
    await d.getObject(key, 10);
    await d.headObject(key);
    await d.deleteObject(key);
    expect(seen).toHaveLength(4);
    for (const u of seen) expect(new URL(u).origin).toBe("http://objectstore:8333");
  });

  it("resolveStorageDriver validates S3_PUBLIC_ENDPOINT without echoing it", async () => {
    const env = {
      NODE_ENV: "development",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: base.endpoint,
      S3_REGION: base.region,
      S3_BUCKET: base.bucket,
      S3_ACCESS_KEY_ID: base.accessKeyId,
      S3_SECRET_ACCESS_KEY: base.secretAccessKey,
    };
    const ok = resolveStorageDriver({ ...env, S3_PUBLIC_ENDPOINT: "http://localhost:59100" } as NodeJS.ProcessEnv);
    expect(new URL((await ok.signDownload(key, down)).url).origin).toBe("http://localhost:59100");
    const bad = "user:secretpass@not a url";
    expect(() => resolveStorageDriver({ ...env, S3_PUBLIC_ENDPOINT: bad } as NodeJS.ProcessEnv)).toThrow(
      /S3_PUBLIC_ENDPOINT must be an http\(s\) URL\.$/,
    );
    expect(() => resolveStorageDriver({ ...env, S3_PUBLIC_ENDPOINT: "ftp://x" } as NodeJS.ProcessEnv)).toThrow(/http\(s\)/);
  });
});

describe.skipIf(!up)("S3 driver public endpoint against the local object store", () => {
  it("signs for the public address, works through it, while server calls use the internal one", async () => {
    // Same store reached by two names: 127.0.0.1 (internal) and localhost (public).
    const internal = env.endpoint;
    const publicEp = env.endpoint.replace("127.0.0.1", "localhost");
    if (publicEp === internal) return; // custom S3_TEST_ENDPOINT without 127.0.0.1: nothing to compare
    const d = new S3Driver({ ...env, endpoint: internal, publicEndpoint: publicEp, forcePathStyle: true });
    const key = buildStorageKey(ORG_A, "avatar", randomUUID());
    const link = await d.signUpload(key, { contentType: "image/png", expiresInSeconds: 60, maxBytes: 1000 });
    expect(new URL(link.url).hostname).toBe("localhost");
    expect((await fetch(link.url, { method: "PUT", headers: link.headers, body: new Uint8Array(PNG) })).ok).toBe(true);
    expect(await d.headObject(key)).toEqual({ size: PNG.length });
    const dl = await d.signDownload(key, { expiresInSeconds: 60, fileName: "a.png", contentType: "image/png", disposition: "inline" });
    expect((await fetch(dl.url)).status).toBe(200);
    await d.deleteObject(key);
  });
});
