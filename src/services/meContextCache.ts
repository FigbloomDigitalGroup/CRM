/**
 * A short in-process cache for the slow-changing half of `/api/me/context`
 * (FIG-1026). The shell asks for the context on every page load, and most of it
 * (organisation, role, look, preferences, features) changes rarely. Anything
 * that changes it calls `invalidateMeContext`, so the person sees their own
 * change at once; changes made by someone else (a Management edit, a role
 * change) invalidate the whole organisation. The TTL bounds staleness in the
 * one case invalidation cannot reach: another server process.
 *
 * `ME_CONTEXT_CACHE_MS` sets the lifetime (default 15000; 0 turns the cache off).
 */
interface Entry<T> {
  userId: string;
  organizationId: string | null;
  expiresAt: number;
  value: T;
}

const store = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 2000;

export function meContextTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ME_CONTEXT_CACHE_MS;
  if (raw === undefined || raw === "") return 15_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15_000;
}

export async function cachedMeContext<T>(
  key: { userId: string; organizationId: string | null; sessionId?: string | null },
  build: () => Promise<T>,
): Promise<T> {
  const ttl = meContextTtlMs();
  if (ttl === 0) return build();
  const k = `${key.userId}|${key.organizationId ?? "-"}`;
  const hit = store.get(k);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await build();
  if (store.size >= MAX_ENTRIES) store.clear();
  store.set(k, { userId: key.userId, organizationId: key.organizationId, expiresAt: Date.now() + ttl, value });
  return value;
}

/** Drops one person's cached context, or everyone's in one organisation (or both). */
export function invalidateMeContext(scope: { userId?: string; organizationId?: string }) {
  for (const [k, e] of store) {
    if ((scope.userId && e.userId === scope.userId) || (scope.organizationId && e.organizationId === scope.organizationId)) {
      store.delete(k);
    }
  }
}

export function clearMeContextCache() {
  store.clear();
}
