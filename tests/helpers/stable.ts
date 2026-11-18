/**
 * Makes a recorded API response repeatable: ids, timestamps, addresses and the throwaway organisation's slug are replaced by
 * numbered stand-ins (the same value always gets the same stand-in within one recording), arrays are cut to a few items and long text
 * is shortened. Used for the mock server's examples and the response shapes, so regenerating them does not churn the diff.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@example\.test\b/g;
const SLUG = /\btest-org-[0-9a-f]{8}\b/g;

export function createStabiliser() {
  const uuids = new Map<string, string>();
  const stamps = new Map<string, string>();
  const emails = new Map<string, string>();
  const base = Date.UTC(2026, 10, 2, 9, 0, 0);

  function text(value: string): string {
    return value
      .replace(SLUG, "figbloom-demo")
      .replace(UUID, (m) => {
        const key = m.toLowerCase();
        if (!uuids.has(key)) uuids.set(key, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, "0")}`);
        return uuids.get(key)!;
      })
      .replace(ISO, (m) => {
        if (!stamps.has(m)) stamps.set(m, new Date(base + stamps.size * 60_000).toISOString());
        return stamps.get(m)!;
      })
      .replace(EMAIL, (m) => {
        if (!emails.has(m)) emails.set(m, `person${emails.size + 1}@example.test`);
        return emails.get(m)!;
      });
  }

  function walk(value: unknown, depth = 0): unknown {
    if (typeof value === "string") {
      const cleaned = text(value);
      return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
    }
    if (Array.isArray(value)) return value.slice(0, 3).map((v) => walk(v, depth + 1));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // The throwaway request id changes on every call and says nothing about the shape.
        out[k] = k === "requestId" ? "request-id" : walk(v, depth + 1);
      }
      return out;
    }
    return value;
  }

  return { text, value: (v: unknown) => walk(v) };
}
