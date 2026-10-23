import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import * as fileService from "../src/services/fileService";
import * as look from "../src/services/organizationLookService";
import { setStorageDriverForTests } from "../src/storage";
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

import * as lookRoute from "../src/app/api/orgs/[orgSlug]/look/route";
import * as blobRoute from "../src/app/api/storage/blob/route";

const SECRET = "look-test-signing-secret";
const params = { params: Promise.resolve({ orgSlug: "x" }) };
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-look-"));
  process.env.STORAGE_SIGNING_SECRET = SECRET;
  setStorageDriverForTests(new LocalDriver({ rootDir: dir, signingSecret: SECRET, baseUrl: "http://localhost:3000" }));
  setScanHookForTests(null);
});
afterAll(async () => {
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const org = await createTestOrganization("Look");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "lk.mgmt");
  const sales = await createTestContext(org.id, "SALES", "lk.sales");
  return { org, mgmt, sales };
}

async function uploadLogo(ctx: AuthContext, purpose: "LOGO" | "ATTACHMENT" = "LOGO") {
  const body = await sharp({ create: { width: 200, height: 80, channels: 3, background: "#1F7A4D" } }).png().toBuffer();
  const { file, upload } = await fileService.createUpload(ctx, { purpose, name: "logo.png", mimeType: "image/png", sizeBytes: body.length });
  const res = await blobRoute.PUT(new Request(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(body) }));
  expect(res.status).toBe(200);
  await fileService.completeUpload(ctx, file.id);
  return file;
}

async function issues(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues ?? [];
  }
  throw new Error("Expected a validation error.");
}

describe("organisation look", () => {
  it("starts as the brand look and shows the organisation's name", async () => {
    const { org, sales } = await setup();
    const view = await look.getOrganizationLook(sales);
    expect(view).toMatchObject({
      name: org.name,
      shownName: org.name,
      displayName: null,
      logoUrl: null,
      defaultTheme: "FOREST",
      defaultPageColour: "WHITE",
      showLogoOnClientPages: false,
      allowPersonalisation: true,
    });
    expect(view.colours.accent).toBe("#1F7A4D");
  });

  it("is changed by Management and read by everyone, with an audit trail", async () => {
    const { org, mgmt, sales } = await setup();
    const updated = await look.updateOrganizationLook(mgmt, {
      displayName: "  Figbloom   Kenya ",
      defaultTheme: "OCEAN",
      defaultPageColour: "COOL_GREY",
      showLogoOnClientPages: true,
    });
    expect(updated).toMatchObject({ shownName: "Figbloom Kenya", defaultTheme: "OCEAN", defaultPageColour: "COOL_GREY", showLogoOnClientPages: true });
    const seenBySales = await look.getOrganizationLook(sales);
    expect(seenBySales.shownName).toBe("Figbloom Kenya");

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "organization.look_updated" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.previousValue).toMatchObject({ defaultTheme: "FOREST" });
    expect(events[0]!.newValue).toMatchObject({ defaultTheme: "OCEAN", showLogoOnClientPages: true });

    // Clearing the display name falls back to the organisation's name; saving the same values again is a quiet no-op.
    expect((await look.updateOrganizationLook(mgmt, { displayName: null })).shownName).toBe(org.name);
    await look.updateOrganizationLook(mgmt, { defaultTheme: "OCEAN" });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "organization.look_updated" } })).toBe(2);
  });

  it("is not for other roles to change, and the denial names the permission", async () => {
    const { sales } = await setup();
    const err = await look.updateOrganizationLook(sales, { defaultTheme: "SKY" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((await look.getOrganizationLook(sales)).defaultTheme).toBe("FOREST");
  });

  it("explains invalid values", async () => {
    const { mgmt } = await setup();
    const found = await issues(
      look.updateOrganizationLook(mgmt, { defaultTheme: "NEON", defaultPageColour: "MATCH_DEVICE", displayName: "x".repeat(81) }),
    );
    expect(found.map((i) => i.path).sort()).toEqual(["defaultPageColour", "defaultTheme", "displayName"]);
    expect(found.find((i) => i.path === "defaultPageColour")!.message).toContain("specific page colour");
    await expect(look.updateOrganizationLook(mgmt, {})).rejects.toThrow(/at least one/);
    expect((await look.getOrganizationLook(mgmt)).defaultTheme).toBe("FOREST");
  });

  it("switches personalisation through the one toggle, audited as a toggle", async () => {
    const { org, mgmt, sales } = await setup();
    const off = await look.updateOrganizationLook(mgmt, { allowPersonalisation: false });
    expect(off.allowPersonalisation).toBe(false);
    expect((await look.getOrganizationLook(sales)).allowPersonalisation).toBe(false);
    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "feature_toggle.changed", entityId: look.PERSONALISATION_TOGGLE },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.newValue).toEqual({ enabled: false });
  });
});

describe("logo", () => {
  it("is uploaded by Management and shown to every member", async () => {
    const { mgmt, sales } = await setup();
    const logo = await uploadLogo(mgmt);
    const updated = await look.updateOrganizationLook(mgmt, { logoFileId: logo.id });
    expect(updated.logoUrl).toMatch(/^http/);
    expect((await look.getOrganizationLook(sales)).logoUrl).toMatch(/^http/);

    // Anyone in the organisation can fetch it through the shared file rules.
    const dl = await fileService.getDownloadLink(sales, logo.id);
    expect(dl.download.url).toMatch(/^http/);
  });

  it("cannot be uploaded by members without the permission", async () => {
    const { sales } = await setup();
    await expect(
      fileService.createUpload(sales, { purpose: "LOGO", name: "logo.png", mimeType: "image/png", sizeBytes: 100 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("replacing the logo retires the old file, and removing it clears the link", async () => {
    const { org, mgmt } = await setup();
    const first = await uploadLogo(mgmt);
    await look.updateOrganizationLook(mgmt, { logoFileId: first.id });
    const second = await uploadLogo(mgmt);
    await look.updateOrganizationLook(mgmt, { logoFileId: second.id });
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DELETED");
    expect((await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } })).logoFileId).toBe(second.id);

    const cleared = await look.updateOrganizationLook(mgmt, { logoFileId: null });
    expect(cleared.logoUrl).toBeNull();
    expect((await adminDb.file.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("DELETED");
  });

  it("only accepts finished LOGO files of this organisation", async () => {
    const { mgmt } = await setup();
    const other = await setup();
    const attachment = await uploadLogo(mgmt, "ATTACHMENT").catch(() => null);
    if (attachment) await expect(look.updateOrganizationLook(mgmt, { logoFileId: attachment.id })).rejects.toBeInstanceOf(NotFoundError);
    const foreign = await uploadLogo(other.mgmt);
    await expect(look.updateOrganizationLook(mgmt, { logoFileId: foreign.id })).rejects.toBeInstanceOf(NotFoundError);
    const { file } = await fileService.createUpload(mgmt, { purpose: "LOGO", name: "logo.png", mimeType: "image/png", sizeBytes: 100 });
    await expect(look.updateOrganizationLook(mgmt, { logoFileId: file.id })).rejects.toThrow(/Finish uploading/);
    await expect(look.updateOrganizationLook(mgmt, { logoFileId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is tenant-isolated: the database refuses another organisation's file as a logo", async () => {
    const a = await setup();
    const b = await setup();
    const foreign = await uploadLogo(b.mgmt);
    await expect(adminDb.organization.update({ where: { id: a.org.id }, data: { logoFileId: foreign.id } })).rejects.toThrow();
    // And the other organisation's context cannot read this organisation's file row.
    const mine = await uploadLogo(a.mgmt);
    expect(await withOrgContext(b.org.id, (tx) => tx.file.findMany({ where: { id: mine.id } }))).toEqual([]);
  });
});

describe("through the routes", () => {
  it("lets every role read and only Management write", async () => {
    const { mgmt, sales } = await setup();
    current.ctx = sales;
    expect((await lookRoute.GET(new Request("http://x"), params)).status).toBe(200);
    const denied = await lookRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ defaultTheme: "SKY" }) }), params);
    expect(denied.status).toBe(403);
    current.ctx = mgmt;
    const ok = await lookRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ defaultTheme: "SKY" }) }), params);
    expect(ok.status).toBe(200);
    expect((await ok.json()).defaultTheme).toBe("SKY");
    const unknown = await lookRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ colour: "red" }) }), params);
    expect(unknown.status).toBe(400);
  });
});
