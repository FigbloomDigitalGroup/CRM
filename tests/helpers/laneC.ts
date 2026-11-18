import { randomBytes, randomUUID } from "node:crypto";
import { adminDb } from "../../src/db/adminClient";
import { createTestContext, createTestOrganization } from "./fixtures";

/** An organisation on release V2, where the public API and webhooks are available. */
export async function createV2Organization(prefix = "LaneC Org") {
  const org = await createTestOrganization(prefix);
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: org.id, key: "release_override" } },
    update: { value: { release: "v2" } },
    create: { organizationId: org.id, key: "release_override", value: { release: "v2" } },
  });
  return org;
}

export async function v2World() {
  const org = await createV2Organization();
  const management = await createTestContext(org.id, "MANAGEMENT", "lanec.mgmt");
  const sales = await createTestContext(org.id, "SALES", "lanec.sales");
  const delivery = await createTestContext(org.id, "DELIVERY", "lanec.delivery");
  return { org, management, sales, delivery };
}

/** A request as a client sends it. Every call gets its own address, so the per-address limit never couples two tests. */
export function apiRequest(url: string, token: string | null, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}, 10.0.0.1`, ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export const uniqueIp = () => `203.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
export const randomKey = () => randomUUID() + randomBytes(2).toString("hex");
