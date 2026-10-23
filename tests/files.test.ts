import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { ApiError } from "../src/lib/apiErrors";
import * as fileService from "../src/services/fileService";
import { LocalDriver } from "../src/storage/localDriver";
import { setScanHookForTests, eicarScanner, type ScanHook } from "../src/storage/scan";
import { setStorageDriverForTests } from "../src/storage";
import { handleBlobGet, handleBlobPut } from "../src/storage/blobHandler";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) {
      const { UnauthorizedError } = await import("../src/auth/errors");
      throw new UnauthorizedError();
    }
    return current.ctx;
  },
}));

import * as filesRoute from "../src/app/api/orgs/[orgSlug]/files/route";
import * as fileRoute from "../src/app/api/orgs/[orgSlug]/files/[fileId]/route";
import * as completeRoute from "../src/app/api/orgs/[orgSlug]/files/[fileId]/complete/route";
import * as downloadRoute from "../src/app/api/orgs/[orgSlug]/files/[fileId]/download/route";
import * as contentRoute from "../src/app/api/orgs/[orgSlug]/files/[fileId]/content/route";
import * as blobRoute from "../src/app/api/storage/blob/route";
import { CreateUploadResponseSchema, DownloadLinkResponseSchema, FileSchema } from "../src/api/dto/files";
import { ErrorEnvelopeSchema } from "../src/api/dto/common";

const SECRET = "files-test-signing-secret";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let dir: string;
let driver: LocalDriver;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-files-"));
  process.env.STORAGE_SIGNING_SECRET = SECRET;
  driver = new LocalDriver({ rootDir: dir, signingSecret: SECRET, baseUrl: "http://localhost:3000" });
  setStorageDriverForTests(driver);
});
afterAll(async () => {
  setStorageDriverForTests(null);
  setScanHookForTests(null);
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => setScanHookForTests(null));

async function setup() {
  const org = await createTestOrganization("Files");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "f.mgmt");
  const sales = await createTestContext(org.id, "SALES", "f.sales");
  const sales2 = await createTestContext(org.id, "SALES", "f.sales2");
  const finance = await createTestContext(org.id, "FINANCE", "f.fin");
  return { org, mgmt, sales, sales2, finance };
}

/** Sends the bytes the way a client would: through the signed link the service handed out. */
async function putThroughLink(upload: { url: string; headers: Record<string, string> }, body: Buffer) {
  return blobRoute.PUT(new Request(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(body) }));
}

async function uploadFile(
  ctx: AuthContext,
  body: Buffer,
  overrides: Partial<Parameters<typeof fileService.createUpload>[1]> = {},
) {
  const { file, upload } = await fileService.createUpload(ctx, {
    purpose: "ATTACHMENT",
    name: "brief.png",
    mimeType: "image/png",
    sizeBytes: body.length,
    ...overrides,
  });
  const res = await putThroughLink(upload, body);
  expect(res.status).toBe(200);
  return file;
}

describe("creating an upload", () => {
  it("records the file as UPLOADING and returns a signed link scoped to the organisation's prefix", async () => {
    const { org, mgmt } = await setup();
    const { file, upload } = await fileService.createUpload(mgmt, {
      purpose: "ATTACHMENT",
      name: "Contract.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
    });
    expect(file).toMatchObject({ status: "UPLOADING", purpose: "ATTACHMENT", ownerMembershipId: mgmt.membershipId });
    expect(file.storageKey.startsWith(`orgs/${org.id}/attachment/`)).toBe(true);
    expect(upload.method).toBe("PUT");
    expect(upload.headers["Content-Type"]).toBe("application/pdf");
    expect(new Date(upload.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses names, types, sizes and checksums that are not allowed, naming the field", async () => {
    const { mgmt } = await setup();
    const attempt = (over: Record<string, unknown>) =>
      fileService.createUpload(mgmt, {
        purpose: "AVATAR",
        name: "me.png",
        mimeType: "image/png",
        sizeBytes: 100,
        ...over,
      } as Parameters<typeof fileService.createUpload>[1]);

    await expect(attempt({ name: "../../etc/passwd" })).rejects.toThrow(ValidationError);
    await expect(attempt({ name: "me.exe", mimeType: "application/x-msdownload" })).rejects.toThrow(ValidationError);
    await expect(attempt({ name: "me.svg", mimeType: "image/svg+xml" })).rejects.toThrow(ValidationError);
    await expect(attempt({ name: "me.png", mimeType: "image/jpeg" })).rejects.toThrow(ValidationError);
    await expect(attempt({ sizeBytes: 3 * 1024 * 1024 })).rejects.toThrow(/larger than the 2 MB limit/);
    await expect(attempt({ sizeBytes: 0 })).rejects.toThrow(ValidationError);
    await expect(attempt({ sizeBytes: 1.5 })).rejects.toThrow(ValidationError);
    await expect(attempt({ checksumSha256: "nope" })).rejects.toThrow(ValidationError);
    const err = await attempt({ name: "me.exe", mimeType: "image/png" }).catch((e) => e);
    expect(err.issues.map((i: { path: string }) => i.path)).toContain("mimeType");
  });

  it("applies each purpose's own limit", async () => {
    const { mgmt } = await setup();
    // 5 MB is fine as an attachment, too big as a logo.
    await expect(
      fileService.createUpload(mgmt, { purpose: "ATTACHMENT", name: "a.pdf", mimeType: "application/pdf", sizeBytes: 5 * 1024 * 1024 }),
    ).resolves.toBeTruthy();
    await expect(
      fileService.createUpload(mgmt, { purpose: "LOGO", name: "a.png", mimeType: "image/png", sizeBytes: 5 * 1024 * 1024 }),
    ).rejects.toThrow(ValidationError);
  });

  it("limits who may create which kind of file", async () => {
    const { sales, mgmt, finance } = await setup();
    const png = { name: "a.png", mimeType: "image/png", sizeBytes: 100 };
    // Anyone may upload their own avatar.
    await expect(fileService.createUpload(finance, { purpose: "AVATAR", ...png })).resolves.toBeTruthy();
    // The organisation logo is Management's.
    await expect(fileService.createUpload(sales, { purpose: "LOGO", ...png })).rejects.toThrow(ForbiddenError);
    await expect(fileService.createUpload(mgmt, { purpose: "LOGO", ...png })).resolves.toBeTruthy();
    // Attachments need attachments.manage; Finance does not have it.
    await expect(fileService.createUpload(finance, { purpose: "ATTACHMENT", ...png })).rejects.toThrow(ForbiddenError);
    await expect(fileService.createUpload(sales, { purpose: "ATTACHMENT", ...png })).resolves.toBeTruthy();
    // Imports need an import permission.
    const csv = { name: "leads.csv", mimeType: "text/csv", sizeBytes: 100 };
    await expect(fileService.createUpload(sales, { purpose: "IMPORT", ...csv })).rejects.toThrow(ForbiddenError);
    await expect(fileService.createUpload(mgmt, { purpose: "IMPORT", ...csv })).resolves.toBeTruthy();
    // Exports are produced by the system, never uploaded.
    await expect(fileService.createUpload(mgmt, { purpose: "EXPORT", ...csv })).rejects.toThrow(ValidationError);
  });
});

describe("completing an upload", () => {
  it("checks the bytes, scans them and makes the file READY, recording size, checksum and an audit event", async () => {
    const { org, sales } = await setup();
    const file = await uploadFile(sales, PNG);
    const ready = await fileService.completeUpload(sales, file.id);
    expect(ready).toMatchObject({ status: "READY", sizeBytes: PNG.length, checksumSha256: sha256(PNG), scanResult: "clean" });
    expect(ready.readyAt).not.toBeNull();
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: org.id, action: "file.uploaded", entityId: file.id } });
    expect(audit?.metadata).toMatchObject({ purpose: "ATTACHMENT", sizeBytes: PNG.length });
    // Completing twice is harmless.
    await expect(fileService.completeUpload(sales, file.id)).resolves.toMatchObject({ status: "READY" });
  });

  it("accepts a matching checksum and refuses a mismatched one, deleting the bytes", async () => {
    const { sales } = await setup();
    const good = await uploadFile(sales, PNG, { checksumSha256: sha256(PNG) });
    await expect(fileService.completeUpload(sales, good.id)).resolves.toMatchObject({ status: "READY" });

    const bad = await uploadFile(sales, PNG, { checksumSha256: sha256(Buffer.from("something else")) });
    await expect(fileService.completeUpload(sales, bad.id)).rejects.toThrow(/checksum/);
    expect(await driver.headObject(bad.storageKey)).toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe("DELETED");
  });

  it("refuses content that does not match its declared type (an executable renamed .png)", async () => {
    const { sales } = await setup();
    const exe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00", "latin1");
    const file = await uploadFile(sales, exe);
    await expect(fileService.completeUpload(sales, file.id)).rejects.toThrow(/does not match its declared type/);
    expect(await driver.headObject(file.storageKey)).toBeNull();
    await expect(fileService.getFile(sales, file.id)).rejects.toThrow(NotFoundError);
  });

  it("refuses an upload that is larger than the purpose's limit even if the declared size was small", async () => {
    const { sales } = await setup();
    // Declared 100 bytes as an avatar; the local link caps the body at the limit, so go through the driver directly like a store without a size cap would.
    const { file } = await fileService.createUpload(sales, { purpose: "AVATAR", name: "a.png", mimeType: "image/png", sizeBytes: 100 });
    await driver.putObject(file.storageKey, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), { contentType: "image/png" });
    await expect(fileService.completeUpload(sales, file.id)).rejects.toThrow(/larger than the limit/);
    expect(await driver.headObject(file.storageKey)).toBeNull();
  });

  it("asks for the upload first when nothing arrived", async () => {
    const { sales } = await setup();
    const { file } = await fileService.createUpload(sales, { purpose: "ATTACHMENT", name: "a.png", mimeType: "image/png", sizeBytes: 100 });
    await expect(fileService.completeUpload(sales, file.id)).rejects.toThrow(/No upload was received/);
    expect((await fileService.getFile(sales, file.id)).status).toBe("UPLOADING");
  });

  it("only the uploader can complete it", async () => {
    const { sales, sales2 } = await setup();
    const file = await uploadFile(sales, PNG);
    await expect(fileService.completeUpload(sales2, file.id)).rejects.toThrow(NotFoundError);
  });
});

describe("quarantine: an infected file can never be downloaded", () => {
  async function infected() {
    const ctxs = await setup();
    const text = Buffer.from(EICAR);
    const file = await uploadFile(ctxs.sales, text, { name: "notes.txt", mimeType: "text/plain" });
    const verdict = await fileService.completeUpload(ctxs.sales, file.id).catch((e) => e);
    return { ...ctxs, file, verdict };
  }

  it("quarantines the EICAR test file, answers 409 and audits it", async () => {
    const { org, sales, file, verdict } = await infected();
    expect(verdict).toBeInstanceOf(ApiError);
    expect(verdict).toMatchObject({ status: 409, code: "FILE_UNAVAILABLE" });
    const row = await adminDb.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(row).toMatchObject({ status: "QUARANTINED", scanResult: "infected:Eicar-Test-Signature" });
    expect(await adminDb.auditEvent.findFirst({ where: { organizationId: org.id, action: "file.quarantined", entityId: file.id } })).toBeTruthy();
    void sales;
  });

  it("refuses a download link, the authenticated content route and a link issued earlier", async () => {
    const { sales, file } = await infected();
    await expect(fileService.getDownloadLink(sales, file.id)).rejects.toMatchObject({ status: 409 });
    await expect(fileService.readFileContent(sales, file.id)).rejects.toMatchObject({ status: 409 });

    // A signed link made before the scan finished (the driver will sign anything) still gets nothing.
    const early = await driver.signDownload(file.storageKey, { expiresInSeconds: 60, fileName: "notes.txt", contentType: "text/plain", disposition: "attachment" });
    await expect(handleBlobGet(new Request(early.url))).rejects.toMatchObject({ status: 409 });
    const res = await blobRoute.GET(new Request(early.url));
    expect(res.status).toBe(409);
    expect(ErrorEnvelopeSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("a file flagged after it was ready stops being served at once", async () => {
    const { sales } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    const { download } = await fileService.getDownloadLink(sales, file.id);
    expect((await blobRoute.GET(new Request(download.url))).status).toBe(200);

    await adminDb.file.update({ where: { id: file.id }, data: { status: "QUARANTINED" } });
    expect((await blobRoute.GET(new Request(download.url))).status).toBe(409);
  });

  it("fails closed when the scanner is down: the file stays UPLOADING and nothing is served", async () => {
    const { sales } = await setup();
    const down: ScanHook = { name: "down", scan: async () => ({ status: "error", message: "clamd unreachable" }) };
    setScanHookForTests(down);
    const file = await uploadFile(sales, PNG);
    await expect(fileService.completeUpload(sales, file.id)).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect((await fileService.getFile(sales, file.id)).status).toBe("UPLOADING");
    await expect(fileService.getDownloadLink(sales, file.id)).rejects.toThrow(NotFoundError);

    // The client retries once the scanner is back.
    setScanHookForTests(eicarScanner);
    await expect(fileService.completeUpload(sales, file.id)).resolves.toMatchObject({ status: "READY" });
  });

  it("uses whichever scan hook is configured", async () => {
    const { sales } = await setup();
    const seen: string[] = [];
    setScanHookForTests({
      name: "spy",
      scan: async (data, meta) => {
        seen.push(`${meta.fileName}:${data.length}`);
        return { status: "infected", signature: "Spy.Test" };
      },
    });
    const file = await uploadFile(sales, PNG);
    await expect(fileService.completeUpload(sales, file.id)).rejects.toMatchObject({ status: 409 });
    expect(seen).toEqual([`brief.png:${PNG.length}`]);
  });
});

describe("downloads are authorised on every call", () => {
  it("serves the bytes through a short-lived signed link, with safe headers", async () => {
    const { sales } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    const { download } = await fileService.getDownloadLink(sales, file.id);
    expect(download.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(fileService.DOWNLOAD_LINK_SECONDS * 1000);
    const res = await blobRoute.GET(new Request(download.url));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("serves avatars and logos inline, everything else as an attachment", async () => {
    const { sales } = await setup();
    const avatar = await uploadFile(sales, PNG, { purpose: "AVATAR", name: "me.png" });
    await fileService.completeUpload(sales, avatar.id);
    const { download } = await fileService.getDownloadLink(sales, avatar.id);
    expect((await blobRoute.GET(new Request(download.url))).headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("an expired, tampered or unsigned link gets nothing", async () => {
    const { sales } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    const expired = await new LocalDriver({ rootDir: dir, signingSecret: SECRET, baseUrl: "http://localhost:3000", now: () => new Date(Date.now() - 3600_000) })
      .signDownload(file.storageKey, { expiresInSeconds: 60, fileName: "a.png", contentType: "image/png", disposition: "attachment" });
    expect((await blobRoute.GET(new Request(expired.url))).status).toBe(403);

    const { download } = await fileService.getDownloadLink(sales, file.id);
    const token = new URL(download.url).searchParams.get("token")!;
    const [body, sig] = token.split(".");
    const flipped = `${body}.${sig!.slice(0, -2)}${sig!.endsWith("AA") ? "BB" : "AA"}`;
    expect((await blobRoute.GET(new Request(`http://localhost:3000/api/storage/blob?token=${flipped}`))).status).toBe(403);
    expect((await blobRoute.GET(new Request("http://localhost:3000/api/storage/blob"))).status).toBe(403);
    // A download link cannot be used to upload, and an upload link cannot download.
    expect((await blobRoute.PUT(new Request(download.url, { method: "PUT", body: new Uint8Array(PNG) }))).status).toBe(403);
  });

  it("an upload link enforces its content type and size cap", async () => {
    const { sales } = await setup();
    const { file, upload } = await fileService.createUpload(sales, { purpose: "AVATAR", name: "a.png", mimeType: "image/png", sizeBytes: 100 });
    const wrongType = await blobRoute.PUT(new Request(upload.url, { method: "PUT", headers: { "Content-Type": "text/html" }, body: new Uint8Array(PNG) }));
    expect(wrongType.status).toBe(400);
    const tooBig = await blobRoute.PUT(new Request(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(Buffer.alloc(3 * 1024 * 1024)) }));
    expect(tooBig.status).toBe(400);
    // Neither attempt left bytes behind.
    expect(await driver.headObject(file.storageKey)).toBeNull();
  });

  it("an attachment is readable by those who manage attachments, and everyone else gets 404, not 403", async () => {
    const { sales, sales2, mgmt, finance } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    for (const reader of [sales, sales2, mgmt]) {
      await expect(fileService.getDownloadLink(reader, file.id)).resolves.toBeTruthy();
    }
    // Finance has no attachments.manage: the file might as well not exist.
    await expect(fileService.getDownloadLink(finance, file.id)).rejects.toThrow(NotFoundError);
    await expect(fileService.getFile(finance, file.id)).rejects.toThrow(NotFoundError);
  });

  it("an avatar is readable by everyone in the organisation", async () => {
    const { sales, finance, mgmt } = await setup();
    const avatar = await uploadFile(sales, PNG, { purpose: "AVATAR", name: "me.png" });
    await fileService.completeUpload(sales, avatar.id);
    for (const viewer of [finance, mgmt]) {
      await expect(fileService.getDownloadLink(viewer, avatar.id)).resolves.toBeTruthy();
    }
  });
});

describe("one organisation can never reach another's file", () => {
  async function twoOrgFiles() {
    const a = await setup();
    const b = await setup();
    const fileA = await uploadFile(a.sales, PNG);
    await fileService.completeUpload(a.sales, fileA.id);
    const avatarA = await uploadFile(a.sales, PNG, { purpose: "AVATAR", name: "a.png" });
    await fileService.completeUpload(a.sales, avatarA.id);
    return { a, b, fileA, avatarA };
  }

  it("organisation B's members get 404 for A's file ids, even for an everyone-readable avatar", async () => {
    const { b, fileA, avatarA } = await twoOrgFiles();
    for (const ctx of [b.mgmt, b.sales, b.finance]) {
      await expect(fileService.getFile(ctx, fileA.id)).rejects.toThrow(NotFoundError);
      await expect(fileService.getDownloadLink(ctx, fileA.id)).rejects.toThrow(NotFoundError);
      await expect(fileService.readFileContent(ctx, avatarA.id)).rejects.toThrow(NotFoundError);
      await expect(fileService.deleteFile(ctx, avatarA.id)).rejects.toThrow(NotFoundError);
      await expect(fileService.completeUpload(ctx, fileA.id)).rejects.toThrow(NotFoundError);
    }
  });

  it("a signed link cannot be edited to reach another organisation's bytes", async () => {
    const { a, b } = await twoOrgFiles();
    const fileB = await uploadFile(b.sales, Buffer.concat([PNG, Buffer.from("B-ONLY")]));
    await fileService.completeUpload(b.sales, fileB.id);
    const fileA = await uploadFile(a.sales, PNG);
    await fileService.completeUpload(a.sales, fileA.id);

    const { download } = await fileService.getDownloadLink(a.sales, fileA.id);
    const token = new URL(download.url).searchParams.get("token")!;
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString());
    payload.k = fileB.storageKey;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const res = await blobRoute.GET(new Request(`http://localhost:3000/api/storage/blob?token=${forged}`));
    expect(res.status).toBe(403);
  });

  it("a validly signed link for A's file serves A's bytes whoever holds it, and never B's", async () => {
    const { a, b, fileA } = await twoOrgFiles();
    const { download } = await fileService.getDownloadLink(a.sales, fileA.id);
    current.ctx = b.mgmt; // B's session has no bearing on a link for A's file
    const res = await blobRoute.GET(new Request(download.url));
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    // ...and B cannot ask for a link for A's file in the first place.
    const asB = await downloadRoute.GET(new Request("http://x"), { params: Promise.resolve({ orgSlug: "x", fileId: fileA.id }) });
    expect(asB.status).toBe(404);
  });

  it("database level: B's context cannot see, move or create A's rows (RLS)", async () => {
    const { a, b, fileA } = await twoOrgFiles();
    const asB = await withOrgContext(b.org.id, (tx) => tx.file.findMany({ where: { organizationId: a.org.id } }));
    expect(asB).toHaveLength(0);
    const direct = await withOrgContext(b.org.id, (tx) => tx.file.findUnique({ where: { id: fileA.id } }));
    expect(direct).toBeNull();
    // No context at all: nothing visible.
    expect(await getUnscopedAppClientForTests().file.count({ where: { organizationId: a.org.id } })).toBe(0);
    // Writing a row for A from B's context is refused.
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.file.create({
          data: {
            id: randomUUID(),
            organizationId: a.org.id,
            purpose: "AVATAR",
            name: "x.png",
            sizeBytes: 1,
            mimeType: "image/png",
            storageKey: `orgs/${a.org.id}/avatar/${randomUUID()}`,
          },
        }),
      ),
    ).rejects.toThrow();
    // Updating A's row from B's context touches nothing.
    await expect(withOrgContext(b.org.id, (tx) => tx.file.update({ where: { id: fileA.id }, data: { name: "hijacked" } }))).rejects.toThrow();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: fileA.id } })).name).toBe("brief.png");
  });

  it("a row cannot point at another organisation's storage prefix, or at another organisation's member", async () => {
    const { a, b } = await twoOrgFiles();
    await expect(
      withOrgContext(a.org.id, (tx) =>
        tx.file.create({
          data: {
            id: randomUUID(),
            organizationId: a.org.id,
            purpose: "AVATAR",
            name: "x.png",
            sizeBytes: 1,
            mimeType: "image/png",
            storageKey: `orgs/${b.org.id}/avatar/${randomUUID()}`,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withOrgContext(a.org.id, (tx) =>
        tx.file.create({
          data: {
            id: randomUUID(),
            organizationId: a.org.id,
            ownerMembershipId: b.sales.membershipId,
            purpose: "AVATAR",
            name: "x.png",
            sizeBytes: 1,
            mimeType: "image/png",
            storageKey: `orgs/${a.org.id}/avatar/${randomUUID()}`,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("deleting and the retention purge", () => {
  it("lets the owner delete; the file disappears for everyone but its bytes wait for the purge", async () => {
    const { org, sales, finance } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    await expect(fileService.deleteFile(finance, file.id)).rejects.toThrow(NotFoundError);
    const deleted = await fileService.deleteFile(sales, file.id);
    expect(deleted.status).toBe("DELETED");
    await expect(fileService.getFile(sales, file.id)).rejects.toThrow(NotFoundError);
    await expect(fileService.getDownloadLink(sales, file.id)).rejects.toThrow(NotFoundError);
    expect(await driver.headObject(file.storageKey)).not.toBeNull();
    expect(await adminDb.auditEvent.findFirst({ where: { organizationId: org.id, action: "file.deleted", entityId: file.id } })).toBeTruthy();
  });

  it("a manager can delete a colleague's attachment but not their avatar", async () => {
    const { mgmt, sales } = await setup();
    const attachment = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, attachment.id);
    const avatar = await uploadFile(sales, PNG, { purpose: "AVATAR", name: "me.png" });
    await fileService.completeUpload(sales, avatar.id);
    await expect(fileService.deleteFile(mgmt, avatar.id)).rejects.toThrow(NotFoundError);
    // Management holds attachments.manage, so it can read and remove the attachment.
    await expect(fileService.deleteFile(mgmt, attachment.id)).resolves.toMatchObject({ status: "DELETED" });
  });

  it("the purge removes bytes only after the retention window, and is idempotent", async () => {
    const { sales } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    await fileService.deleteFile(sales, file.id);

    expect((await fileService.purgeDeletedFiles()).purged).toBe(0);
    expect(await driver.headObject(file.storageKey)).not.toBeNull();

    const later = new Date(Date.now() + 31 * 86_400_000);
    const first = await fileService.purgeDeletedFiles({ now: later });
    expect(first.purged).toBeGreaterThanOrEqual(1);
    expect(await driver.headObject(file.storageKey)).toBeNull();
    const row = await adminDb.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.status).toBe("DELETED");
    expect(row.purgedAt).not.toBeNull();
    expect((await fileService.purgeDeletedFiles({ now: later })).purged).toBe(0);
  });

  it("a shorter retention window is honoured, and abandoned uploads are cleared after a day", async () => {
    const { sales } = await setup();
    const abandoned = await fileService.createUpload(sales, { purpose: "ATTACHMENT", name: "a.png", mimeType: "image/png", sizeBytes: 10 });
    await driver.putObject(abandoned.file.storageKey, PNG, { contentType: "image/png" });
    const later = new Date(Date.now() + 3 * 86_400_000);
    await fileService.purgeDeletedFiles({ now: later, retentionDays: 0 });
    expect(await driver.headObject(abandoned.file.storageKey)).toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: abandoned.file.id } })).status).toBe("DELETED");
  });
});

describe("generated files (exports)", () => {
  it("stores a generated CSV through the same checks and scan, owned by whoever asked", async () => {
    const { org, mgmt } = await setup();
    const file = await fileService.storeGeneratedFile({
      organizationId: org.id,
      ownerMembershipId: mgmt.membershipId,
      purpose: "EXPORT",
      name: "leads.csv",
      mimeType: "text/csv",
      data: Buffer.from("name,email\nAda,ada@example.test\n"),
    });
    expect(file).toMatchObject({ status: "READY", purpose: "EXPORT" });
    expect(file.storageKey.startsWith(`orgs/${org.id}/export/`)).toBe(true);
    await expect(fileService.getDownloadLink(mgmt, file.id)).resolves.toBeTruthy();
  });

  it("refuses a generated file that fails the scan or does not match its type", async () => {
    const { org, mgmt } = await setup();
    const base = { organizationId: org.id, ownerMembershipId: mgmt.membershipId, purpose: "EXPORT" as const, name: "x.csv", mimeType: "text/csv" };
    await expect(fileService.storeGeneratedFile({ ...base, data: Buffer.from(EICAR) })).rejects.toMatchObject({ status: 409 });
    await expect(fileService.storeGeneratedFile({ ...base, data: Buffer.from([0, 1, 2, 3]) })).rejects.toThrow(ValidationError);
  });
});

describe("HTTP routes", () => {
  const params = (fileId: string) => ({ params: Promise.resolve({ orgSlug: "x", fileId }) });
  const post = (body: unknown) =>
    filesRoute.POST(
      new Request("http://localhost/api/orgs/x/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ orgSlug: "x" }) },
    );

  it("runs the whole flow over the routes, every response matching its schema", async () => {
    const { sales } = await setup();
    current.ctx = sales;

    const created = await post({ purpose: "ATTACHMENT", name: "plan.png", mimeType: "image/png", sizeBytes: PNG.length });
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(CreateUploadResponseSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(JSON.stringify(body)).not.toContain("orgs/");

    expect((await putThroughLink(body.upload, PNG)).status).toBe(200);
    const done = await completeRoute.POST(new Request("http://x", { method: "POST" }), params(body.file.id));
    expect(done.status).toBe(200);
    const doneBody = await done.json();
    expect(FileSchema.safeParse(doneBody).success).toBe(true);
    expect(doneBody.status).toBe("READY");

    const meta = await fileRoute.GET(new Request("http://x"), params(body.file.id));
    expect(FileSchema.safeParse(await meta.json()).success).toBe(true);

    const link = await downloadRoute.GET(new Request("http://x"), params(body.file.id));
    const linkBody = await link.json();
    expect(DownloadLinkResponseSchema.safeParse(linkBody).success).toBe(true);
    expect((await blobRoute.GET(new Request(linkBody.download.url))).status).toBe(200);

    const content = await contentRoute.GET(new Request("http://x"), params(body.file.id));
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer()).equals(PNG)).toBe(true);

    const removed = await fileRoute.DELETE(new Request("http://x", { method: "DELETE" }), params(body.file.id));
    expect((await removed.json()).status).toBe("DELETED");
    expect((await fileRoute.GET(new Request("http://x"), params(body.file.id))).status).toBe(404);
  });

  it("answers validation, permission and quarantine problems in the standard envelope", async () => {
    const { sales, finance } = await setup();

    current.ctx = sales;
    const invalid = await post({ purpose: "AVATAR", name: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 10 });
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(ErrorEnvelopeSchema.safeParse(invalidBody).success).toBe(true);
    expect(invalidBody.fieldErrors.length).toBeGreaterThan(0);

    const unknownField = await post({ purpose: "AVATAR", name: "a.png", mimeType: "image/png", sizeBytes: 10, storageKey: "orgs/x" });
    expect(unknownField.status).toBe(400);

    current.ctx = finance;
    const denied = await post({ purpose: "ATTACHMENT", name: "a.png", mimeType: "image/png", sizeBytes: 10 });
    expect(denied.status).toBe(403);
    const deniedBody = await denied.json();
    expect(deniedBody.denial).toMatchObject({ yourRole: "Finance" });
    expect(deniedBody.denial.ownerRoles.length).toBeGreaterThan(0);

    current.ctx = sales;
    const file = await uploadFile(sales, Buffer.from(EICAR), { name: "e.txt", mimeType: "text/plain" });
    const quarantined = await completeRoute.POST(new Request("http://x", { method: "POST" }), params(file.id));
    expect(quarantined.status).toBe(409);
    const qBody = await quarantined.json();
    expect(qBody.code).toBe("FILE_UNAVAILABLE");
    expect(ErrorEnvelopeSchema.safeParse(qBody).success).toBe(true);
    const link = await downloadRoute.GET(new Request("http://x"), params(file.id));
    expect(link.status).toBe(409);
  });

  it("the storage blob route does not exist when another driver is configured", async () => {
    const { sales } = await setup();
    const file = await uploadFile(sales, PNG);
    await fileService.completeUpload(sales, file.id);
    const { download } = await fileService.getDownloadLink(sales, file.id);
    setStorageDriverForTests({ ...driver, name: "s3" } as unknown as LocalDriver);
    try {
      await expect(handleBlobGet(new Request(download.url))).rejects.toThrow(NotFoundError);
      await expect(handleBlobPut(new Request(download.url, { method: "PUT" }))).rejects.toThrow(NotFoundError);
    } finally {
      setStorageDriverForTests(driver);
    }
  });
});
