import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDriver } from "../src/storage/localDriver";
import { signLocalToken, verifyLocalToken } from "../src/storage/localToken";
import { buildStorageKey, keyBelongsToOrganization } from "../src/storage/keys";
import { FILE_POLICIES, checkFileName, extensionOf, findAllowedType } from "../src/storage/policy";
import { S3Driver } from "../src/storage/s3Driver";
import { clamavScanner, eicarScanner } from "../src/storage/scan";
import { presignUrl, signRequestHeaders, uriEncode } from "../src/storage/sigv4";
import { contentMatchesMime, sniffKind } from "../src/storage/sniff";
import { resolveStorageDriver } from "../src/storage";
import { StorageObjectTooLargeError } from "../src/storage/types";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const EICAR_TEXT = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe("SigV4", () => {
  // The worked example in the AWS documentation ("Authenticating Requests:
  // Using Query Parameters (AWS Signature Version 4)").
  it("reproduces the AWS documentation's presigned GET signature exactly", () => {
    const url = presignUrl({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region: "us-east-1",
      },
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(params.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
    expect(params.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("reproduces the AWS documentation's header-signed GET signature", () => {
    // "Example: GET Object" from the Signature Version 4 header-based docs.
    const headers = signRequestHeaders({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region: "us-east-1",
      },
      headers: { range: "bytes=0-9" },
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(headers.authorization).toContain(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers.authorization).toContain("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date");
  });

  it("percent-encodes the way SigV4 requires", () => {
    expect(uriEncode("a b/c~d+e")).toBe("a%20b%2Fc~d%2Be");
    expect(uriEncode("a b/c", false)).toBe("a%20b/c");
  });
});

describe("storage keys", () => {
  it("builds keys inside the organisation prefix and recognises only those", () => {
    const fileId = randomUUID();
    const key = buildStorageKey(ORG_A, "avatar", fileId);
    expect(key).toBe(`orgs/${ORG_A}/avatar/${fileId}`);
    expect(keyBelongsToOrganization(key, ORG_A)).toBe(true);
    expect(keyBelongsToOrganization(key, ORG_B)).toBe(false);
  });

  it("refuses traversal and malformed keys", () => {
    expect(keyBelongsToOrganization(`orgs/${ORG_A}/../orgs/${ORG_B}/avatar/${randomUUID()}`, ORG_A)).toBe(false);
    expect(keyBelongsToOrganization(`orgs/${ORG_A}/avatar/not-a-uuid`, ORG_A)).toBe(false);
    expect(() => buildStorageKey("not-a-uuid", "avatar", randomUUID())).toThrow();
    expect(() => buildStorageKey(ORG_A, "../avatar", randomUUID())).toThrow();
    expect(() => buildStorageKey(ORG_A, "avatar", "../../etc/passwd")).toThrow();
  });
});

describe("local driver", () => {
  let dir: string;
  let driver: LocalDriver;
  let now = new Date("2030-01-01T00:00:00Z");
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "figbloom-storage-"));
    driver = new LocalDriver({ rootDir: dir, signingSecret: "unit-test-secret", baseUrl: "http://localhost:3000", now: () => now });
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it("stores, reads, sizes and deletes an object; deleting twice is fine", async () => {
    const key = buildStorageKey(ORG_A, "attachment", randomUUID());
    expect(await driver.headObject(key)).toBeNull();
    await driver.putObject(key, PNG, { contentType: "image/png" });
    expect(await driver.headObject(key)).toEqual({ size: PNG.length });
    expect((await driver.getObject(key, 1000)).equals(PNG)).toBe(true);
    await driver.deleteObject(key);
    await driver.deleteObject(key);
    expect(await driver.headObject(key)).toBeNull();
  });

  it("refuses to read an object over the limit", async () => {
    const key = buildStorageKey(ORG_A, "attachment", randomUUID());
    await driver.putObject(key, Buffer.alloc(100), { contentType: "text/plain" });
    await expect(driver.getObject(key, 50)).rejects.toThrow(StorageObjectTooLargeError);
  });

  it("will not touch a key that is not an organisation key, whatever the caller tries", async () => {
    for (const key of ["../outside", "/etc/passwd", `orgs/${ORG_A}/../../x`, "orgs/x/y/z"]) {
      await expect(driver.putObject(key, PNG, { contentType: "image/png" })).rejects.toThrow();
      await expect(driver.getObject(key, 10)).rejects.toThrow();
      await expect(driver.deleteObject(key)).rejects.toThrow();
    }
  });

  it("signs upload and download links that expire", async () => {
    const key = buildStorageKey(ORG_A, "avatar", randomUUID());
    const up = await driver.signUpload(key, { contentType: "image/png", expiresInSeconds: 60, maxBytes: 100 });
    expect(up.method).toBe("PUT");
    expect(up.headers).toEqual({ "Content-Type": "image/png" });
    const token = new URL(up.url).searchParams.get("token")!;
    const ok = verifyLocalToken(token, "unit-test-secret", now);
    expect(ok.ok && ok.payload).toMatchObject({ m: "PUT", k: key, ct: "image/png", mb: 100 });

    const down = await driver.signDownload(key, { expiresInSeconds: 60, fileName: "a.png", contentType: "image/png", disposition: "inline" });
    expect(down.method).toBe("GET");
    expect(down.expiresAt.getTime() - now.getTime()).toBe(60_000);
    now = new Date(now.getTime() + 61_000);
    expect(verifyLocalToken(new URL(down.url).searchParams.get("token")!, "unit-test-secret", now)).toEqual({ ok: false, reason: "expired" });
    now = new Date("2030-01-01T00:00:00Z");
  });
});

describe("local tokens", () => {
  const payload = { m: "GET" as const, k: `orgs/${ORG_A}/avatar/${randomUUID()}`, e: Math.floor(Date.now() / 1000) + 60 };

  it("verifies its own signature and nothing else", () => {
    const token = signLocalToken(payload, "secret-1");
    expect(verifyLocalToken(token, "secret-1").ok).toBe(true);
    expect(verifyLocalToken(token, "secret-2")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token whose body was edited to point at another organisation's key", () => {
    const token = signLocalToken(payload, "secret-1");
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, k: `orgs/${ORG_B}/avatar/${randomUUID()}` })).toString("base64url");
    expect(verifyLocalToken(`${forged}.${sig}`, "secret-1")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of ["", "abc", "a.b.c", "....", "%%%.%%%"]) {
      expect(verifyLocalToken(bad, "secret-1").ok).toBe(false);
    }
  });
});

describe("S3-compatible driver (against an in-process S3 stand-in)", () => {
  let server: Server;
  let endpoint: string;
  const objects = new Map<string, { body: Buffer; type: string }>();
  const seen: { method: string; url: string; auth?: string; presigned: boolean }[] = [];

  const credentials = { accessKeyId: "TESTKEY", secretAccessKey: "testsecret", region: "eu-west-1", service: "s3" };

  /** The stand-in checks that every request is signed, and that presigned URLs verify against an independent recomputation. */
  async function handler(req: IncomingMessage, res: import("node:http").ServerResponse) {
    const url = new URL(req.url!, endpoint);
    const presigned = url.searchParams.has("X-Amz-Signature");
    seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, presigned });
    if (presigned) {
      const given = url.searchParams.get("X-Amz-Signature");
      const bare = new URL(url.origin + url.pathname);
      const extra: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        if (!k.startsWith("X-Amz-")) extra[k] = v;
      });
      const expected = new URL(
        presignUrl({
          method: req.method as "GET" | "PUT",
          url: bare.toString(),
          credentials,
          expiresInSeconds: Number(url.searchParams.get("X-Amz-Expires")),
          now: new Date(Date.UTC(
            Number(url.searchParams.get("X-Amz-Date")!.slice(0, 4)),
            Number(url.searchParams.get("X-Amz-Date")!.slice(4, 6)) - 1,
            Number(url.searchParams.get("X-Amz-Date")!.slice(6, 8)),
            Number(url.searchParams.get("X-Amz-Date")!.slice(9, 11)),
            Number(url.searchParams.get("X-Amz-Date")!.slice(11, 13)),
            Number(url.searchParams.get("X-Amz-Date")!.slice(13, 15)),
          )),
          signedHeaders: req.method === "PUT" ? { "content-type": String(req.headers["content-type"]) } : undefined,
          query: extra,
        }),
      ).searchParams.get("X-Amz-Signature");
      if (given !== expected) {
        res.writeHead(403).end("SignatureDoesNotMatch");
        return;
      }
    } else if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=TESTKEY/")) {
      res.writeHead(403).end("Unsigned");
      return;
    }
    const key = decodeURIComponent(url.pathname);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) });
      res.writeHead(200).end();
    } else if (req.method === "GET" || req.method === "HEAD") {
      const found = objects.get(key);
      if (!found) return void res.writeHead(404).end();
      res.writeHead(200, { "content-length": String(found.body.length), "content-type": found.type });
      res.end(req.method === "GET" ? found.body : undefined);
    } else if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(405).end();
  }

  beforeAll(async () => {
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    endpoint = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const make = () =>
    new S3Driver({ endpoint, region: "eu-west-1", bucket: "crm", accessKeyId: "TESTKEY", secretAccessKey: "testsecret", forcePathStyle: true });

  it("puts, heads, gets and deletes with signed requests, under the bucket path", async () => {
    const driver = make();
    const key = buildStorageKey(ORG_A, "attachment", randomUUID());
    await driver.putObject(key, PNG, { contentType: "image/png" });
    expect(objects.has(`/crm/${key}`)).toBe(true);
    expect(await driver.headObject(key)).toEqual({ size: PNG.length });
    expect((await driver.getObject(key, 1000)).equals(PNG)).toBe(true);
    await expect(driver.getObject(key, 5)).rejects.toThrow(StorageObjectTooLargeError);
    await driver.deleteObject(key);
    expect(await driver.headObject(key)).toBeNull();
    expect(seen.every((s) => s.presigned || s.auth?.includes("SignedHeaders="))).toBe(true);
  });

  it("hands out presigned links that the store accepts, and that stop working when altered", async () => {
    const driver = make();
    const key = buildStorageKey(ORG_A, "avatar", randomUUID());
    const up = await driver.signUpload(key, { contentType: "image/png", expiresInSeconds: 60, maxBytes: 1000 });
    expect(up.method).toBe("PUT");
    const put = await fetch(up.url, { method: "PUT", headers: up.headers, body: new Uint8Array(PNG) });
    expect(put.status).toBe(200);

    const down = await driver.signDownload(key, { expiresInSeconds: 60, fileName: "me.png", contentType: "image/png", disposition: "inline" });
    const got = await fetch(down.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);

    // Pointing the same signature at another organisation's key must fail.
    const otherKey = buildStorageKey(ORG_B, "avatar", randomUUID());
    const tampered = down.url.replace(encodeURIComponent(key).replace(/%2F/g, "/"), otherKey).replace(key, otherKey);
    expect(tampered).not.toBe(down.url);
    expect((await fetch(tampered)).status).toBe(403);
  });

  it("supports virtual-hosted style URLs", async () => {
    const hosted = new S3Driver({
      endpoint: "https://s3.eu-west-1.amazonaws.com",
      region: "eu-west-1",
      bucket: "my-bucket",
      accessKeyId: "K",
      secretAccessKey: "S",
      forcePathStyle: false,
    });
    const key = buildStorageKey(ORG_A, "logo", randomUUID());
    const link = await hosted.signDownload(key, { expiresInSeconds: 60, fileName: "a.png", contentType: "image/png", disposition: "inline" });
    expect(new URL(link.url).host).toBe("my-bucket.s3.eu-west-1.amazonaws.com");
    expect(new URL(link.url).pathname).toBe(`/${key}`);
  });
});

describe("driver selection from the environment", () => {
  it("defaults to local outside production, using the dev secret", () => {
    expect(resolveStorageDriver({ NODE_ENV: "development", DEV_SESSION_SECRET: "dev" } as NodeJS.ProcessEnv).name).toBe("local");
  });

  it("refuses to guess in production", () => {
    expect(() => resolveStorageDriver({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/STORAGE_DRIVER/);
    expect(() => resolveStorageDriver({ NODE_ENV: "production", STORAGE_DRIVER: "local" } as NodeJS.ProcessEnv)).toThrow(/STORAGE_SIGNING_SECRET/);
  });

  it("needs every S3 setting, and names the missing one", () => {
    const base = { NODE_ENV: "production", STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://s3.example.test", S3_REGION: "r", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k" };
    expect(() => resolveStorageDriver(base as NodeJS.ProcessEnv)).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(resolveStorageDriver({ ...base, S3_SECRET_ACCESS_KEY: "s" } as NodeJS.ProcessEnv).name).toBe("s3");
  });

  it("rejects an unknown driver", () => {
    expect(() => resolveStorageDriver({ NODE_ENV: "development", STORAGE_DRIVER: "ftp" } as NodeJS.ProcessEnv)).toThrow(/Unknown/);
  });
});

describe("type and size policy", () => {
  it("allows only what a purpose lists, and never SVG", () => {
    expect(findAllowedType(FILE_POLICIES.AVATAR, "image/png", "png")).toBeTruthy();
    expect(findAllowedType(FILE_POLICIES.AVATAR, "image/svg+xml", "svg")).toBeUndefined();
    expect(findAllowedType(FILE_POLICIES.LOGO, "image/svg+xml", "svg")).toBeUndefined();
    expect(findAllowedType(FILE_POLICIES.AVATAR, "image/png", "exe")).toBeUndefined();
    expect(findAllowedType(FILE_POLICIES.IMPORT, "application/pdf", "pdf")).toBeUndefined();
    expect(findAllowedType(FILE_POLICIES.ATTACHMENT, "application/pdf", "pdf")).toBeTruthy();
    for (const purpose of Object.values(FILE_POLICIES)) {
      expect(purpose.types.some((t) => t.mime.includes("svg") || t.mime.includes("html") || t.mime.includes("javascript"))).toBe(false);
    }
  });

  it("has a cap per purpose, avatars and logos the smallest", () => {
    expect(FILE_POLICIES.AVATAR.maxBytes).toBe(2 * 1024 * 1024);
    expect(FILE_POLICIES.IMPORT.maxBytes).toBeGreaterThan(FILE_POLICIES.AVATAR.maxBytes);
    expect(FILE_POLICIES.ATTACHMENT.maxBytes).toBeGreaterThan(FILE_POLICIES.IMPORT.maxBytes);
  });

  it("reads extensions and checks names", () => {
    expect(extensionOf("Report.FINAL.PDF")).toBe("pdf");
    expect(extensionOf("noextension")).toBe("");
    expect(extensionOf(".hidden")).toBe("");
    expect(checkFileName("  fine name.png ").name).toBe("fine name.png");
    for (const bad of ["", "   ", "a/b.png", "a\\b.png", "a\u0000b.png", "..", "x".repeat(256)]) {
      expect(checkFileName(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("content sniffing", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");
  const ZIP_WORD = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("word/document.xml")]);
  const EXE = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00", "latin1");

  it("recognises each supported kind from its bytes", () => {
    expect(sniffKind(PNG)).toBe("png");
    expect(sniffKind(JPEG)).toBe("jpeg");
    expect(sniffKind(PDF)).toBe("pdf");
    expect(sniffKind(ZIP_WORD)).toBe("zip");
    expect(sniffKind(Buffer.from("GIF89a....."))).toBe("gif");
    expect(sniffKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("webp");
    expect(sniffKind(Buffer.from("name,email\nA,a@example.test\n"))).toBe("text");
    expect(sniffKind(EXE)).toBe("unknown");
  });

  it("rejects an executable renamed to an image or a document", () => {
    expect(contentMatchesMime(EXE, "image/png")).toBe(false);
    expect(contentMatchesMime(EXE, "application/pdf")).toBe(false);
    expect(contentMatchesMime(EXE, "text/csv")).toBe(false);
    expect(contentMatchesMime(PNG, "image/jpeg")).toBe(false);
    expect(contentMatchesMime(JPEG, "image/png")).toBe(false);
  });

  it("accepts a matching type, and an Office file only when the zip holds that kind's folder", () => {
    expect(contentMatchesMime(PNG, "image/png")).toBe(true);
    expect(contentMatchesMime(PDF, "application/pdf")).toBe(true);
    expect(contentMatchesMime(Buffer.from("a,b\n1,2\n"), "text/csv")).toBe(true);
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(contentMatchesMime(ZIP_WORD, docx)).toBe(true);
    expect(contentMatchesMime(ZIP_WORD, xlsx)).toBe(false);
  });

  it("treats a NUL-containing or non-UTF-8 blob as not text", () => {
    expect(sniffKind(Buffer.from([0x61, 0x00, 0x62]))).toBe("unknown");
    expect(sniffKind(Buffer.from([0xc3, 0x28, 0xa0, 0xa1]))).toBe("unknown");
  });
});

describe("malware scan hook", () => {
  it("flags the EICAR test file, and only that", async () => {
    expect(await eicarScanner.scan(Buffer.from(EICAR_TEXT), { fileName: "eicar.txt", mimeType: "text/plain" })).toEqual({
      status: "infected",
      signature: "Eicar-Test-Signature",
    });
    expect(await eicarScanner.scan(Buffer.from("hello"), { fileName: "a.txt", mimeType: "text/plain" })).toEqual({ status: "clean" });
    // Found inside a larger file too.
    const wrapped = Buffer.concat([Buffer.from("prefix "), Buffer.from(EICAR_TEXT), Buffer.from(" suffix")]);
    expect((await eicarScanner.scan(wrapped, { fileName: "a.txt", mimeType: "text/plain" })).status).toBe("infected");
  });

  describe("ClamAV client (against a clamd stand-in)", () => {
    let tcp: TcpServer;
    let port: number;
    let received: Buffer;
    let mode: "ok" | "found" | "garbage";
    beforeAll(async () => {
      tcp = createTcpServer((socket) => {
        const chunks: Buffer[] = [];
        socket.on("data", (c) => {
          chunks.push(c);
          const all = Buffer.concat(chunks);
          // The stream ends with a zero-length chunk (four zero bytes).
          if (all.length >= 14 && all.subarray(all.length - 4).equals(Buffer.alloc(4))) {
            received = all;
            socket.end(mode === "ok" ? "stream: OK\0" : mode === "found" ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "wat\0");
          }
        });
      });
      await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r));
      port = (tcp.address() as import("node:net").AddressInfo).port;
    });
    afterAll(() => new Promise<void>((r) => tcp.close(() => r())));

    it("speaks INSTREAM and maps the three replies", async () => {
      const hook = clamavScanner({ host: "127.0.0.1", port });
      mode = "ok";
      expect(await hook.scan(Buffer.from("hello"), { fileName: "a", mimeType: "text/plain" })).toEqual({ status: "clean" });
      expect(received.subarray(0, 10).toString()).toBe("zINSTREAM\0");
      expect(received.readUInt32BE(10)).toBe(5);
      mode = "found";
      expect(await hook.scan(Buffer.from("x"), { fileName: "a", mimeType: "text/plain" })).toEqual({
        status: "infected",
        signature: "Win.Test.EICAR_HDB-1",
      });
      mode = "garbage";
      expect((await hook.scan(Buffer.from("x"), { fileName: "a", mimeType: "text/plain" })).status).toBe("error");
    });

    it("reports an error, not a clean verdict, when clamd is unreachable", async () => {
      const hook = clamavScanner({ host: "127.0.0.1", port: 1, timeoutMs: 500 });
      expect((await hook.scan(Buffer.from("x"), { fileName: "a", mimeType: "text/plain" })).status).toBe("error");
    });
  });
});
