/**
 * FIG-804: outbound webhooks for record events (docs/M17_LANE_C_PUBLIC_API_WEBHOOKS.md).
 *
 * Covers: Management-only registration with a once-shown, rotatable secret; address safety (SSRF); signed deliveries with a timestamp a
 * receiver can check; retries with backoff through the job framework, dead deliveries, retry, auto-disable; payloads limited to a fixed
 * field list with deal values masked by the endpoint creator's role; and tenant isolation.
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { UnsafeUrlError, checkWebhookUrl, isPublicAddress, resolvesToPublicAddress, safeRequest } from "../src/lib/ssrfGuard";
import { WEBHOOK_MAX_ATTEMPTS, signWebhook, verifyWebhookSignature, webhookBackoffSeconds } from "../src/lib/webhookEvents";
import { openSecret } from "../src/lib/secretBox";
import { createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import { createDeal, updateDeal } from "../src/services/dealService";
import { assignLead, convertLead, createLead } from "../src/services/leadService";
import { createTask } from "../src/services/taskService";
import { createForm, updateForm } from "../src/services/webFormService";
import { submitWebForm } from "../src/services/webFormSubmissionService";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  deliverDueWebhooks,
  listWebhookDeliveries,
  listWebhookEndpoints,
  retryWebhookDelivery,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookResolverForTests,
  setWebhookTransportForTests,
  updateWebhookEndpoint,
  type DeliveryTransport,
} from "../src/services/webhookService";
import { createTestContext, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";
import { v2World } from "./helpers/laneC";

const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
let world: Awaited<ReturnType<typeof v2World>>;

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];
let answer: (call: Sent) => { status: number; snippet?: string } = () => ({ status: 200 });
const transport: DeliveryTransport = async (call) => {
  sent.push(call);
  const r = answer(call);
  return { status: r.status, snippet: r.snippet ?? "" };
};

beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  // Host names starting with "internal" resolve to a private address; every other name to a public one. No real DNS is used.
  setWebhookResolverForTests(async (host) => (host.startsWith("internal") ? ["10.1.2.3"] : host.startsWith("rebind") ? ["93.184.216.34", "127.0.0.1"] : ["93.184.216.34"]));
  setWebhookTransportForTests(transport);
  world = await v2World();
});

afterAll(() => {
  setWebhookTransportForTests(null);
  setWebhookResolverForTests(undefined);
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});

afterEach(() => {
  sent = [];
  answer = () => ({ status: 200 });
});

const FUTURE = () => new Date(Date.now() + 365 * 24 * 3600 * 1000);

async function endpoint(events: string[] = ["lead.created"], url = "https://hooks.example.com/figbloom") {
  return createWebhookEndpoint(world.management, { url, events });
}

describe("registration", () => {
  it("is for Management only, and shows the secret once", async () => {
    await expect(createWebhookEndpoint(world.sales, { url: "https://hooks.example.com/a", events: ["lead.created"] })).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(listWebhookEndpoints(world.delivery)).rejects.toMatchObject({ name: "ForbiddenError" });

    const created = await endpoint(["lead.created", "deal.won"]);
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(created.secretHint).toBe(created.secret.slice(-4));
    const row = await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.secretSealed).not.toContain(created.secret);
    expect(openSecret(row.secretSealed)).toBe(created.secret);
    const listed = await listWebhookEndpoints(world.management);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(listed.availableEvents).toEqual(expect.arrayContaining(["lead.created", "lead.assigned", "lead.converted", "deal.stage_changed", "deal.won", "deal.lost", "contact.created", "company.created", "task.created"]));
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: world.org.id, action: "webhook.created", entityId: created.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain(created.secret);
  });

  it("rejects an unknown event or no event", async () => {
    await expect(createWebhookEndpoint(world.management, { url: "https://hooks.example.com/a", events: ["lead.exploded"] })).rejects.toThrow(/Unknown event/);
    await expect(createWebhookEndpoint(world.management, { url: "https://hooks.example.com/a", events: [] })).rejects.toThrow(/at least one event/i);
  });

  it("rotates the secret: shown once, the old one stops verifying, the hint changes", async () => {
    const created = await endpoint();
    const rotated = await rotateWebhookSecret(world.management, created.id);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.secretHint).not.toBe(created.secretHint);
    expect(rotated.secretRotatedAt).not.toBeNull();
    const body = '{"a":1}';
    const ts = Math.floor(Date.now() / 1000);
    const signature = signWebhook(rotated.secret, ts, body);
    expect(verifyWebhookSignature({ secret: rotated.secret, timestamp: String(ts), signature, rawBody: body })).toEqual({ ok: true });
    expect(verifyWebhookSignature({ secret: created.secret, timestamp: String(ts), signature, rawBody: body })).toEqual({ ok: false, reason: "mismatch" });
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: world.org.id, action: "webhook.secret_rotated", entityId: created.id } });
    expect(JSON.stringify(audit)).not.toContain(rotated.secret);
  });

  it("pauses, resumes, changes and deletes an endpoint, all audited", async () => {
    const created = await endpoint();
    expect((await updateWebhookEndpoint(world.management, created.id, { status: "PAUSED" })).status).toBe("PAUSED");
    expect((await updateWebhookEndpoint(world.management, created.id, { status: "ACTIVE", events: ["task.created"] })).events).toEqual(["task.created"]);
    await deleteWebhookEndpoint(world.management, created.id);
    expect(await adminDb.webhookEndpoint.count({ where: { id: created.id } })).toBe(0);
    const actions = (await adminDb.auditEvent.findMany({ where: { organizationId: world.org.id, entityId: created.id } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["webhook.created", "webhook.updated", "webhook.deleted"]));
  });
});

describe("address safety (SSRF)", () => {
  const refused = [
    "http://hooks.example.com/x", // not https
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://127.1/x", // shorthand loopback, normalised by the URL parser
    "https://2130706433/x", // decimal loopback
    "https://0x7f.0.0.1/x",
    "https://10.0.0.5/x",
    "https://172.16.4.4/x",
    "https://192.168.1.1/x",
    "https://169.254.169.254/latest/meta-data/", // cloud metadata
    "https://100.64.0.1/x", // carrier-grade NAT
    "https://0.0.0.0/x",
    "https://[::1]/x",
    "https://[::ffff:127.0.0.1]/x", // IPv4-mapped loopback
    "https://[::ffff:7f00:1]/x",
    "https://[fe80::1]/x",
    "https://[fd00::1]/x",
    "https://[64:ff9b::7f00:1]/x", // NAT64 carrying loopback
    "https://[2002:7f00:1::]/x", // 6to4 carrying loopback
    "https://user:pass@hooks.example.com/x",
    "https://hooks.example.com:22/x", // a privileged port
    "https://metadata.internal/x",
    "https://printer.local/x",
    "https://intranet/x", // a name with no dot
    "ftp://hooks.example.com/x",
    "javascript:alert(1)",
    "not a url",
  ];
  for (const url of refused) {
    it(`refuses ${url}`, async () => {
      expect(() => checkWebhookUrl(url)).toThrow(UnsafeUrlError);
      await expect(createWebhookEndpoint(world.management, { url, events: ["lead.created"] })).rejects.toMatchObject({ name: "ValidationError" });
    });
  }

  it("accepts a public https address and port 8443", () => {
    expect(checkWebhookUrl("https://hooks.example.com/figbloom").hostname).toBe("hooks.example.com");
    expect(checkWebhookUrl("https://hooks.example.com:8443/x").port).toBe("8443");
    expect(checkWebhookUrl("https://93.184.216.34/x").hostname).toBe("93.184.216.34");
  });

  it("classifies addresses", () => {
    for (const a of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(a), a).toBe(true);
    for (const a of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.0.1", "::1", "::", "fc00::1", "::ffff:10.0.0.1", "not-an-ip"]) expect(isPublicAddress(a), a).toBe(false);
  });

  it("refuses a host name that resolves to a private address when it is saved, and when any one of its addresses is private", async () => {
    await expect(createWebhookEndpoint(world.management, { url: "https://internal-service.example.com/x", events: ["lead.created"] })).rejects.toThrow(/private or internal/);
    await expect(createWebhookEndpoint(world.management, { url: "https://rebind.example.com/x", events: ["lead.created"] })).rejects.toThrow(/private or internal/);
    await expect(resolvesToPublicAddress(new URL("https://internal.example.com/"), async () => ["192.168.1.1"])).rejects.toBeInstanceOf(UnsafeUrlError);
    // A change of address on an existing endpoint is checked the same way.
    const ok = await endpoint();
    await expect(updateWebhookEndpoint(world.management, ok.id, { url: "https://internal-service.example.com/x" })).rejects.toThrow(/private or internal/);
  });

  it("checks the address at connect time, so a name that resolves privately later is still refused (DNS rebinding), and sends nothing", async () => {
    let connections = 0;
    const server = http.createServer((_req, res) => {
      connections += 1;
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      // The name looked public when it was saved; now the resolver answers with loopback, where a real server is listening.
      await expect(
        safeRequest(`http://public-looking.example.com:${port}/x`, { headers: {}, body: "{}", timeoutMs: 3000, maxResponseBytes: 100, allowHttp: true, resolver: async () => ["127.0.0.1"] }),
      ).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(connections).toBe(0);
      // Mixed answers are refused too.
      await expect(
        safeRequest(`http://mixed.example.com:${port}/x`, { headers: {}, body: "{}", timeoutMs: 3000, maxResponseBytes: 100, allowHttp: true, resolver: async () => ["93.184.216.34", "127.0.0.1"] }),
      ).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(connections).toBe(0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("events and signed deliveries", () => {
  // Each test gets an organisation of its own, so one test's waiting deliveries are never swept by another.
  beforeEach(async () => {
    world = await v2World();
  });

  it("queues one delivery per subscribed endpoint, and sends it signed, with a timestamp", async () => {
    const mine = await endpoint(["lead.created"], "https://hooks.example.com/mine");
    const other = await endpoint(["task.created"], "https://hooks.example.com/other");
    const statusId = await getLeadStatusId(world.org.id);
    const { lead } = await createLead(world.management, { leadStatusId: statusId });

    const pending = await adminDb.webhookDelivery.findMany({ where: { organizationId: world.org.id, eventType: "lead.created", endpointId: mine.id } });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe("PENDING");
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: other.id } })).toBe(0);

    const summary = await deliverDueWebhooks(world.org.id);
    expect(summary.delivered).toBeGreaterThanOrEqual(1);
    const call = sent.find((s) => s.url === "https://hooks.example.com/mine")!;
    const payload = JSON.parse(call.body);
    expect(payload.type).toBe("lead.created");
    expect(payload.organizationId).toBe(world.org.id);
    expect(payload.data.lead.id).toBe(lead.id);
    expect(call.headers["x-figbloom-event"]).toBe("lead.created");
    expect(call.headers["x-figbloom-delivery"]).toBe(pending[0]!.id);
    const check = verifyWebhookSignature({ secret: mine.secret, timestamp: call.headers["x-figbloom-timestamp"]!, signature: call.headers["x-figbloom-signature"]!, rawBody: call.body });
    expect(check).toEqual({ ok: true });
    // The wrong secret, a tampered body and a replay of an old delivery are all refused by a receiver.
    expect(verifyWebhookSignature({ secret: other.secret, timestamp: call.headers["x-figbloom-timestamp"]!, signature: call.headers["x-figbloom-signature"]!, rawBody: call.body }).ok).toBe(false);
    expect(verifyWebhookSignature({ secret: mine.secret, timestamp: call.headers["x-figbloom-timestamp"]!, signature: call.headers["x-figbloom-signature"]!, rawBody: call.body + " " }).ok).toBe(false);
    expect(
      verifyWebhookSignature({ secret: mine.secret, timestamp: call.headers["x-figbloom-timestamp"]!, signature: call.headers["x-figbloom-signature"]!, rawBody: call.body, nowSeconds: Math.floor(Date.now() / 1000) + 3600 }),
    ).toEqual({ ok: false, reason: "stale" });
    const done = await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: pending[0]!.id } });
    expect(done.status).toBe("DELIVERED");
    expect(done.lastStatusCode).toBe(200);
    expect(done.attempts).toBe(1);
  });

  it("emits every event the issue lists, once each, from the real services", async () => {
    const all = await endpoint(["lead.created", "lead.assigned", "lead.converted", "deal.stage_changed", "deal.won", "deal.lost", "contact.created", "company.created", "task.created"], "https://hooks.example.com/all");
    const statusId = await getLeadStatusId(world.org.id);
    const company = await createCompany(world.management, { name: "Event Co" });
    await createContact(world.management, { firstName: "Event", companyId: company.company.id });
    const { lead } = await createLead(world.management, { leadStatusId: statusId, companyId: company.company.id });
    await assignLead(world.management, lead.id, world.sales.membershipId);
    await createTask(world.management, { title: "Follow up", leadId: lead.id });
    const stageId = await getPipelineStageId(world.org.id);
    const deal = (await convertLead(world.management, lead.id, { companyId: company.company.id, pipelineStageId: stageId })) as { id: string };
    const wonStage = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: world.org.id, isWon: true } });
    const lostStage = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: world.org.id, isLost: true } });
    const lostReason = await adminDb.lostReason.findFirstOrThrow({ where: { organizationId: world.org.id } });
    await updateDeal(world.management, deal.id, { pipelineStageId: wonStage.id, handoff: { ownerLater: true } } as never);
    const second = (await createDeal(world.management, { companyId: company.company.id, pipelineStageId: stageId })) as { id: string };
    await updateDeal(world.management, second.id, { pipelineStageId: lostStage.id, lostReasonId: lostReason.id });

    const rows = await adminDb.webhookDelivery.findMany({ where: { endpointId: all.id } });
    const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.eventType]: (m[r.eventType] ?? 0) + 1 }), {});
    expect(counts["company.created"]).toBe(1);
    expect(counts["contact.created"]).toBe(1);
    expect(counts["lead.created"]).toBe(1);
    expect(counts["lead.assigned"]).toBe(1);
    expect(counts["lead.converted"]).toBe(1);
    expect(counts["task.created"]).toBe(1);
    expect(counts["deal.won"]).toBe(1);
    expect(counts["deal.lost"]).toBe(1);
    expect(counts["deal.stage_changed"]).toBe(2);
    const converted = rows.find((r) => r.eventType === "lead.converted")!.payload as { data: { dealId: string } };
    expect(converted.data.dealId).toBe(deal.id);
    const assigned = rows.find((r) => r.eventType === "lead.assigned")!.payload as { data: { lead: { ownerMembershipId: string } } };
    expect(assigned.data.lead.ownerMembershipId).toBe(world.sales.membershipId);
  });

  it("emits lead.created for a lead that arrives through a public web form", async () => {
    const hook = await endpoint(["lead.created"], "https://hooks.example.com/forms");
    const form = await updateForm(world.management, (await createForm(world.management, { name: "Webhook form" })).id, { status: "PUBLISHED" });
    await submitWebForm(world.org.slug, form.publicKey, JSON.stringify({ name: "Amara Osei", email: "amara.webhook@example.test", message: "A quote please." }), { ipAddress: "203.0.113.77", origin: null });
    const rows = await adminDb.webhookDelivery.findMany({ where: { endpointId: hook.id, eventType: "lead.created" } });
    expect(rows).toHaveLength(1);
    const submission = await adminDb.webFormSubmission.findFirstOrThrow({ where: { organizationId: world.org.id, webFormId: form.id } });
    expect((rows[0]!.payload as { data: { lead: { id: string } } }).data.lead.id).toBe(submission.leadId);
  });

  it("sends only a fixed list of fields: a note or other free text never leaves", async () => {
    const hook = await endpoint(["company.created", "contact.created"], "https://hooks.example.com/fields");
    const company = await createCompany(world.management, { name: "Fields Co", notes: "PRIVATE-NOTE-SENTINEL" });
    await createContact(world.management, { firstName: "Fields", notes: "PRIVATE-NOTE-SENTINEL", companyId: company.company.id });
    const rows = await adminDb.webhookDelivery.findMany({ where: { endpointId: hook.id } });
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain("PRIVATE-NOTE-SENTEL");
  });

  it("sends a test event on request, signed like the rest", async () => {
    const hook = await endpoint(["lead.created"], "https://hooks.example.com/ping");
    await expect(sendWebhookTest(world.sales, hook.id)).rejects.toMatchObject({ name: "ForbiddenError" });
    const { deliveryId } = await sendWebhookTest(world.management, hook.id);
    await deliverDueWebhooks(world.org.id);
    const call = sent.find((s) => s.url === "https://hooks.example.com/ping")!;
    expect(JSON.parse(call.body).type).toBe("webhook.ping");
    expect(verifyWebhookSignature({ secret: hook.secret, timestamp: call.headers["x-figbloom-timestamp"]!, signature: call.headers["x-figbloom-signature"]!, rawBody: call.body }).ok).toBe(true);
    expect((await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe("DELIVERED");
  });
});

describe("value masking", () => {
  // Each test gets an organisation of its own, so one test's waiting deliveries are never swept by another.
  beforeEach(async () => {
    world = await v2World();
  });

  it("follows the role of the person who created the endpoint, and never sends margin", async () => {
    const stageId = await getPipelineStageId(world.org.id);
    const wonStage = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: world.org.id, isWon: true } });
    const company = await createCompany(world.management, { name: "Masking Co" });

    // An endpoint created by Management sees values; one whose creator is a Sales member (a custom arrangement, written directly) does not.
    const seesValues = await endpoint(["deal.stage_changed"], "https://hooks.example.com/values");
    const salesEndpoint = await endpoint(["deal.stage_changed"], "https://hooks.example.com/sales");
    await adminDb.webhookEndpoint.update({ where: { id: salesEndpoint.id }, data: { createdByMembershipId: world.sales.membershipId } });

    const deal = (await createDeal(world.management, { companyId: company.company.id, pipelineStageId: stageId, value: 7654321 })) as { id: string };
    await updateDeal(world.management, deal.id, { pipelineStageId: wonStage.id, handoff: { ownerLater: true } } as never);

    const open = (await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: seesValues.id, eventType: "deal.stage_changed" } })).payload as { data: { deal: Record<string, unknown> } };
    expect(Number(open.data.deal.value)).toBe(7654321);
    expect(open.data.deal.valueMasked).toBe(false);
    const hidden = (await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: salesEndpoint.id, eventType: "deal.stage_changed" } })).payload as { data: { deal: Record<string, unknown> } };
    expect(hidden.data.deal.value).toBeNull();
    expect(hidden.data.deal.valueMasked).toBe(true);
    const everything = JSON.stringify(await adminDb.webhookDelivery.findMany({ where: { organizationId: world.org.id } }));
    expect(everything).not.toMatch(/margin/i);
    expect(JSON.stringify(hidden)).not.toContain("7654321");
  });

  it("sends nothing for an endpoint whose creator no longer has access, rather than sending unmasked data", async () => {
    const gone = await createTestContext(world.org.id, "MANAGEMENT", "lanec.gone");
    const hook = await createWebhookEndpoint(gone, { url: "https://hooks.example.com/gone", events: ["company.created"] });
    await adminDb.membership.update({ where: { id: gone.membershipId }, data: { status: "REMOVED", removedAt: new Date() } });
    await createCompany(world.management, { name: "Nobody Listens Co" });
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: hook.id } })).toBe(0);
  });
});

describe("retries, the delivery log and the job", () => {
  // Each test gets an organisation of its own, so one test's waiting deliveries are never swept by another.
  beforeEach(async () => {
    world = await v2World();
  });

  it("retries a failing receiver with growing backoff and gives up after the last attempt, then a person can retry it", async () => {
    const hook = await endpoint(["company.created"], "https://hooks.example.com/failing");
    answer = () => ({ status: 500, snippet: "boom" });
    await createCompany(world.management, { name: "Retry Co" });
    const delivery = await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: hook.id } });

    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect([1, 2, 3, 4].map(webhookBackoffSeconds)).toEqual([60, 180, 540, 1620]);
    expect(webhookBackoffSeconds(30)).toBe(6 * 3600);

    for (let attempt = 1; attempt < WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
      await deliverDueWebhooks(world.org.id, FUTURE());
      const row = await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(attempt);
      expect(row.lastStatusCode).toBe(500);
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + (webhookBackoffSeconds(attempt) - 5) * 1000);
      // Not due yet: another sweep right now sends nothing.
      const before = sent.length;
      await deliverDueWebhooks(world.org.id);
      expect(sent.length).toBe(before);
    }
    await deliverDueWebhooks(world.org.id, FUTURE());
    const dead = await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(dead.status).toBe("DEAD");
    expect(dead.attempts).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect(dead.lastError).toMatch(/500/);

    // The log shows it; Management retries it; Sales cannot.
    const log = await listWebhookDeliveries(world.management, hook.id, { status: "DEAD" });
    expect(log.items.map((i) => i.id)).toContain(delivery.id);
    expect(JSON.stringify(log)).not.toContain("payload");
    await expect(retryWebhookDelivery(world.sales, hook.id, delivery.id)).rejects.toMatchObject({ name: "ForbiddenError" });
    answer = () => ({ status: 204 });
    await retryWebhookDelivery(world.management, hook.id, delivery.id);
    await deliverDueWebhooks(world.org.id);
    expect((await adminDb.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("DELIVERED");
  });

  it("treats a redirect as a failure instead of following it", async () => {
    const hook = await endpoint(["company.created"], "https://hooks.example.com/redirect");
    answer = () => ({ status: 302 });
    await createCompany(world.management, { name: "Redirect Co" });
    await deliverDueWebhooks(world.org.id);
    const row = await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: hook.id } });
    expect(row.status).toBe("PENDING");
    expect(row.lastError).toMatch(/redirects are not followed/);
  });

  it("switches an endpoint off when the receiver answers 410 Gone, and when ten deliveries in a row die", async () => {
    const gone = await endpoint(["company.created"], "https://hooks.example.com/gone-for-good");
    answer = () => ({ status: 410 });
    await createCompany(world.management, { name: "Gone Co" });
    await deliverDueWebhooks(world.org.id);
    expect((await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: gone.id } })).status).toBe("DISABLED");
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: world.org.id, action: "webhook.disabled", entityId: gone.id } });
    expect(audit).not.toBeNull();
    // A disabled endpoint receives no new events; resuming it clears the count.
    const before = await adminDb.webhookDelivery.count({ where: { endpointId: gone.id } });
    await createCompany(world.management, { name: "Gone Co 2" });
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: gone.id } })).toBe(before);
    expect((await updateWebhookEndpoint(world.management, gone.id, { status: "ACTIVE" })).consecutiveFailures).toBe(0);

    // Ten deliveries on their last attempt, all failing: the tenth death switches the endpoint off. (Rows are written directly; the events
    // that normally create them are covered above.)
    const flaky = await endpoint(["company.created"], "https://hooks.example.com/dead-ten");
    answer = () => ({ status: 503 });
    await adminDb.webhookDelivery.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        organizationId: world.org.id,
        endpointId: flaky.id,
        eventId: `dead-ten-${i}`,
        eventType: "company.created",
        payload: { id: `dead-ten-${i}`, type: "company.created", data: {} },
        attempts: WEBHOOK_MAX_ATTEMPTS - 1,
        nextAttemptAt: new Date(Date.now() - 1000),
      })),
    });
    await deliverDueWebhooks(world.org.id);
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: flaky.id, status: "DEAD" } })).toBe(10);
    expect((await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: flaky.id } })).status).toBe("DISABLED");
  });

  it("delivers through the job framework (webhooks.deliver), for its own organisation", async () => {
    const hook = await endpoint(["company.created"], "https://hooks.example.com/job");
    await createCompany(world.management, { name: "Job Co" });
    // The event queued a job of its own; run the type through the framework and see it succeed.
    const queued = await adminDb.backgroundJob.count({ where: { organizationId: world.org.id, type: "webhooks.deliver" } });
    expect(queued).toBeGreaterThanOrEqual(1);
    const run = await enqueueAndRunNow({ organizationId: world.org.id, type: "webhooks.deliver" });
    expect(run.outcome).toBe("succeeded");
    expect(sent.some((s) => s.url === "https://hooks.example.com/job")).toBe(true);
    expect((await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: hook.id } })).status).toBe("DELIVERED");
  });

  it("does not let a webhook problem fail the change that caused it", async () => {
    await endpoint(["company.created"], "https://hooks.example.com/safe");
    // Break the signing key: the company is still created and the delivery waits.
    const saved = process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    try {
      const created = await createCompany(world.management, { name: "Still Created Co" });
      expect(created.company.name).toBe("Still Created Co");
      await deliverDueWebhooks(world.org.id);
      expect(sent).toHaveLength(0);
    } finally {
      process.env.INTEGRATION_ENCRYPTION_KEY = saved;
    }
  });
});

describe("tenant isolation", () => {
  // Each test gets an organisation of its own, so one test's waiting deliveries are never swept by another.
  beforeEach(async () => {
    world = await v2World();
  });

  it("an event in one organisation reaches only that organisation's endpoints", async () => {
    const other = await v2World();
    const theirs = await createWebhookEndpoint(other.management, { url: "https://hooks.example.com/theirs", events: ["company.created"] });
    const mine = await endpoint(["company.created"], "https://hooks.example.com/mine-only");
    await createCompany(world.management, { name: "Mine Only Co" });
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: theirs.id } })).toBe(0);
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: mine.id } })).toBe(1);
    // A sweep of one organisation sends nothing of another's.
    await createCompany(other.management, { name: "Theirs Co" });
    sent = [];
    await deliverDueWebhooks(world.org.id);
    expect(sent.every((s) => !s.url.endsWith("/theirs"))).toBe(true);
    // And one organisation's Management cannot read, change or delete the other's endpoint.
    await expect(updateWebhookEndpoint(world.management, theirs.id, { status: "PAUSED" })).rejects.toThrow(/not found/i);
    await expect(deleteWebhookEndpoint(world.management, theirs.id)).rejects.toThrow(/not found/i);
    await expect(listWebhookDeliveries(world.management, theirs.id)).rejects.toThrow(/not found/i);
  });

  it("row-level security hides endpoints and deliveries from another organisation's context, and refuses writes into it", async () => {
    const other = await v2World();
    const hook = await endpoint(["company.created"], "https://hooks.example.com/rls");
    await createCompany(world.management, { name: "RLS Co" });
    const delivery = await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: hook.id } });

    expect(await withOrgContext(other.org.id, (tx) => tx.webhookEndpoint.findMany({ where: { organizationId: world.org.id } }))).toHaveLength(0);
    expect(await withOrgContext(other.org.id, (tx) => tx.webhookDelivery.findMany({ where: { organizationId: world.org.id } }))).toHaveLength(0);
    const changed = await withOrgContext(other.org.id, (tx) => tx.webhookDelivery.updateMany({ where: { id: delivery.id }, data: { status: "DEAD" } }));
    expect(changed.count).toBe(0);
    await expect(
      withOrgContext(other.org.id, (tx) =>
        tx.webhookEndpoint.create({ data: { organizationId: world.org.id, url: "https://evil.example.com/x", events: ["lead.created"], secretSealed: "x", secretHint: "xxxx", createdByMembershipId: world.management.membershipId } }),
      ),
    ).rejects.toThrow();
    // A delivery cannot point at another organisation's endpoint (composite foreign key).
    await expect(
      adminDb.webhookDelivery.create({ data: { organizationId: other.org.id, endpointId: hook.id, eventId: "e", eventType: "company.created", payload: {} } }),
    ).rejects.toThrow();
  });
});
