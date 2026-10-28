/*
 * Figbloom CRM service worker (F4.12, FIG-791). Registered by the signed-in app only, with scope /o/, so it never touches the sign-in pages
 * (login, sign-up, forgot and reset password, accept invite) which must stay exactly as they are.
 *
 * What it does, and on purpose does not do:
 *  - keeps the built app files (/_next/static) and the brand icons, so the app opens fast and the shell is there on a poor connection;
 *  - shows /offline.html when a page cannot be fetched at all;
 *  - never stores an API answer or an HTML page: those hold one organisation's data, masked by the signed-in person's role, and a copy kept
 *    on the phone could outlive the session. Reading offline is limited to what is already open on screen;
 *  - receives push messages and opens the right record when one is tapped (only a path inside /o/ is ever opened).
 * Saves made offline are not handled here: the page keeps its own queue and sends it to /api/.../sync/batch when the connection returns.
 */

const STATIC_CACHE = "figbloom-static-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/figbloom-logo.jpg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // The page found a new cache version (the build, release or the organisation's look changed): start fresh.
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => caches.open(STATIC_CACHE))
        .then((cache) => cache.addAll(PRECACHE)),
    );
  }
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/figbloom-logo.jpg";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never anything from the API: it is tenant data.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Figbloom CRM";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.notificationId === "string" ? data.notificationId : undefined,
      data: { link: typeof data.link === "string" ? data.link : null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/";
  try {
    const link = event.notification.data && event.notification.data.link;
    if (link) {
      const u = new URL(link, self.location.origin);
      // Only a path inside the signed-in app, on this site.
      if (u.origin === self.location.origin && u.pathname.startsWith("/o/")) target = u.pathname + u.search + u.hash;
    }
  } catch (e) {
    target = "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client && client.url.startsWith(self.location.origin + "/o/")) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
