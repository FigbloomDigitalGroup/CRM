import { randomUUID } from "node:crypto";
import { createPlatformSession, PLATFORM_SESSION_COOKIE_NAME, type PlatformContext } from "../../src/auth/platformSession";
import { adminDb } from "../../src/db/adminClient";

/**
 * Shared by the platform console tests (B6.04 to B6.09).
 *
 * A route handler reads its cookies through `next/headers`; a test file mocks that module with
 * `vi.mock("next/headers", () => ({ cookies: async () => holder.jar }))` and moves `holder.jar` between callers.
 */
export function cookieJar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name]! } : undefined) };
}

export interface TestPlatformAdmin {
  id: string;
  email: string;
  token: string;
  /** What a service function takes as the acting admin. */
  actor: Pick<PlatformContext, "identityId" | "email">;
  jar: ReturnType<typeof cookieJar>;
}

const created: string[] = [];

/** A real platform identity with a real platform session (the way B6.02 will sign one in). */
export async function makePlatformAdmin(label = "admin"): Promise<TestPlatformAdmin> {
  const identity = await adminDb.platformIdentity.create({
    data: { email: `${label}.${randomUUID().slice(0, 8)}@platform.example.com`, name: `Test ${label}`, isDev: false },
  });
  created.push(identity.id);
  const session = await createPlatformSession(identity.id);
  return {
    id: identity.id,
    email: identity.email,
    token: session.token,
    actor: { identityId: identity.id, email: identity.email },
    jar: cookieJar({ [PLATFORM_SESSION_COOKIE_NAME]: session.token }),
  };
}

export async function removeTestPlatformAdmins() {
  await adminDb.platformIdentity.deleteMany({ where: { id: { in: created } } });
}

export function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export const ctxParams = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
