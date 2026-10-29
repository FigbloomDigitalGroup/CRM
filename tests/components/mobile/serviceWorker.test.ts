import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * The service worker (public/sw.js) runs in a browser, so this loads it into a sandbox with a fake `self` and `caches` and checks the three
 * promises it makes: it never touches the API (tenant data), it falls back to the offline page only for pages, and a tapped notification
 * opens only a path inside the signed-in app.
 */
function load() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Response>();
  const openWindow = vi.fn(async () => undefined);
  const caches = {
    open: async () => ({ addAll: async () => undefined, put: async (r: { url: string }, res: Response) => void store.set(r.url, res) }),
    match: async (r: string | { url: string }) => (typeof r === "string" ? (r === "/offline.html" ? ({ offline: true } as unknown as Response) : undefined) : store.get(r.url)),
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    location: { origin: "https://crm.example" },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow },
    registration: { showNotification: vi.fn(async () => undefined) },
  };
  vm.runInNewContext(readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8"), { self, caches, URL, Response, fetch: async () => { throw new Error("offline"); }, Promise });
  return { listeners, openWindow, self };
}

function fetchEvent(url: string, mode = "cors", method = "GET") {
  const out: { responded: Promise<unknown> | null } = { responded: null };
  return { out, event: { request: { url, method, mode }, respondWith: (p: Promise<unknown>) => { out.responded = Promise.resolve(p); out.responded.catch(() => undefined); } } };
}

describe("service worker (F4.12)", () => {
  it("never handles an API request, so tenant data is never stored", () => {
    const { listeners } = load();
    const { out, event } = fetchEvent("https://crm.example/api/orgs/figbloom/leads");
    listeners.fetch!(event);
    expect(out.responded).toBeNull();
  });

  it("never handles a write", () => {
    const { listeners } = load();
    const { out, event } = fetchEvent("https://crm.example/_next/static/x.js", "cors", "POST");
    listeners.fetch!(event);
    expect(out.responded).toBeNull();
  });

  it("keeps a content-hashed build file, but never one whose name can stay the same while its content changes", () => {
    const { listeners } = load();
    for (const hashed of ["https://crm.example/_next/static/chunks/main-app-3f9a1c7be2d04a55.js", "https://crm.example/_next/static/css/8a1b2c3d4e5f6a7b.css"]) {
      const { out, event } = fetchEvent(hashed);
      listeners.fetch!(event);
      expect(out.responded, hashed).not.toBeNull();
    }
    // The development server's files (no hash in the name) must always come from the network, or the app never updates.
    for (const dev of ["https://crm.example/_next/static/chunks/main-app.js?v=1793200000", "https://crm.example/_next/static/css/app/o/%5BorgSlug%5D/layout.css"]) {
      const { out, event } = fetchEvent(dev);
      listeners.fetch!(event);
      expect(out.responded, dev).toBeNull();
    }
  });

  it("answers a page that cannot be fetched with the offline page", async () => {
    const { listeners } = load();
    const { out, event } = fetchEvent("https://crm.example/o/figbloom/m", "navigate");
    listeners.fetch!(event);
    await expect(out.responded).resolves.toEqual({ offline: true });
  });

  it("opens only a path inside the signed-in app when a notification is tapped", async () => {
    const { listeners, openWindow } = load();
    const tap = async (link: string | null) => {
      let done: Promise<unknown> = Promise.resolve();
      listeners.notificationclick!({ notification: { close: () => undefined, data: { link } }, waitUntil: (p: Promise<unknown>) => void (done = p) });
      await done;
    };
    await tap("https://crm.example/o/figbloom/leads/abc?x=1");
    expect(openWindow).toHaveBeenLastCalledWith("/o/figbloom/leads/abc?x=1");
    await tap("https://evil.example/o/figbloom/leads/abc");
    expect(openWindow).toHaveBeenLastCalledWith("/");
    await tap("https://crm.example/login");
    expect(openWindow).toHaveBeenLastCalledWith("/");
    await tap(null);
    expect(openWindow).toHaveBeenLastCalledWith("/");
  });

  it("shows a push message with the server's title and body", async () => {
    const { listeners, self } = load();
    let done: Promise<unknown> = Promise.resolve();
    listeners.push!({ data: { json: () => ({ title: "Task due", body: "Call Chebet", link: "https://crm.example/o/figbloom/tasks", notificationId: "n1" }) }, waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect(self.registration.showNotification).toHaveBeenCalledWith("Task due", expect.objectContaining({ body: "Call Chebet", tag: "n1" }));
  });
});
