import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { getPlatformDb } from "../src/db/platformClient";
import { setOrganizationRelease } from "../src/services/featureService";
import { listAuditEvents } from "../src/services/platformAuditService";
import {
  cancelAnnouncement,
  createAnnouncement,
  dismissAnnouncement,
  getAnnouncement,
  listAnnouncementFeed,
  listAnnouncements,
  updateAnnouncement,
  type AnnouncementInput,
} from "../src/services/platformAnnouncementService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";

/**
 * FIG-1185 (B7.03): platform announcements. Targeting, schedule, severity, dismiss rules, the tenant feed, and what each side can and cannot see.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined }, ctx: null as unknown }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...actual,
    resolveRequestContext: async () => {
      if (!holder.ctx) {
        const { UnauthorizedError } = await import("../src/auth/errors");
        throw new UnauthorizedError();
      }
      return holder.ctx as AuthContext;
    },
  };
});

import * as platformList from "../src/app/api/platform/announcements/route";
import * as platformOne from "../src/app/api/platform/announcements/[announcementId]/route";
import * as feedRoute from "../src/app/api/orgs/[orgSlug]/announcements/route";
import * as dismissRoute from "../src/app/api/orgs/[orgSlug]/announcements/[announcementId]/dismiss/route";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let admin: TestPlatformAdmin;
const previousRelease = process.env.ACTIVE_RELEASE;

beforeAll(async () => {
  process.env.ACTIVE_RELEASE = "v2";
  admin = await makePlatformAdmin("announce-admin");
});
afterAll(async () => {
  if (previousRelease === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = previousRelease;
  await adminDb.$executeRaw`DELETE FROM platform_announcements WHERE created_by_label = ${admin.email}`;
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});
beforeEach(() => {
  holder.jar = admin.jar;
});
afterEach(() => {
  holder.jar = cookieJar({});
  holder.ctx = null;
});

async function org(label: string) {
  const o = await createTestOrganization(label);
  await setOrganizationRelease(o.id, "v2");
  const mgmt = await createTestContext(o.id, "MANAGEMENT", `${label}.mgmt`.toLowerCase().replace(/\s/g, ""));
  const sales = await createTestContext(o.id, "SALES", `${label}.sales`.toLowerCase().replace(/\s/g, ""));
  return { org: o, mgmt, sales };
}

function input(overrides: Partial<AnnouncementInput> = {}): AnnouncementInput {
  return {
    title: "Planned maintenance",
    body: "Figbloom CRM will be read-only for 20 minutes on Sunday.",
    kind: "MAINTENANCE",
    severity: "INFO",
    startsAt: new Date(Date.now() - HOUR),
    endsAt: new Date(Date.now() + 3 * DAY),
    targetAll: false,
    ...overrides,
  };
}

describe("targeting", () => {
  it("only the targeted organisations see a banner, and nobody sees who else it was for", async () => {
    const a = await org("Ann A");
    const b = await org("Ann B");
    const c = await org("Ann C");
    const created = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id, b.org.id] }));
    expect(created.status).toBe("LIVE");

    for (const target of [a, b]) {
      const feed = await listAnnouncementFeed(target.sales);
      expect(feed.items.map((i) => i.id)).toContain(created.id);
      expect(JSON.stringify(feed)).not.toContain(a.org.id === target.org.id ? b.org.id : a.org.id);
      expect(Object.keys(feed.items[0]!).sort()).toEqual(["body", "dismissible", "endsAt", "id", "kind", "severity", "startsAt", "title"]);
    }
    expect((await listAnnouncementFeed(c.sales)).items.map((i) => i.id)).not.toContain(created.id);
    // Not for C: C cannot dismiss it either, and cannot tell whether it exists.
    await expect(dismissAnnouncement(c.sales, created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an announcement for everyone reaches every organisation, including ones created later", async () => {
    const a = await org("All A");
    const created = await createAnnouncement(admin.actor, input({ targetAll: true, title: "Everyone" }));
    const late = await org("All Late");
    expect((await listAnnouncementFeed(a.mgmt)).items.map((i) => i.id)).toContain(created.id);
    expect((await listAnnouncementFeed(late.mgmt)).items.map((i) => i.id)).toContain(created.id);
  });

  it("is shown only inside its window, and a cancelled one disappears at once", async () => {
    const a = await org("Window");
    const soon = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], startsAt: new Date(Date.now() + 2 * HOUR), endsAt: new Date(Date.now() + DAY), title: "Soon" }));
    expect(soon.status).toBe("SCHEDULED");
    expect((await listAnnouncementFeed(a.sales)).items.map((i) => i.id)).not.toContain(soon.id);
    expect((await listAnnouncementFeed(a.sales, new Date(Date.now() + 3 * HOUR))).items.map((i) => i.id)).toContain(soon.id);
    expect((await listAnnouncementFeed(a.sales, new Date(Date.now() + 2 * DAY))).items.map((i) => i.id)).not.toContain(soon.id);

    const live = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], title: "Live then cancelled" }));
    expect((await listAnnouncementFeed(a.sales)).items.map((i) => i.id)).toContain(live.id);
    const cancelled = await cancelAnnouncement(admin.actor, live.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect((await listAnnouncementFeed(a.sales)).items.map((i) => i.id)).not.toContain(live.id);
    await expect(updateAnnouncement(admin.actor, live.id, { title: "Too late" })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("puts a critical notice before a warning before information", async () => {
    const a = await org("Order");
    await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], severity: "INFO", title: "i" }));
    await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], severity: "CRITICAL", kind: "INCIDENT", title: "c" }));
    await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], severity: "WARNING", title: "w" }));
    // Announcements for everyone (other tests') share the database; look at this organisation's three.
    expect((await listAnnouncementFeed(a.sales)).items.map((i) => i.title).filter((t) => ["c", "w", "i"].includes(t))).toEqual(["c", "w", "i"]);
  });
});

describe("dismissals", () => {
  it("a permanent dismissal persists for that member only", async () => {
    const a = await org("Perm");
    const ann = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], dismissRule: "PERMANENT" }));
    await dismissAnnouncement(a.sales, ann.id);
    const mine = async (ctx: AuthContext, at?: Date) => (await listAnnouncementFeed(ctx, at)).items.filter((i) => i.id === ann.id);
    expect(await mine(a.sales)).toHaveLength(0);
    expect(await mine(a.sales, new Date(Date.now() + 2 * DAY))).toHaveLength(0);
    expect((await listAnnouncementFeed(a.mgmt)).items.map((i) => i.id)).toContain(ann.id);
    // Dismissing twice is harmless.
    await expect(dismissAnnouncement(a.sales, ann.id)).resolves.toMatchObject({ dismissed: true });
  });

  it("a daily dismissal comes back the next day while the announcement is live", async () => {
    const a = await org("Daily");
    const ann = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], severity: "WARNING" }));
    expect(ann.dismissRule).toBe("DAILY");
    await dismissAnnouncement(a.sales, ann.id);
    expect((await listAnnouncementFeed(a.sales, new Date(Date.now() + 2 * HOUR))).items.filter((i) => i.id === ann.id)).toHaveLength(0);
    expect((await listAnnouncementFeed(a.sales, new Date(Date.now() + 25 * HOUR))).items.map((i) => i.id)).toContain(ann.id);
  });

  it("a critical notice cannot be dismissed", async () => {
    const a = await org("Crit");
    const ann = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], severity: "CRITICAL", kind: "INCIDENT" }));
    expect(ann.dismissRule).toBe("NOT_DISMISSIBLE");
    await expect(dismissAnnouncement(a.sales, ann.id)).rejects.toMatchObject({ name: "ValidationError" });
    const item = (await listAnnouncementFeed(a.sales)).items.find((i) => i.id === ann.id)!;
    expect(item.dismissible).toBe(false);
  });

  it("dismissals are walled by organisation: B's rows are invisible to A, and the app role cannot read the announcements table", async () => {
    const a = await org("Wall A");
    const b = await org("Wall B");
    const ann = await createAnnouncement(admin.actor, input({ targetAll: true, title: "Wall" }));
    await dismissAnnouncement(b.sales, ann.id);
    const seenByA = await withOrgContext(a.org.id, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM announcement_dismissals WHERE organization_id = $1`, b.org.id));
    expect(Number(seenByA[0]!.n)).toBe(0);
    await expect(
      withOrgContext(a.org.id, (tx) =>
        tx.$executeRawUnsafe(`INSERT INTO announcement_dismissals (id, organization_id, membership_id, announcement_id) VALUES (gen_random_uuid()::text, $1, $2, $3)`, b.org.id, b.sales.membershipId, ann.id),
      ),
    ).rejects.toThrow();
    const app = getUnscopedAppClientForTests();
    await expect(app.$queryRawUnsafe(`SELECT count(*) FROM platform_announcements`)).rejects.toThrow(/permission denied/);
  });
});

describe("what the platform may write", () => {
  it("validates the text, the window and the audience", async () => {
    const a = await org("Valid");
    const bad = (o: Partial<AnnouncementInput>) => createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], ...o }));
    await expect(bad({ title: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ title: "x".repeat(121) })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ body: "x".repeat(1001) })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ body: "bell\u0007" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ kind: "SPAM" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ severity: "LOUD" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ startsAt: "not a date" })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ endsAt: new Date(Date.now() - HOUR) })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + HOUR) })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ endsAt: new Date(Date.now() + 100 * DAY) })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ organizationIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ organizationIds: ["00000000-0000-0000-0000-000000000000"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ targetAll: true, organizationIds: [a.org.id] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("text is stored as typed (no markup is interpreted) and an edit audits which fields changed, never the body", async () => {
    const a = await org("Edit");
    const ann = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], body: "<b>bold</b> & more" }));
    const stored = await getAnnouncement(ann.id);
    expect(stored.body).toBe("<b>bold</b> & more");
    const updated = await updateAnnouncement(admin.actor, ann.id, { body: "New secret-ish text", endsAt: new Date(Date.now() + 5 * DAY) });
    expect(updated.body).toBe("New secret-ish text");
    await expect(updateAnnouncement(admin.actor, ann.id, { startsAt: new Date(Date.now() + HOUR) })).rejects.toMatchObject({ name: "ValidationError" }); // already live
    const events = (await listAuditEvents({ action: "announcement", limit: 200 })).items.filter((e) => e.targetId === ann.id);
    expect(events.map((e) => e.action).sort()).toEqual(["announcement.created", "announcement.updated"]);
    expect(events.find((e) => e.action === "announcement.updated")!.metadata.changed).toBe("body,endsAt");
    expect(JSON.stringify(events)).not.toContain("secret-ish");
    expect(events.every((e) => e.actorLabel === admin.email)).toBe(true);
  });

  it("lists with a computed status and filters by it", async () => {
    const a = await org("List");
    const live = await createAnnouncement(admin.actor, input({ organizationIds: [a.org.id], title: "list live" }));
    const list = await listAnnouncements({ status: "LIVE" });
    expect(list.items.map((i) => i.id)).toContain(live.id);
    expect(list.items.every((i) => i.status === "LIVE")).toBe(true);
    await expect(listAnnouncements({ status: "WEIRD" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the routes", () => {
  it("platform routes answer 404 to non-admins and below V2; the feed answers 'not in your release' below V2", async () => {
    const a = await org("Routes");
    holder.jar = cookieJar({});
    expect((await platformList.GET(jsonRequest("/api/platform/announcements", "GET"))).status).toBe(404);
    holder.jar = admin.jar;
    expect((await platformList.GET(jsonRequest("/api/platform/announcements", "GET"))).status).toBe(200);
    process.env.ACTIVE_RELEASE = "v1.1";
    expect((await platformList.GET(jsonRequest("/api/platform/announcements", "GET"))).status).toBe(404);
    process.env.ACTIVE_RELEASE = "v2";

    const created = await platformList.POST(
      jsonRequest("/api/platform/announcements", "POST", {
        title: "Via route",
        body: "Hello",
        startsAt: new Date(Date.now() - HOUR).toISOString(),
        endsAt: new Date(Date.now() + DAY).toISOString(),
        organizationIds: [a.org.id],
      }),
    );
    expect(created.status).toBe(200);
    const body = await created.json();
    expect((await platformOne.GET(jsonRequest("/x", "GET"), ctxParams({ announcementId: body.id }))).status).toBe(200);

    holder.ctx = a.sales;
    const feed = await feedRoute.GET(jsonRequest(`/api/orgs/${a.org.slug}/announcements`, "GET"), ctxParams({ orgSlug: a.org.slug }));
    expect(feed.status).toBe(200);
    expect((await feed.json()).items.map((i: { id: string }) => i.id)).toContain(body.id);
    const dismissed = await dismissRoute.POST(jsonRequest("/x", "POST"), ctxParams({ orgSlug: a.org.slug, announcementId: body.id }));
    expect(dismissed.status).toBe(200);

    await setOrganizationRelease(a.org.id, "v1.1");
    const closed = await feedRoute.GET(jsonRequest(`/api/orgs/${a.org.slug}/announcements`, "GET"), ctxParams({ orgSlug: a.org.slug }));
    expect(closed.status).toBe(403);
    expect((await closed.json()).code).toBe("FEATURE_UNAVAILABLE");

    holder.jar = admin.jar;
    expect((await platformOne.DELETE(jsonRequest("/x", "DELETE"), ctxParams({ announcementId: body.id }))).status).toBe(200);
  });
});
