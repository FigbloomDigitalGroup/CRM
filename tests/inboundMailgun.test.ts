import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/public/inbound/mailgun/route";
import { inboundBccAddressFor } from "../src/auth/inboundBccAddress";
import { adminDb } from "../src/db/adminClient";
import { mapMailgunPayload } from "../src/integrations/inbound/mailgun";
import { createContact } from "../src/services/contactService";
import { getInboundEmailIntegrationStatus } from "../src/services/integrationService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const KEY = "test-signing-key-not-a-real-secret";
const DOMAIN = "inbound.example.test";

function build(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://localhost/api/public/inbound/mailgun", { method: "POST", body: form });
}

function signed(
  fields: Record<string, string>,
  opts: { key?: string; timestamp?: number; token?: string; signature?: string } = {},
) {
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const token = opts.token ?? randomUUID().replace(/-/g, "");
  const signature = opts.signature ?? createHmac("sha256", opts.key ?? KEY).update(timestamp + token).digest("hex");
  return { ...fields, timestamp, token, signature };
}

async function call(fields: Record<string, string>) {
  const res = await POST(build(fields));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("Mailgun inbound webhook (FIG-806)", () => {
  beforeEach(() => {
    vi.stubEnv("MAILGUN_INBOUND_SIGNING_KEY", KEY);
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", DOMAIN);
    vi.stubEnv("INBOUND_EMAIL_ADDRESS_SECRET", "x".repeat(40));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function setup() {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const address = inboundBccAddressFor(org)!;
    const { contact } = await createContact(ctx, { firstName: "Jane", email: `jane.${randomUUID().slice(0, 6)}@example.test` });
    return { org, ctx, address, contact };
  }

  it("accepts a valid signature and logs the message on the matching contact's timeline", async () => {
    const { org, address, contact } = await setup();
    const out = await call(
      signed({ recipient: address, from: `Jane <${contact.email}>`, subject: "Re: quote", "stripped-text": "Sounds good", "body-plain": "Sounds good\n> old", "Message-Id": "<m1@mail.test>", "attachment-count": "2" }),
    );
    expect(out.status).toBe(200);
    const row = await adminDb.communication.findUniqueOrThrow({ where: { id: out.body.communicationId as string } });
    expect(row).toMatchObject({ organizationId: org.id, contactId: contact.id, direction: "INBOUND", subject: "Re: quote", externalReference: "<m1@mail.test>" });
    expect(row.summary).toContain("Sounds good");
    expect(row.summary).toContain("2 attachments");
    expect(row.summary).not.toContain("old");
  });

  it("rejects a missing, wrong, stale or unconfigured signature with 401 and the error envelope", async () => {
    const { address, contact } = await setup();
    const base = { recipient: address, from: contact.email!, subject: "x" };
    const missing = await call({ ...base });
    expect(missing.status).toBe(401);
    expect(missing.body).toHaveProperty("requestId");
    expect((await call(signed(base, { key: "some-other-key" }))).status).toBe(401);
    expect((await call(signed(base, { signature: "0".repeat(64) }))).status).toBe(401);
    expect((await call(signed(base, { timestamp: Math.floor(Date.now() / 1000) - 16 * 60 }))).status).toBe(401);
    expect((await call(signed(base, { timestamp: Math.floor(Date.now() / 1000) + 16 * 60 }))).status).toBe(401);
    vi.stubEnv("MAILGUN_INBOUND_SIGNING_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call(signed(base))).status).toBe(401);
  });

  it("rejects a replayed token, even with a different body", async () => {
    const { address, contact } = await setup();
    const token = randomUUID().replace(/-/g, "");
    const first = await call(signed({ recipient: address, from: contact.email!, subject: "one", "Message-Id": "<r1@mail.test>" }, { token }));
    expect(first.status).toBe(200);
    const second = await call(signed({ recipient: address, from: contact.email!, subject: "tampered", "Message-Id": "<r2@mail.test>" }, { token }));
    expect(second.status).toBe(401);
  });

  it("rejects an unknown recipient, a wrong token and a foreign domain", async () => {
    const { org, address } = await setup();
    const from = "someone@example.test";
    const local = address.split("@")[0];
    const wrongToken = `${org.slug}+${"0".repeat(24)}@${DOMAIN}`;
    for (const recipient of [`nobody+abc@${DOMAIN}`, wrongToken, `${local}@other.example.test`, "garbage"]) {
      const out = await call(signed({ recipient, from }));
      expect(out.status).toBe(404);
    }
  });

  it("keeps organisations apart: an address only ever delivers to its own organisation", async () => {
    const a = await setup();
    const b = await setup();
    expect(a.address).not.toBe(b.address);
    // Org A's slug with org B's token is refused.
    const crossed = `${a.org.slug}+${b.address.split("+")[1]}`;
    expect((await call(signed({ recipient: crossed, from: a.contact.email! }))).status).toBe(404);
    const out = await call(signed({ recipient: b.address, from: a.contact.email!, "Message-Id": "<x1@mail.test>" }));
    expect(out.status).toBe(200);
    const row = await adminDb.communication.findUniqueOrThrow({ where: { id: out.body.communicationId as string } });
    expect(row.organizationId).toBe(b.org.id);
    expect(row.contactId).toBeNull(); // org A's contact is not visible to org B
    expect(row.needsLinking).toBe(true);
    expect(await adminDb.communication.count({ where: { organizationId: a.org.id } })).toBe(0);
  });

  it("stores a duplicate Message-Id once", async () => {
    const { org, address, contact } = await setup();
    const fields = { recipient: address, from: contact.email!, "Message-Id": "<dup@mail.test>" };
    const first = await call(signed(fields));
    const second = await call(signed(fields));
    expect(first.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true, communicationId: first.body.communicationId });
    expect(await adminDb.communication.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("never logs the signing key or the message body", async () => {
    const { address, contact } = await setup();
    const spies = (["log", "error", "warn", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await call(signed({ recipient: address, from: contact.email!, "body-plain": "TOP-SECRET-BODY" }, { key: "wrong" }));
    vi.stubEnv("MAILGUN_INBOUND_SIGNING_KEY", "");
    await call(signed({ recipient: address, from: contact.email!, "body-plain": "TOP-SECRET-BODY" }));
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("TOP-SECRET-BODY");
  });

  it("shows the BCC address to Management in the integration status", async () => {
    const { ctx, address } = await setup();
    expect(await getInboundEmailIntegrationStatus(ctx)).toMatchObject({ bccAddress: address });
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "");
    expect(await getInboundEmailIntegrationStatus(ctx)).toMatchObject({ bccAddress: null });
  });

  it("maps Mailgun fields, falling back to sender and body-plain", () => {
    const form = new FormData();
    form.set("sender", "a@b.test");
    form.set("body-plain", "hi");
    form.set("message-id", "<z@b.test>");
    expect(mapMailgunPayload(form)).toEqual({ from: "a@b.test", subject: undefined, text: "hi", messageId: "<z@b.test>" });
  });
});
