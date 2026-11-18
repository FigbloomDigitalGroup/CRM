/**
 * Chat routes (FIG-1382 to FIG-1384): every chat route, called with the other organisation's ids as A's people, and the happy path
 * through the real route handlers (validation, the error envelope, the Idempotency-Key header).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...actual,
    resolveRequestContext: async () => {
      if (!current.ctx) {
        const { UnauthorizedError } = await import("../src/auth/errors");
        throw new UnauthorizedError();
      }
      return current.ctx;
    },
  };
});

import { discoverRoutes, fillParams, invoke, NO_SUCH_ID, type DiscoveredRoute } from "./helpers/routeHarness";
import { createChannel, postMessage, setReaction } from "../src/services/chatService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

const chatRoutes = () => discoverRoutes().filter((r) => r.path.startsWith("/api/orgs/{orgSlug}/chat/"));
const find = (path: string): DiscoveredRoute => {
  const route = chatRoutes().find((r) => r.path === `/api/orgs/{orgSlug}/chat/${path}`);
  if (!route) throw new Error(`No route ${path}`);
  return route;
};

/** A body that passes validation, so a refusal is the permission's and not the schema's. */
function bodyFor(route: DiscoveredRoute, method: string, membershipId: string): object | undefined {
  if (method === "GET" || method === "DELETE") return undefined;
  if (route.path.endsWith("/channels")) return { kind: "PUBLIC", name: "from-test" };
  if (route.path.endsWith("/members")) return { membershipIds: [membershipId] };
  if (route.path.endsWith("/reactions")) return { emoji: "👍" };
  if (route.path.endsWith("/messages")) return { body: "hello" };
  if (route.path.endsWith("/channels/{channelId}")) return { name: "renamed" };
  return {};
}

async function orgWith(prefix: string) {
  const org = await createTestOrganization(prefix);
  const management = await createTestContext(org.id, "MANAGEMENT", "m");
  const sales = await createTestContext(org.id, "SALES", "s");
  return { org, management, sales };
}

describe("chat routes", () => {
  it("covers all 17 routes", () => {
    expect(chatRoutes().map((r) => r.path.replace("/api/orgs/{orgSlug}/chat/", "")).sort()).toEqual(
      [
        "channels",
        "channels/{channelId}",
        "channels/{channelId}/join",
        "channels/{channelId}/leave",
        "channels/{channelId}/members",
        "channels/{channelId}/members/{membershipId}",
        "channels/{channelId}/messages",
        "channels/{channelId}/messages/{messageId}",
        "channels/{channelId}/messages/{messageId}/attachments/{fileId}",
        "channels/{channelId}/messages/{messageId}/reactions",
        "channels/{channelId}/read",
        "channels/{channelId}/typing",
        "people",
        "presence",
        "search",
        "sync",
        "unread",
      ].sort(),
    );
  });

  it("answers 401 with no session on every route", async () => {
    current.ctx = null;
    for (const route of chatRoutes()) {
      for (const method of route.methods) {
        const res = await invoke(route, method, fillParams(route, "any"));
        expect(res.status, `${method} ${route.path}`).toBe(401);
      }
    }
  });

  it("answers 403 to someone without the chat keys, on every route", async () => {
    const { org, sales } = await orgWith("ChatRouteNoKey");
    current.ctx = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => !k.startsWith("chat.")) };
    for (const route of chatRoutes()) {
      for (const method of route.methods) {
        const res = await invoke(route, method, fillParams(route, org.slug), { body: bodyFor(route, method, sales.membershipId), query: route.path.endsWith("/reactions") && method === "DELETE" ? "?emoji=x" : route.path.endsWith("/search") ? "?q=hello" : "" });
        expect(res.status, `${method} ${route.path}`).toBe(403);
      }
    }
  });

  it("serves the happy path through the handlers, with the error envelope and Idempotency-Key", async () => {
    const { org, management, sales } = await orgWith("ChatRouteHappy");
    current.ctx = management;
    const channels = find("channels");
    const bad = await invoke(channels, "POST", fillParams(channels, org.slug), { body: { kind: "PUBLIC", name: "x", surprise: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ code: "VALIDATION_FAILED", requestId: expect.any(String) });
    const created = await invoke(channels, "POST", fillParams(channels, org.slug), { body: { kind: "PUBLIC", name: "general", memberIds: [sales.membershipId] }, headers: { "idempotency-key": "route-key-0001" } });
    expect(created.status).toBe(200);
    const replay = await invoke(channels, "POST", fillParams(channels, org.slug), { body: { kind: "PUBLIC", name: "general", memberIds: [sales.membershipId] }, headers: { "idempotency-key": "route-key-0001" } });
    expect(replay.response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.json.id).toBe(created.json.id);
    const channelId = created.json.id as string;

    const messages = find("channels/{channelId}/messages");
    const values = fillParams(messages, org.slug, (n) => (n === "channelId" ? channelId : undefined));
    const post = await invoke(messages, "POST", values, { body: { body: "hello team" }, headers: { "idempotency-key": "route-key-0002" } });
    const again = await invoke(messages, "POST", values, { body: { body: "hello team" }, headers: { "idempotency-key": "route-key-0002" } });
    expect(again.json.id).toBe(post.json.id);
    expect(await adminDb.chatMessage.count({ where: { channelId } })).toBe(1);
    expect((await invoke(messages, "POST", values, { body: { body: "x".repeat(4001) } })).status).toBe(400);
    expect((await invoke(messages, "POST", values, { body: { body: "ok", mystery: true } })).status).toBe(400);

    current.ctx = sales;
    const list = await invoke(messages, "GET", values);
    expect(list.json.items.map((m: { body: string }) => m.body)).toEqual(["hello team"]);
    const react = find("channels/{channelId}/messages/{messageId}/reactions");
    const rv = fillParams(react, org.slug, (n) => (n === "channelId" ? channelId : n === "messageId" ? post.json.id : undefined));
    expect((await invoke(react, "POST", rv, { body: { emoji: "👍" } })).json.reactions).toEqual([{ emoji: "👍", count: 1, mine: true }]);
    expect((await invoke(react, "DELETE", rv, { query: `?emoji=${encodeURIComponent("👍")}` })).json.reactions).toEqual([]);
    const read = find("channels/{channelId}/read");
    expect((await invoke(read, "POST", fillParams(read, org.slug, (n) => (n === "channelId" ? channelId : undefined)))).json).toMatchObject({ unread: 0 });
    const sync = find("sync");
    const synced = await invoke(sync, "GET", fillParams(sync, org.slug), { query: `?known[${channelId}]=0` });
    expect(synced.json.messages).toHaveLength(1);
    expect((await invoke(sync, "GET", fillParams(sync, org.slug), { query: "?waitSeconds=abc" })).status).toBe(400);
    expect((await invoke(find("unread"), "GET", fillParams(find("unread"), org.slug))).json).toMatchObject({ unread: 0 });
    expect((await invoke(find("presence"), "POST", fillParams(find("presence"), org.slug))).json).toMatchObject({ ok: true });
    expect((await invoke(find("people"), "GET", fillParams(find("people"), org.slug))).json.items.length).toBe(2);
    expect((await invoke(find("search"), "GET", fillParams(find("search"), org.slug), { query: "?q=hello" })).json.items).toHaveLength(1);
    // Leaving and the member routes.
    const leave = find("channels/{channelId}/leave");
    expect((await invoke(leave, "POST", fillParams(leave, org.slug, (n) => (n === "channelId" ? channelId : undefined)))).status).toBe(200);
  });

  it("tells A's people nothing about B's channels and changes nothing of B's, on every route and method", async () => {
    const A = await orgWith("ChatRouteA");
    const B = await orgWith("ChatRouteB");
    const pub = await createChannel(B.management, { kind: "PUBLIC", name: "b-marker-public", memberIds: [B.sales.membershipId] });
    const priv = await createChannel(B.management, { kind: "PRIVATE", name: "b-marker-private" });
    const msg = await postMessage(B.management, pub.id, { body: "b-marker-text" });
    await setReaction(B.sales, pub.id, msg.id, "👍", true);
    const snapshot = async () => ({
      channels: await adminDb.chatChannel.findMany({ where: { organizationId: B.org.id }, orderBy: { id: "asc" } }),
      members: await adminDb.chatChannelMember.findMany({ where: { organizationId: B.org.id }, orderBy: { id: "asc" } }),
      messages: await adminDb.chatMessage.findMany({ where: { organizationId: B.org.id }, orderBy: { id: "asc" } }),
      reactions: await adminDb.chatReaction.findMany({ where: { organizationId: B.org.id }, orderBy: { id: "asc" } }),
    });
    const before = JSON.stringify(await snapshot());
    const bIds: Record<string, string> = { channelId: priv.id, messageId: msg.id, membershipId: B.sales.membershipId, fileId: NO_SUCH_ID };
    const markers = ["b-marker-public", "b-marker-private", "b-marker-text"];
    for (const route of chatRoutes()) {
      for (const method of route.methods) {
        for (const caller of [A.management, A.sales]) {
          current.ctx = caller;
          for (const channelId of [pub.id, priv.id]) {
            const values = fillParams(route, A.org.slug, (n) => (n === "channelId" ? channelId : bIds[n]));
            const body = bodyFor(route, method, A.sales.membershipId);
            const query = route.path.endsWith("/reactions") ? "?emoji=%F0%9F%91%8D" : route.path.endsWith("/search") ? "?q=b-marker" : route.path.endsWith("/sync") ? `?known[${channelId}]=0` : "";
            const res = await invoke(route, method, values, { body, query });
            const label = `${caller.roleKey} ${method} ${route.path} (${channelId === pub.id ? "public" : "private"})`;
            expect(res.status, label).toBeLessThan(500);
            for (const m of markers) expect(res.text.includes(m), `${label} leaked ${m}`).toBe(false);
            // Anything addressed to B's channel or message must be refused or empty; only A's own routes (list, create, sync...) answer 200.
            if (route.params.includes("channelId")) expect([400, 404], label).toContain(res.status);
          }
        }
      }
    }
    expect(JSON.stringify(await snapshot())).toBe(before);
    expect(await adminDb.chatChannel.count({ where: { organizationId: A.org.id } })).toBe(1);
  }, 120000);
});
