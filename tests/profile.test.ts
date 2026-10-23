import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as fileService from "../src/services/fileService";
import * as membershipService from "../src/services/membershipService";
import * as profileService from "../src/services/profileService";
import { setStorageDriverForTests, getStorageDriver } from "../src/storage";
import { LocalDriver } from "../src/storage/localDriver";
import { setScanHookForTests } from "../src/storage/scan";
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

import * as profileRoute from "../src/app/api/orgs/[orgSlug]/me/profile/route";
import * as avatarRoute from "../src/app/api/orgs/[orgSlug]/me/avatar/route";
import * as blobRoute from "../src/app/api/storage/blob/route";

const SECRET = "profile-test-signing-secret";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-profile-"));
  process.env.STORAGE_SIGNING_SECRET = SECRET;
  setStorageDriverForTests(
    new LocalDriver({ rootDir: dir, signingSecret: SECRET, baseUrl: "http://localhost:3000" }),
  );
});
afterAll(async () => {
  setStorageDriverForTests(null);
  setScanHookForTests(null);
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => setScanHookForTests(null));

async function setup() {
  const org = await createTestOrganization("Profile");
  const sales = await createTestContext(org.id, "SALES", "p.sales");
  const sales2 = await createTestContext(org.id, "SALES", "p.sales2");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "p.mgmt");
  return { org, sales, sales2, mgmt };
}

async function solid(width: number, height: number, format: "png" | "jpeg" = "png") {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });
  return format === "png" ? base.png().toBuffer() : base.jpeg().toBuffer();
}

/** Uploads bytes the way a client would and completes the upload. */
async function uploadAvatar(
  ctx: AuthContext,
  body: Buffer,
  mimeType = "image/png",
  name = mimeType === "image/png" ? "me.png" : "me.jpg",
) {
  const { file, upload } = await fileService.createUpload(ctx, {
    purpose: "AVATAR",
    name,
    mimeType,
    sizeBytes: body.length,
  });
  const res = await blobRoute.PUT(
    new Request(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(body) }),
  );
  expect(res.status).toBe(200);
  await fileService.completeUpload(ctx, file.id);
  return file;
}

async function issueCodes(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return ((err as ValidationError).issues ?? []).map((i) => i.code ?? "");
  }
  throw new Error("Expected a validation error.");
}

describe("initials", () => {
  it("takes the first letters of the first and last word", () => {
    expect(profileService.initialsOf("Wanjiru Kamau")).toBe("WK");
    expect(profileService.initialsOf("  amina  ")).toBe("A");
    expect(profileService.initialsOf("Jean-Luc Picard Jr")).toBe("JJ");
    expect(profileService.initialsOf("élodie dupont")).toBe("ÉD");
    expect(profileService.initialsOf("")).toBe("?");
    expect(profileService.initialsOf("--")).toBe("?");
  });
});

describe("profile details", () => {
  it("reads the own profile with the organisation's time zone as the fallback", async () => {
    const { sales, org } = await setup();
    const profile = await profileService.getMyProfile(sales);
    expect(profile.timeZone).toBeNull();
    expect(profile.effectiveTimeZone).toBe(org.timezone);
    expect(profile.avatar.url).toBeNull();
    expect(profile.avatar.initials.length).toBeGreaterThan(0);
  });

  it("updates name, phone and time zone, and audits the change", async () => {
    const { sales, org } = await setup();
    const updated = await profileService.updateMyProfile(sales, {
      name: "  Wanjiru   Kamau ",
      phone: "+254 700 123 456",
      timeZone: "Africa/Nairobi",
    });
    expect(updated.name).toBe("Wanjiru Kamau");
    expect(updated.phone).toBe("+254 700 123 456");
    expect(updated.timeZone).toBe("Africa/Nairobi");
    expect(updated.effectiveTimeZone).toBe("Africa/Nairobi");
    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "profile.updated", entityId: sales.membershipId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.newValue).toMatchObject({ name: "Wanjiru Kamau", timeZone: "Africa/Nairobi" });
  });

  it("clears the phone and falls back to the organisation's zone when set to null", async () => {
    const { sales, org } = await setup();
    await profileService.updateMyProfile(sales, { phone: "0700123456", timeZone: "Europe/London" });
    const cleared = await profileService.updateMyProfile(sales, { phone: null, timeZone: null });
    expect(cleared.phone).toBeNull();
    expect(cleared.effectiveTimeZone).toBe(org.timezone);
  });

  it("does not write an audit event when nothing changed", async () => {
    const { sales, org } = await setup();
    const me = await profileService.getMyProfile(sales);
    await profileService.updateMyProfile(sales, { name: me.name });
    const count = await adminDb.auditEvent.count({
      where: { organizationId: org.id, action: "profile.updated" },
    });
    expect(count).toBe(0);
  });

  it("explains each invalid value", async () => {
    const { sales } = await setup();
    const err = await profileService
      .updateMyProfile(sales, { name: "   ", phone: "call me", timeZone: "Mars/Olympus" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    const paths = (err as ValidationError).issues!.map((i) => i.path).sort();
    expect(paths).toEqual(["name", "phone", "timeZone"]);
    await expect(profileService.updateMyProfile(sales, { name: "x".repeat(121) })).rejects.toThrow(/at most 120/);
  });

  it("only ever changes the caller's own profile", async () => {
    const { sales, sales2 } = await setup();
    await profileService.updateMyProfile(sales, { name: "Only Me" });
    const other = await profileService.getMyProfile(sales2);
    expect(other.name).not.toBe("Only Me");
  });

  it("serves the profile and its validation through the route", async () => {
    const { sales } = await setup();
    current.ctx = sales;
    const get = await profileRoute.GET(new Request("http://x"), { params: Promise.resolve({ orgSlug: "x" }) });
    expect(get.status).toBe(200);
    const bad = await profileRoute.PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ email: "x@y.z" }) }),
      { params: Promise.resolve({ orgSlug: "x" }) },
    );
    expect(bad.status).toBe(400);
    const ok = await profileRoute.PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ timeZone: "Africa/Nairobi" }) }),
      { params: Promise.resolve({ orgSlug: "x" }) },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).timeZone).toBe("Africa/Nairobi");
  });
});

describe("avatar", () => {
  it("re-encodes to a 256px WebP, drops metadata and removes the original", async () => {
    const { sales, org } = await setup();
    const source = await sharp(await solid(600, 400, "jpeg"))
      .withExif({ IFD0: { Copyright: "secret-copyright" }, IFD3: { GPSLatitudeRef: "N" } })
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const original = await uploadAvatar(sales, source, "image/jpeg");

    const profile = await profileService.setMyAvatar(sales, { fileId: original.id });
    expect(profile.avatar.url).toMatch(/^http/);
    expect(profile.avatar.crop).toEqual({ x: 100, y: 0, size: 400 });

    const row = await adminDb.membership.findUniqueOrThrow({ where: { id: sales.membershipId } });
    expect(row.avatarFileId).toBeTruthy();
    expect(row.avatarFileId).not.toBe(original.id);
    const stored = await adminDb.file.findUniqueOrThrow({ where: { id: row.avatarFileId! } });
    expect(stored.mimeType).toBe("image/webp");
    expect(stored.status).toBe("READY");
    const bytes = await getStorageDriver().getObject(stored.storageKey, 5_000_000);
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(meta.exif).toBeUndefined();
    expect(bytes.includes(Buffer.from("secret-copyright"))).toBe(false);

    const originalRow = await adminDb.file.findUniqueOrThrow({ where: { id: original.id } });
    expect(originalRow.status).toBe("DELETED");
    expect(originalRow.purgedAt).not.toBeNull();
    expect(await getStorageDriver().headObject(originalRow.storageKey)).toBeNull();

    const audit = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "profile.avatar_set" },
    });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain("secret-copyright");
  });

  it("applies the caller's crop in displayed pixels, respecting EXIF rotation", async () => {
    const { sales } = await setup();
    // 400 wide x 200 high, flagged "rotate 90°": displayed as 200 wide x 400 high.
    const rotated = await sharp(await solid(400, 200, "jpeg")).withMetadata({ orientation: 6 }).toBuffer();
    const upload = await uploadAvatar(sales, rotated, "image/jpeg");
    const profile = await profileService.setMyAvatar(sales, { fileId: upload.id, crop: { x: 0, y: 200, size: 200 } });
    expect(profile.avatar.crop).toEqual({ x: 0, y: 200, size: 200 });
  });

  it("refuses a crop that leaves the picture, is too small or is not whole pixels, and keeps the upload", async () => {
    const { sales } = await setup();
    const upload = await uploadAvatar(sales, await solid(300, 300));
    for (const crop of [
      { x: 0, y: 0, size: 301 },
      { x: 100, y: 100, size: 250 },
      { x: -1, y: 0, size: 200 },
      { x: 0, y: 0, size: 100 },
      { x: 0.5, y: 0, size: 200 },
    ]) {
      expect(await issueCodes(profileService.setMyAvatar(sales, { fileId: upload.id, crop }))).toEqual(["CROP_INVALID"]);
    }
    // A bad crop is the person's to fix; the uploaded picture is still there to retry with.
    const again = await profileService.setMyAvatar(sales, { fileId: upload.id, crop: { x: 0, y: 0, size: 200 } });
    expect(again.avatar.url).not.toBeNull();
  });

  it("refuses pictures that are too small, too wide, or not really images", async () => {
    const { sales } = await setup();

    const tiny = await uploadAvatar(sales, await solid(64, 64));
    expect(await issueCodes(profileService.setMyAvatar(sales, { fileId: tiny.id }))).toEqual(["IMAGE_TOO_SMALL"]);

    const wide = await uploadAvatar(sales, await solid(8001, 16));
    expect(await issueCodes(profileService.setMyAvatar(sales, { fileId: wide.id }))).toEqual([
      "IMAGE_DIMENSIONS_TOO_LARGE",
    ]);

    // A valid PNG signature followed by garbage passes the type check and fails the decode.
    const garbage = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 9)]);
    const corrupt = await uploadAvatar(sales, garbage);
    expect(await issueCodes(profileService.setMyAvatar(sales, { fileId: corrupt.id }))).toEqual(["IMAGE_CORRUPT"]);

    // None of them became the avatar, and unusable originals are gone.
    const row = await adminDb.membership.findUniqueOrThrow({ where: { id: sales.membershipId } });
    expect(row.avatarFileId).toBeNull();
    for (const f of [tiny, wide, corrupt]) {
      expect((await adminDb.file.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("DELETED");
    }
  });

  it("is stopped earlier by the shared file rules", async () => {
    const { sales } = await setup();
    await expect(
      fileService.createUpload(sales, { purpose: "AVATAR", name: "me.exe", mimeType: "application/x-msdownload", sizeBytes: 100 }),
    ).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code: "FILE_TYPE_NOT_ALLOWED" })]) });
    await expect(
      fileService.createUpload(sales, { purpose: "AVATAR", name: "me.png", mimeType: "image/png", sizeBytes: 3 * 1024 * 1024 }),
    ).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code: "FILE_TOO_LARGE" })]) });
    // A JPEG sent as a .png is caught when the upload completes.
    const jpeg = await solid(300, 300, "jpeg");
    const { file, upload } = await fileService.createUpload(sales, {
      purpose: "AVATAR",
      name: "me.png",
      mimeType: "image/png",
      sizeBytes: jpeg.length,
    });
    await blobRoute.PUT(new Request(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(jpeg) }));
    await expect(fileService.completeUpload(sales, file.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "FILE_CONTENT_MISMATCH" })],
    });
  });

  it("will not use somebody else's upload or a file of another kind", async () => {
    const { sales, sales2 } = await setup();
    const theirs = await uploadAvatar(sales, await solid(300, 300));
    await expect(profileService.setMyAvatar(sales2, { fileId: theirs.id })).rejects.toBeInstanceOf(NotFoundError);

    const { file, upload } = await fileService.createUpload(
      await createTestContext(sales.organizationId, "MANAGEMENT", "p.att"),
      { purpose: "ATTACHMENT", name: "a.png", mimeType: "image/png", sizeBytes: 10 },
    );
    void upload;
    await expect(profileService.setMyAvatar(sales, { fileId: file.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(profileService.setMyAvatar(sales, { fileId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("will not use a picture that has not finished uploading", async () => {
    const { sales } = await setup();
    const { file } = await fileService.createUpload(sales, {
      purpose: "AVATAR",
      name: "me.png",
      mimeType: "image/png",
      sizeBytes: 500,
    });
    await expect(profileService.setMyAvatar(sales, { fileId: file.id })).rejects.toThrow(/Finish uploading/);
  });

  it("replaces and removes the picture, retiring the old file", async () => {
    const { sales, org } = await setup();
    const first = await profileService.setMyAvatar(sales, { fileId: (await uploadAvatar(sales, await solid(300, 300))).id });
    const firstId = (await adminDb.membership.findUniqueOrThrow({ where: { id: sales.membershipId } })).avatarFileId!;
    expect(first.avatar.url).not.toBeNull();

    await profileService.setMyAvatar(sales, { fileId: (await uploadAvatar(sales, await solid(300, 300, "jpeg"), "image/jpeg")).id });
    const secondId = (await adminDb.membership.findUniqueOrThrow({ where: { id: sales.membershipId } })).avatarFileId!;
    expect(secondId).not.toBe(firstId);
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: firstId } })).status).toBe("DELETED");

    const removed = await profileService.removeMyAvatar(sales);
    expect(removed.avatar.url).toBeNull();
    expect(removed.avatar.crop).toBeNull();
    expect(removed.avatar.initials).toBe(profileService.initialsOf(removed.name));
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: secondId } })).status).toBe("DELETED");
    expect(
      await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "profile.avatar_removed" } }),
    ).toBe(1);
    // Removing when there is none is a quiet no-op.
    await profileService.removeMyAvatar(sales);
    expect(
      await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "profile.avatar_removed" } }),
    ).toBe(1);
  });

  it("shows colleagues the picture or the initials in the member list", async () => {
    const { sales, mgmt } = await setup();
    await profileService.setMyAvatar(sales, { fileId: (await uploadAvatar(sales, await solid(300, 300))).id });
    const list = await membershipService.listMemberships(mgmt);
    const mine = list.find((m) => m.membershipId === sales.membershipId)!;
    const theirs = list.find((m) => m.membershipId === mgmt.membershipId)!;
    expect(mine.avatarUrl).toMatch(/^http/);
    expect(theirs.avatarUrl).toBeNull();
    expect(theirs.initials).toBe(profileService.initialsOf(theirs.userName));
    // Management sees names, never anybody's phone.
    expect(Object.keys(mine)).not.toContain("phone");
  });

  it("serves set and remove through the route", async () => {
    const { sales } = await setup();
    current.ctx = sales;
    const upload = await uploadAvatar(sales, await solid(300, 300));
    const set = await avatarRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ fileId: upload.id, crop: { x: 0, y: 0, size: 300 } }) }),
      { params: Promise.resolve({ orgSlug: "x" }) },
    );
    expect(set.status).toBe(200);
    expect((await set.json()).avatar.url).toMatch(/^http/);
    const bad = await avatarRoute.POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({}) }),
      { params: Promise.resolve({ orgSlug: "x" }) },
    );
    expect(bad.status).toBe(400);
    const del = await avatarRoute.DELETE(new Request("http://x", { method: "DELETE" }), {
      params: Promise.resolve({ orgSlug: "x" }),
    });
    expect((await del.json()).avatar.url).toBeNull();
  });

  it("is tenant-isolated: another organisation cannot resolve the picture, and the database refuses a foreign file", async () => {
    const { sales } = await setup();
    const other = await setup();
    await profileService.setMyAvatar(sales, { fileId: (await uploadAvatar(sales, await solid(300, 300))).id });

    const seenFromOther = await profileService.avatarViewsFor(other.org.id, [
      { membershipId: sales.membershipId, name: "Intruder" },
    ]);
    expect(seenFromOther.get(sales.membershipId)!.url).toBeNull();

    const foreign = await adminDb.file.findFirstOrThrow({
      where: { organizationId: other.org.id },
    }).catch(async () => {
      const f = await uploadAvatar(other.sales, await solid(300, 300));
      return adminDb.file.findUniqueOrThrow({ where: { id: f.id } });
    });
    await expect(
      adminDb.membership.update({ where: { id: sales.membershipId }, data: { avatarFileId: foreign.id } }),
    ).rejects.toThrow();
  });
});
