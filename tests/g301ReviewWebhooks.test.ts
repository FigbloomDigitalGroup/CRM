/**
 * G3.01 independent security review (FIG-1191), outbound webhooks (FIG-804): secrets, payload masking, tenant isolation and what the
 * delivery job does with an endpoint the database was made to hold. No outside host is contacted: deliveries go to a recording stub, and
 * the unsafe-address tests are refused before any connection is made.
 * A passing test shows a defence holds. A test marked `it.fails` is a confirmed gap, written up in docs/M17_SECURITY_REVIEW_G3_01.md.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { verifyWebhookSignature } from "../src/lib/webhookEvents";
import { createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import { createDeal, updateDeal } from "../src/services/dealService";
import {
  createWebhookEndpoint,
  deliverDueWebhooks,
  listWebhookDeliveries,
  listWebhookEndpoints,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookResolverForTests,
  setWebhookTransportForTests,
  updateWebhookEndpoint,
  type DeliveryTransport,
} from "../src/services/webhookService";
import { createTestContext, getPipelineStageId } from "./helpers/fixtures";
import { v2World } from "./helpers/laneC";

const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];
const transport: DeliveryTransport = async (call) => {
  sent.push(call);
  return { status: 200, snippet: "" };
};
let world: Awaited<ReturnType<typeof v2World>>;
let other: Awaited<ReturnType<typeof v2World>>;

beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  setWebhookResolverForTests(async () => ["93.184.216.34"]);
  setWebhookTransportForTests(transport);
  world = await v2World();
  other = await v2World();
});

afterAll(() => {
  setWebhookTransportForTests(null);
  setWebhookResolverForTests(undefined);
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});

describe("G3.01 webhooks: the secret", () => {
  it("is shown once, stored sealed, and appears in no list, log, audit entry or delivery row", async () => {
    const created = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/a", events: ["company.created"] });
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const row = await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.secretSealed).not.toContain(created.secret);
    expect(row.secretSealed.startsWith("v1.")).toBe(true);
    const everywhere = JSON.stringify([
      await listWebhookEndpoints(world.management),
      await adminDb.auditEvent.findMany({ where: { organizationId: world.org.id } }),
      await adminDb.webhookDelivery.findMany({ where: { organizationId: world.org.id } }),
    ]);
    expect(everywhere).not.toContain(created.secret);
    expect(everywhere).not.toContain(created.secret.slice(6));
  });

  it("a rotated secret signs the very next delivery; the old one no longer verifies it", async () => {
    const created = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/rot", events: ["company.created"] });
    const rotated = await rotateWebhookSecret(world.management, created.id);
    expect(rotated.secret).not.toBe(created.secret);
    sent = [];
    await sendWebhookTest(world.management, created.id);
    await deliverDueWebhooks(world.org.id);
    const call = sent.find((s) => s.url.endsWith("/rot"))!;
    const check = (secret: string) => verifyWebhookSignature({ secret, timestamp: call.headers["x-figbloom-timestamp"]!, signature: call.headers["x-figbloom-signature"]!, rawBody: call.body });
    expect(check(rotated.secret)).toEqual({ ok: true });
    expect(check(created.secret)).toMatchObject({ ok: false });
  });

  it("every attempt is signed afresh with its own timestamp, so a retry is not a replay of the first", async () => {
    const created = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/ts", events: ["company.created"] });
    sent = [];
    await sendWebhookTest(world.management, created.id);
    await deliverDueWebhooks(world.org.id);
    const call = sent.find((s) => s.url.endsWith("/ts"))!;
    expect(Math.abs(Number(call.headers["x-figbloom-timestamp"]) - Date.now() / 1000)).toBeLessThan(30);
    expect(call.headers["x-figbloom-signature-version"]).toBe("v1");
    expect(call.headers["content-type"]).toBe("application/json");
  });

  it("only Management can register, change, rotate or test an endpoint: Sales, Delivery and Finance are refused", async () => {
    const hook = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/mgmt", events: ["company.created"] });
    const finance = await createTestContext(world.org.id, "FINANCE", "g301.fin");
    for (const ctx of [world.sales, world.delivery, finance]) {
      await expect(createWebhookEndpoint(ctx, { url: "https://hooks.example.com/x", events: ["company.created"] })).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(listWebhookEndpoints(ctx)).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(rotateWebhookSecret(ctx, hook.id)).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(updateWebhookEndpoint(ctx, hook.id, { url: "https://hooks.example.com/steal" })).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(sendWebhookTest(ctx, hook.id)).rejects.toMatchObject({ name: "ForbiddenError" });
    }
  });
});

describe("G3.01 webhooks: payload contents", () => {
  it("never contains margin, cost, notes, payments or custom fields, whatever the record carries", async () => {
    const hook = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/payload", events: ["deal.stage_changed", "deal.won", "deal.lost", "company.created", "contact.created", "task.created", "lead.created"] });
    const company = await createCompany(world.management, { name: "Payload Co", notes: "INTERNAL-NOTE-SENTINEL" } as never);
    await createContact(world.management, { firstName: "Pay", companyId: company.company.id, notes: "INTERNAL-NOTE-SENTINEL" } as never);
    const stageId = await getPipelineStageId(world.org.id);
    const won = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: world.org.id, isWon: true } });
    const deal = (await createDeal(world.management, { companyId: company.company.id, pipelineStageId: stageId, value: 5000, notes: "INTERNAL-NOTE-SENTINEL" })) as { id: string };
    await updateDeal(world.management, deal.id, { pipelineStageId: won.id, handoff: { ownerLater: true } } as never);
    const rows = await adminDb.webhookDelivery.findMany({ where: { endpointId: hook.id } });
    expect(rows.length).toBeGreaterThan(2);
    const text = JSON.stringify(rows.map((r) => r.payload));
    expect(text).not.toMatch(/INTERNAL-NOTE-SENTINEL|margin|cost|payment|invoice|customFields|notes/i);
  });
});

describe("G3.01 webhooks: who an endpoint speaks for", () => {
  it("masks by the creator's role as it is now: a Management creator moved to Sales stops receiving other people's deal values", async () => {
    const creator = await createTestContext(world.org.id, "MANAGEMENT", "g301.creator");
    const hook = await createWebhookEndpoint(creator, { url: "https://hooks.example.com/demoted", events: ["deal.stage_changed"] });
    const salesRole = await adminDb.role.findFirstOrThrow({ where: { key: "SALES", organizationId: null } });
    await adminDb.membership.update({ where: { id: creator.membershipId }, data: { roleId: salesRole.id } });
    const company = await createCompany(world.management, { name: "Demoted Co" });
    const stageId = await getPipelineStageId(world.org.id);
    const won = await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId: world.org.id, isWon: true } });
    const deal = (await createDeal(world.management, { companyId: company.company.id, pipelineStageId: stageId, value: 8123456 })) as { id: string };
    await updateDeal(world.management, deal.id, { pipelineStageId: won.id, handoff: { ownerLater: true } } as never);
    const rows = await adminDb.webhookDelivery.findMany({ where: { endpointId: hook.id } });
    expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain("8123456");
  });

  // FINDING (Medium): an endpoint is built "as its creator" only for deal values. For leads, contacts, companies and tasks the payload is a fixed
  // field list sent to the URL whatever the creator's role is NOW. A Management member who registered an endpoint and was then moved to a role with
  // no access to contacts (Delivery here) keeps receiving every new contact's name, email and phone at the URL they chose, with no one able to see it
  // from the creator's account. (Removal of the creator does stop it: tested in webhooks.test.ts.) Expected: an endpoint whose creator no longer
  // holds `organization.manage_settings` is paused, or its payload is built under the creator's current permissions.
  it.fails("an endpoint whose creator lost the right to manage settings no longer receives contact data", async () => {
    const creator = await createTestContext(world.org.id, "MANAGEMENT", "g301.creator2");
    const hook = await createWebhookEndpoint(creator, { url: "https://hooks.example.com/demoted2", events: ["contact.created"] });
    const delivery = await adminDb.role.findFirstOrThrow({ where: { key: "DELIVERY", organizationId: null } });
    await adminDb.membership.update({ where: { id: creator.membershipId }, data: { roleId: delivery.id } });
    await createContact(world.management, { firstName: "Leaky", lastName: "Contact", email: "leaky@example.test", phone: "+254700000000" } as never);
    const rows = await adminDb.webhookDelivery.findMany({ where: { endpointId: hook.id } });
    expect(rows).toHaveLength(0);
  });
});

describe("G3.01 webhooks: tenant isolation of deliveries and of the job", () => {
  it("running the delivery job for one organisation sends none of another organisation's deliveries", async () => {
    const mine = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/mine", events: ["company.created"] });
    const theirs = await createWebhookEndpoint(other.management, { url: "https://hooks.example.com/theirs", events: ["company.created"] });
    await createCompany(world.management, { name: "Mine Co" });
    await createCompany(other.management, { name: "Theirs Co" });
    sent = [];
    await deliverDueWebhooks(world.org.id);
    expect(sent.some((s) => s.url.endsWith("/theirs"))).toBe(false);
    expect(sent.some((s) => s.url.endsWith("/mine"))).toBe(true);
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: theirs.id, status: "PENDING" } })).toBeGreaterThan(0);
    expect(await adminDb.webhookDelivery.count({ where: { endpointId: mine.id, status: "PENDING" } })).toBe(0);
  });

  it("a delivery row cannot point at another organisation's endpoint (composite foreign key), and a context cannot list another's deliveries", async () => {
    const theirs = await createWebhookEndpoint(other.management, { url: "https://hooks.example.com/theirs2", events: ["company.created"] });
    await expect(
      withOrgContext(world.org.id, (tx) =>
        tx.webhookDelivery.create({ data: { organizationId: world.org.id, endpointId: theirs.id, eventId: "e", eventType: "company.created", payload: { x: 1 }, nextAttemptAt: new Date() } }),
      ),
    ).rejects.toThrow(/org_endpoint_fk|Foreign key/); // the composite foreign key refuses it
    sent = [];
    await deliverDueWebhooks(world.org.id);
    expect(sent.some((s) => s.url.endsWith("/theirs2"))).toBe(false);
    expect(await withOrgContext(world.org.id, (tx) => tx.webhookEndpoint.count({ where: { id: theirs.id } }))).toBe(0);
    await expect(listWebhookDeliveries(world.management, theirs.id)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("a rotated secret of one organisation's endpoint cannot be reached through another organisation's id", async () => {
    const theirs = await createWebhookEndpoint(other.management, { url: "https://hooks.example.com/theirs3", events: ["company.created"] });
    await expect(rotateWebhookSecret(world.management, theirs.id)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(updateWebhookEndpoint(world.management, theirs.id, { url: "https://hooks.example.com/hijack" })).rejects.toMatchObject({ name: "NotFoundError" });
    expect((await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: theirs.id } })).url).toContain("theirs3");
  });
});

describe("G3.01 webhooks: the delivery job re-checks the address it is about to use", () => {
  it("an endpoint whose stored address was made internal after it was saved (changed in the database) is refused at delivery, nothing is sent", async () => {
    setWebhookTransportForTests(null); // the real sender: it must refuse before any connection is made
    try {
      for (const url of ["https://127.0.0.1/hook", "https://169.254.169.254/latest/meta-data/", "https://[::1]/hook", "https://10.0.0.7/hook", "https://localhost/hook", "http://hooks.example.com/hook"]) {
        const hook = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/will-change", events: ["company.created"] });
        await adminDb.webhookEndpoint.update({ where: { id: hook.id }, data: { url } });
        await sendWebhookTest(world.management, hook.id);
        const summary = await deliverDueWebhooks(world.org.id);
        expect(summary.delivered, url).toBe(0);
        const row = await adminDb.webhookDelivery.findFirstOrThrow({ where: { endpointId: hook.id }, orderBy: { createdAt: "desc" } });
        expect(row.status === "PENDING" || row.status === "DEAD", url).toBe(true);
        expect(row.lastError, url).toMatch(/Refused|https/);
        expect(row.lastStatusCode, url).toBeNull();
      }
    } finally {
      setWebhookTransportForTests(transport);
    }
  });

  it("saving a new address is judged the same way as creating one", async () => {
    const hook = await createWebhookEndpoint(world.management, { url: "https://hooks.example.com/ok", events: ["company.created"] });
    for (const url of ["https://127.0.0.1/", "https://[::ffff:127.0.0.1]/", "https://2130706433/", "http://hooks.example.com/", "https://169.254.169.254/"]) {
      await expect(updateWebhookEndpoint(world.management, hook.id, { url }), url).rejects.toMatchObject({ name: "ValidationError" });
    }
    expect((await adminDb.webhookEndpoint.findUniqueOrThrow({ where: { id: hook.id } })).url).toBe("https://hooks.example.com/ok");
  });
});
