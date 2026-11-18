/**
 * Install, service worker and push helpers for the PWA (F4.12, S3, M1). Plain browser code with no React, so it is easy to test and the
 * screens only read small state: can this be installed, is it installed, is push possible and on.
 */

export const SW_URL = "/sw.js";
/** The service worker only ever controls the signed-in app (`/o/...`): never the sign-in pages, which stay exactly as they are. */
export const SW_SCOPE = "/o/";
export const VERSION_KEY = "figbloom-cache-version";
export const INSTALL_DISMISSED_KEY = "figbloom-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Listener = () => void;

class InstallState {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed = false;
  private listeners = new Set<Listener>();
  private snap = { canPrompt: false, installed: false };

  private emit() {
    this.snap = { canPrompt: this.deferred !== null, installed: this.installed };
    for (const l of this.listeners) l();
  }
  getSnapshot = () => this.snap;
  getServerSnapshot = () => ({ canPrompt: false, installed: false });
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  /** Called once by the shell: listens for the browser's install offer. */
  watch(): () => void {
    if (typeof window === "undefined") return () => undefined;
    this.installed = isStandalone();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.emit();
    };
    const onInstalled = () => {
      this.deferred = null;
      this.installed = true;
      this.emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    this.emit();
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }

  async prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
    const d = this.deferred;
    if (!d) return "unavailable";
    await d.prompt();
    const choice = await d.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    this.deferred = null;
    if (choice.outcome === "accepted") this.installed = true;
    this.emit();
    return choice.outcome;
  }
}

export const installState = new InstallState();

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)").matches : false;
  return mm || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone and iPad Safari never fire the install offer; the person adds it from the Share sheet, so the card says how. */
export function isIos(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /iPad|iPhone|iPod/.test(ua);
}

export function installDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
export function dismissInstall() {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    /* blocked storage: the card simply comes back next visit */
  }
}

/** Registers the worker for the signed-in app only. Returns the registration, or null where service workers do not exist. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch {
    return null;
  }
}

/**
 * Compares the cache version the server reports (a fingerprint of the build, release, look and toggles) with the one this device holds.
 * A different number clears the worker's caches so the next load is fresh. Returns true when it cleared.
 */
export async function applyCacheVersion(version: string, reg: ServiceWorkerRegistration | null): Promise<boolean> {
  let held: string | null = null;
  try {
    held = window.localStorage.getItem(VERSION_KEY);
    window.localStorage.setItem(VERSION_KEY, version);
  } catch {
    return false;
  }
  if (held === null || held === version) return false;
  (reg?.active ?? navigator.serviceWorker?.controller)?.postMessage({ type: "CLEAR_CACHES" });
  return true;
}

/* Push --------------------------------------------------------------------------------------------------------------------------- */

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function toBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Asks the browser to subscribe this device with the server's public key. Returns the details the API registers. */
export async function subscribeThisDevice(publicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }> {
  const reg = (await navigator.serviceWorker.getRegistration(SW_SCOPE)) ?? (await navigator.serviceWorker.ready);
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  return { endpoint: sub.endpoint, keys: { p256dh: toBase64Url(sub.getKey("p256dh")), auth: toBase64Url(sub.getKey("auth")) } };
}

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

export async function unsubscribeThisDevice(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
}
