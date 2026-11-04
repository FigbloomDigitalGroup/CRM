import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { createMailProvider } from "../src/integrations/mail/providers";
import { setMailProviderFactory, type MailProviderClient, type OutgoingMail, type ProviderMail } from "../src/integrations/mail/types";
import { setOAuthProviderFactory } from "../src/integrations/oauth/providers";
import type { OAuthProviderClient } from "../src/integrations/oauth/types";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { withIdempotency } from "../src/lib/idempotency";
import { createCommunication as repoCreateCommunication } from "../src/repositories/communications";
import { setStorageDriverForTests } from "../src/storage";
import { LocalDriver } from "../src/storage/localDriver";
import { addAttachment, completeAttachment } from "../src/services/attachmentService";
import { createContact } from "../src/services/contactService";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import {
  createDraft,
  getMailRecordCard,
  isExcluded,
  listDrafts,
  runScheduledSend,
  scheduleDraft,
  sendDraft,
  sendMail,
  syncMailbox,
  requestConnectionSync as requestConnectionSyncAs,
  unscheduleDraft,
  updateDraft,
} from "../src/services/mailService";
import { ConnectionUnavailableError, completeConnection, disconnectConnection, listConnections, startConnection, updateConnectionSettings } from "../src/services/oauthConnectionService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";
import { createWonDeal } from "./helpers/stage3";

// Fake values only.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
let dir: string;
let driver: LocalDriver;

class FakeMail implements MailProviderClient {
  inbox: ProviderMail[] = [];
  sent: OutgoingMail[] = [];
  listCalls = 0;
  failSend = false;
  async listMessages(_token: string, options: { since: Date; limit: number }) {
    this.listCalls += 1;
    return this.inbox.filter((m) => m.receivedAt >= options.since).slice(0, options.limit);
  }
  async sendMessage(_token: string, mail: OutgoingMail) {
    if (this.failSend) throw new Error("provider down");
    this.sent.push(mail);
    return { externalId: `ext-${this.sent.length}`, internetMessageId: `<sent-${this.sent.length}@fake.test>` };
  }
}

const oauthFake: OAuthProviderClient = {
  key: "GOOGLE",
  buildAuthorizationUrl: (r) => `https://fake.test/auth?state=${r.state}`,
  exchangeCode: async () => ({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresInSeconds: 3600, accountEmail: "me@mine.test" }),
  refresh: async () => ({ accessToken: "fake-access-2", refreshToken: null, expiresInSeconds: 3600 }),
  revoke: async () => undefined,
};

let mail: FakeMail;
const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
// These are V1.1 features: the test organisations run on release V1.1 (the V1 refusal is tested in releaseGateV11.test.ts).
const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});
beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  dir = await mkdtemp(join(tmpdir(), "figbloom-mail-"));
  process.env.STORAGE_SIGNING_SECRET = "mail-test-secret";
  driver = new LocalDriver({ rootDir: dir, signingSecret: "mail-test-secret", baseUrl: "http://localhost:3000" });
  setStorageDriverForTests(driver);
});
afterAll(async () => {
  setMailProviderFactory(null);
  setOAuthProviderFactory(null);
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});
beforeEach(() => {
  mail = new FakeMail();
  setMailProviderFactory(() => mail);
  setOAuthProviderFactory(() => oauthFake);
});

async function connectMail(ctx: AuthContext, shared = false) {
  const started = await startConnection(ctx, { kind: "EMAIL", provider: "GOOGLE", shared });
  return completeConnection(ctx, { state: new URL(started.authorizationUrl).searchParams.get("state")!, code: "c" });
}

async function setup() {
  const org = await createTestOrganization("Mail");
  const management = await createTestContext(org.id, "MANAGEMENT", "mail.mgmt");
  const sales = await createTestContext(org.id, "SALES", "mail.sales");
  const { contact } = await createContact(sales, { firstName: "Jane", lastName: "Known", email: "jane@client.test" });
  return { org, management, sales, contact };
}

const incoming = (over: Partial<ProviderMail> & { id: string }): ProviderMail => ({
  internetMessageId: `<${over.id}@fake.test>`,
  from: { email: "jane@client.test", name: "Jane" },
  to: ["me@mine.test"],
  cc: [],
  subject: "Quote",
  bodyText: "Hello, about the quote.",
  receivedAt: new Date(),
  sent: false,
  ...over,
});

const timeline = (orgId: string, contactId: string) => adminDb.communication.findMany({ where: { organizationId: orgId, contactId }, orderBy: { occurredAt: "asc" } });

describe("sync (FIG-807)", () => {
  it("logs mail to and from known contacts on their timelines, matched by address, and ignores everything else", async () => {
    const { org, sales, contact } = await setup();
    const conn = await connectMail(sales);
    mail.inbox = [
      incoming({ id: "m1" }),
      incoming({ id: "m2", from: { email: "stranger@nowhere.test" }, subject: "Hi" }),
      incoming({ id: "m3", sent: true, from: { email: "me@mine.test" }, to: ["jane@client.test"], subject: "Re: Quote", bodyText: "Sure." }),
    ];
    const result = await syncMailbox(org.id, conn.id!);
    expect(result).toMatchObject({ fetched: 3, logged: 2, ignored: 1 });
    const rows = await timeline(org.id, contact.id);
    expect(rows.map((r) => [r.direction, r.subject, r.authorMembershipId])).toEqual(
      expect.arrayContaining([
        ["INBOUND", "Quote", sales.membershipId],
        ["OUTBOUND", "Re: Quote", sales.membershipId],
      ]),
    );
    expect(await adminDb.communication.count({ where: { organizationId: org.id, counterpartyEmail: "stranger@nowhere.test" } })).toBe(0);
    const status = (await listConnections(sales)).items.find((i) => i.kind === "EMAIL")!;
    expect(status.lastSyncedAt).not.toBeNull();
  });

  it("never stores a message twice: not on the next sync, not when the BCC copy or a colleague's sync already has it", async () => {
    const { org, sales, management, contact } = await setup();
    const conn = await connectMail(sales);
    mail.inbox = [incoming({ id: "d1" }), incoming({ id: "d2", internetMessageId: "<bcc-copy@fake.test>" })];
    await repoCreateCommunication({ organizationId: org.id, channel: "EMAIL", direction: "INBOUND", summary: "from BCC", externalReference: "<bcc-copy@fake.test>", contactId: contact.id });
    await syncMailbox(org.id, conn.id!);
    await syncMailbox(org.id, conn.id!);
    expect((await timeline(org.id, contact.id)).filter((r) => r.channel === "EMAIL")).toHaveLength(2);
    // A colleague who is also on the thread syncs the same message: still once.
    const colleague = await createTestContext(org.id, "SALES", "mail.colleague");
    const second = await connectMail(colleague);
    await syncMailbox(org.id, second.id!);
    expect((await timeline(org.id, contact.id)).filter((r) => r.channel === "EMAIL")).toHaveLength(2);
    void management;
  });

  it("keeps private mail out: an excluded address or domain is never read into the CRM", async () => {
    const { org, sales, contact } = await setup();
    const conn = await connectMail(sales);
    await updateConnectionSettings(sales, conn.id!, { excludedAddresses: ["jane@client.test"] });
    mail.inbox = [incoming({ id: "x1" })];
    expect(await syncMailbox(org.id, conn.id!)).toMatchObject({ logged: 0, excluded: 1 });
    await updateConnectionSettings(sales, conn.id!, { excludedAddresses: ["client.test"] });
    mail.inbox = [incoming({ id: "x2", receivedAt: new Date(Date.now() + 1000) })];
    expect(await syncMailbox(org.id, conn.id!)).toMatchObject({ logged: 0, excluded: 1 });
    expect(await timeline(org.id, contact.id)).toHaveLength(0);
    expect(isExcluded("a@b.test", ["@b.test"])).toBe(true);
    expect(isExcluded("a@b.test", ["c.test"])).toBe(false);
  });

  it("sends unmatched mail of the shared organisation mailbox to Needs linking, never a personal mailbox's", async () => {
    const { org, management } = await setup();
    const shared = await connectMail(management, true);
    mail.inbox = [incoming({ id: "s1", from: { email: "new.lead@prospect.test", name: "New Lead" }, subject: "Enquiry" })];
    expect(await syncMailbox(org.id, shared.id!)).toMatchObject({ logged: 1, needsLinking: 1 });
    const waiting = await adminDb.communication.findFirstOrThrow({ where: { organizationId: org.id, needsLinking: true } });
    expect(waiting).toMatchObject({ counterpartyEmail: "new.lead@prospect.test", counterpartyName: "New Lead", authorMembershipId: null });
  });

  it("stops at once when the connection is revoked, and says why when the provider fails", async () => {
    const { org, sales } = await setup();
    const conn = await connectMail(sales);
    mail.inbox = [incoming({ id: "r1" })];
    await disconnectConnection(sales, conn.id!);
    const calls = mail.listCalls;
    await expect(syncMailbox(org.id, conn.id!)).rejects.toBeInstanceOf(ConnectionUnavailableError);
    expect(mail.listCalls).toBe(calls);

    const again = await connectMail(sales);
    mail.listMessages = async () => {
      throw new Error("boom");
    };
    await expect(syncMailbox(org.id, again.id!)).rejects.toThrow("boom");
    const status = (await listConnections(sales)).items.find((i) => i.kind === "EMAIL")!;
    expect(status.state).toBe("CONNECTED");
    expect(status.lastError?.message).toMatch(/tried again/);
  });

  it("runs on the job framework for the organisation's own connections only", async () => {
    const { org, sales, contact } = await setup();
    const conn = await connectMail(sales);
    mail.inbox = [incoming({ id: "j1" })];
    const otherOrg = await createTestOrganization("MailOther");
    const otherSales = await createTestContext(otherOrg.id, "SALES", "mail.other");
    const otherConn = await connectMail(otherSales);
    const result = await enqueueAndRunNow({ organizationId: org.id, type: "mail.sync" });
    expect(result.outcome).toBe("succeeded");
    expect(result.job?.result).toMatchObject({ connections: 1, logged: 1, failed: 0 });
    expect(await timeline(org.id, contact.id)).toHaveLength(1);
    const untouched = await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: otherConn.id! } });
    expect(untouched.lastSyncedAt).toBeNull();
    void conn;
  });
});

describe("send and reply (FIG-807)", () => {
  it("sends through the connected mailbox and logs it once on the record timeline", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const result = await sendMail(sales, { to: ["jane@client.test"], subject: "Proposal", body: "Please find it attached.", contactId: contact.id });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: ["jane@client.test"], subject: "Proposal" });
    const logged = await timeline(org.id, contact.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ channel: "EMAIL", direction: "OUTBOUND", subject: "Proposal", authorMembershipId: sales.membershipId, externalReference: "<sent-1@fake.test>" });
    expect(result.draft.status).toBe("SENT");
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "communication.logged", entityId: logged[0]!.id } })).toBe(1);
    // The next sync does not log it again.
    const conn = (await listConnections(sales)).items.find((i) => i.kind === "EMAIL")!;
    mail.inbox = [incoming({ id: "own", internetMessageId: "<sent-1@fake.test>", sent: true, from: { email: "me@mine.test" }, to: ["jane@client.test"], subject: "Proposal" })];
    await syncMailbox(org.id, conn.id!);
    expect(await timeline(org.id, contact.id)).toHaveLength(1);
  });

  it("does not log the CRM's own sent copy when the provider gives no id back (Outlook)", async () => {
    const { org, sales, contact } = await setup();
    const conn = await connectMail(sales);
    await sendMail(sales, { to: ["jane@client.test"], subject: "Outlook style", body: "Hi", contactId: contact.id });
    mail.inbox = [incoming({ id: "graph-copy", internetMessageId: "<different@outlook.test>", sent: true, from: { email: "me@mine.test" }, to: ["jane@client.test"], subject: "Outlook style" })];
    expect(await syncMailbox(org.id, conn.id!)).toMatchObject({ logged: 0, duplicates: 1 });
  });

  it("sends a draft once even when two requests race for it", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Race", body: "x", contactId: contact.id });
    const results = await Promise.allSettled([sendDraft(sales, draft.id), sendDraft(sales, draft.id)]);
    expect(mail.sent).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await timeline(org.id, contact.id)).toHaveLength(1);
    // Asking again for a sent draft changes nothing.
    expect(await sendDraft(sales, draft.id)).toMatchObject({ alreadySent: true });
    expect(mail.sent).toHaveLength(1);
  });

  it("sends once for a repeated Idempotency-Key", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const body = { to: ["jane@client.test"], subject: "Once", body: "x", contactId: contact.id };
    const request = () => new Request("http://localhost/api/orgs/x/communications/mail/send", { method: "POST", headers: { "idempotency-key": "send-key-0001" } });
    const first = await withIdempotency(sales, request(), body, () => sendMail(sales, body));
    const second = await withIdempotency(sales, request(), body, () => sendMail(sales, body));
    expect(mail.sent).toHaveLength(1);
    const replayed = second instanceof Response ? await second.json() : second;
    expect(replayed).toEqual(JSON.parse(JSON.stringify(first)));
    expect(await timeline(org.id, contact.id)).toHaveLength(1);
  });

  it("shows the disconnected state and sends and logs nothing when no mailbox is connected", async () => {
    const { org, sales, contact } = await setup();
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Nope", body: "x", contactId: contact.id });
    await expect(sendDraft(sales, draft.id)).rejects.toMatchObject({ state: "DISCONNECTED" });
    expect(mail.sent).toHaveLength(0);
    expect(await timeline(org.id, contact.id)).toHaveLength(0);
    // The message is back as a draft to send once a mailbox is connected.
    expect((await listDrafts(sales, "DRAFT")).items.map((d) => d.id)).toContain(draft.id);
    await connectMail(sales);
    expect((await sendDraft(sales, draft.id)).draft.status).toBe("SENT");
  });

  it("logs nothing for a send the provider refused, and lets the person retry", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    mail.failSend = true;
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Fails", body: "x", contactId: contact.id });
    await expect(sendDraft(sales, draft.id)).rejects.toThrow();
    expect(await timeline(org.id, contact.id)).toHaveLength(0);
    expect((await listDrafts(sales)).items.find((d) => d.id === draft.id)).toMatchObject({ status: "FAILED" });
    mail.failSend = false;
    expect((await sendDraft(sales, draft.id)).draft.status).toBe("SENT");
    expect(await timeline(org.id, contact.id)).toHaveLength(1);
  });

  it("checks the recipients, the role, and access to the record", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    await expect(sendMail(sales, { to: [], subject: "x", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMail(sales, { to: ["not-an-email"], subject: "x", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMail(sales, { to: ["a@b.test"], subject: " ", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ValidationError);
    const finance = await createTestContext(org.id, "FINANCE", "mail.fin");
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "mail.tech");
    await expect(createDraft(finance, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createDraft(technical, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect(mail.sent).toHaveLength(0);
    // Another Sales rep cannot send from a colleague's lead.
    const colleague = await createTestContext(org.id, "SALES", "mail.colleague");
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: org.id } })).id, ownerMembershipId: sales.membershipId, contactId: contact.id } });
    await connectMail(colleague);
    await expect(sendMail(colleague, { to: ["a@b.test"], subject: "x", body: "x", leadId: lead.id })).rejects.toThrow();
    expect(mail.sent).toHaveLength(0);
  });

  it("keeps drafts private and organisations apart", async () => {
    const { org, sales, contact } = await setup();
    const colleague = await createTestContext(org.id, "SALES", "mail.colleague");
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Mine", body: "x", contactId: contact.id });
    await expect(sendDraft(colleague, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateDraft(colleague, draft.id, { subject: "stolen" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listDrafts(colleague)).items).toHaveLength(0);
    const other = await createTestOrganization("MailCross");
    const stranger = await createTestContext(other.id, "SALES", "mail.stranger");
    await expect(sendDraft(stranger, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    // A record of another organisation is not reachable by id either.
    await expect(createDraft(stranger, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id })).rejects.toThrow();
    // Nor is a connection: the stranger has none, and the owner's id is not theirs to use.
    await connectMail(sales);
    const status = (await listConnections(stranger)).items.find((i) => i.kind === "EMAIL")!;
    expect(status.state).toBe("DISCONNECTED");
  });

  it("replies from the logged message, only where the person may open its record", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const inbound = await repoCreateCommunication({ organizationId: org.id, channel: "EMAIL", direction: "INBOUND", summary: "Question", subject: "Question", externalReference: "<q1@fake.test>", contactId: contact.id });
    await sendMail(sales, { to: ["jane@client.test"], subject: "Re: Question", body: "Answer", contactId: contact.id, replyToCommunicationId: inbound.id });
    expect(mail.sent[0]!.inReplyTo).toMatchObject({ internetMessageId: "<q1@fake.test>" });
    await expect(sendMail(sales, { to: ["jane@client.test"], subject: "Re", body: "x", contactId: contact.id, replyToCommunicationId: "no-such-message" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("scheduled send (FIG-807)", () => {
  it("sends at its time on the job framework, once, as its owner", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Later", body: "x", contactId: contact.id });
    const scheduled = await scheduleDraft(sales, draft.id, new Date(Date.now() + 3_600_000));
    expect(scheduled.status).toBe("SCHEDULED");
    const queued = await adminDb.backgroundJob.findMany({ where: { organizationId: org.id, type: "mail.send_scheduled" } });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.runAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
    expect(mail.sent).toHaveLength(0);
    // Its time comes: the job runs (twice, as a crashed worker's job would) and sends once.
    const first = await runScheduledSend(org.id, draft.id);
    const second = await runScheduledSend(org.id, draft.id);
    expect(first).toEqual({ sent: true });
    expect(second.sent).toBe(false);
    expect(mail.sent).toHaveLength(1);
    expect(await timeline(org.id, contact.id)).toHaveLength(1);
    const via = await enqueueAndRunNow({ organizationId: org.id, type: "mail.send_scheduled", payload: { draftId: draft.id } });
    expect(via.outcome).toBe("succeeded");
    expect(mail.sent).toHaveLength(1);
  });

  it("can be taken back, in which case the queued job does nothing; and refuses past times", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Cancelled", body: "x", contactId: contact.id });
    await expect(scheduleDraft(sales, draft.id, new Date(Date.now() - 1000))).rejects.toBeInstanceOf(ValidationError);
    await scheduleDraft(sales, draft.id, new Date(Date.now() + 3_600_000));
    expect((await unscheduleDraft(sales, draft.id)).status).toBe("DRAFT");
    expect(await runScheduledSend(org.id, draft.id)).toMatchObject({ sent: false });
    expect(mail.sent).toHaveLength(0);
  });

  it("does not send for a sender who has left, and uses the sender's permissions at that time", async () => {
    const { org, sales, contact } = await setup();
    await connectMail(sales);
    const draft = await createDraft(sales, { to: ["jane@client.test"], subject: "Leaver", body: "x", contactId: contact.id });
    await scheduleDraft(sales, draft.id, new Date(Date.now() + 3_600_000));
    await adminDb.membership.update({ where: { id: sales.membershipId }, data: { status: "INACTIVE" } });
    expect(await runScheduledSend(org.id, draft.id)).toMatchObject({ sent: false, reason: "SENDER_INACTIVE" });
    expect(mail.sent).toHaveLength(0);
  });
});

describe("attachments in mail (FIG-807)", () => {
  async function attached(ctx: AuthContext, parent: "company" | "deal", id: string, shared?: boolean) {
    const { attachment } = await addAttachment(ctx, parent, id, { name: "brief.png", mimeType: "image/png", sizeBytes: PNG.length, ...(shared !== undefined ? { shared } : {}) });
    await driver.putObject(attachment.file.storageKey, PNG, { contentType: "image/png" });
    return completeAttachment(ctx, attachment.id);
  }

  it("sends a CRM attachment the person may open, and refuses another organisation's or one hidden from their role", async () => {
    const { org, management, sales, contact } = await setup();
    await connectMail(sales);
    const { company } = await companyService.createCompany(management, { name: "Files Co" });
    const file = await attached(management, "company", company.id);
    await sendMail(sales, { to: ["jane@client.test"], subject: "With file", body: "x", contactId: contact.id, attachmentIds: [file.id] });
    expect(mail.sent[0]!.attachments).toHaveLength(1);
    expect(mail.sent[0]!.attachments[0]).toMatchObject({ name: "brief.png", mimeType: "image/png" });
    expect(mail.sent[0]!.attachments[0]!.content.equals(PNG)).toBe(true);

    // Another organisation's attachment id is simply not found.
    const other = await createTestOrganization("MailFiles");
    const otherMgmt = await createTestContext(other.id, "MANAGEMENT", "mail.of");
    const { company: otherCo } = await companyService.createCompany(otherMgmt, { name: "Other Co" });
    const foreign = await attached(otherMgmt, "company", otherCo.id);
    await expect(createDraft(sales, { to: ["jane@client.test"], subject: "x", body: "x", contactId: contact.id, attachmentIds: [foreign.id] })).rejects.toBeInstanceOf(NotFoundError);

    // A deal file that is not shared is hidden from someone who may not see the deal's value.
    const stage = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(management, { companyId: company.id, pipelineStageId: stage, value: 900000 });
    const priced = await attached(management, "deal", deal.id, false);
    const delivery = await createTestContext(org.id, "DELIVERY", "mail.delivery");
    await expect(createDraft(delivery, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id, attachmentIds: [priced.id] })).rejects.toBeInstanceOf(NotFoundError);
    expect(mail.sent).toHaveLength(1);
  });
});

describe("record card masking (FIG-807)", () => {
  it("masks deal value for the viewer, not the sender", async () => {
    const { org, management, sales } = await setup();
    const won = await createWonDeal(org.id, sales, { value: 1234567 });
    const asManagement = await getMailRecordCard(management, { dealId: won.id });
    expect(asManagement).toMatchObject({ kind: "deal", value: 1234567, valueMasked: false });
    const delivery = await createTestContext(org.id, "DELIVERY", "mail.card.delivery");
    const asDelivery = await getMailRecordCard(delivery, { dealId: won.id });
    expect(asDelivery).toMatchObject({ value: null, valueMasked: true, marginMasked: true, paymentsMasked: true });
    expect(JSON.stringify(asDelivery)).not.toContain("1234567");
    // The owner quoted it themselves, so they see it; a colleague who cannot open the deal gets the usual refusal.
    expect(await getMailRecordCard(sales, { dealId: won.id })).toMatchObject({ value: 1234567 });
    const colleague = await createTestContext(org.id, "SALES", "mail.card.colleague");
    await expect(getMailRecordCard(colleague, { dealId: won.id })).rejects.toThrow();
  });
});

describe("real Gmail and Graph clients (fake provider server)", () => {
  function server(handler: (url: string, init: RequestInit) => unknown) {
    const seen: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(handler(url, init)), { status: 200 });
    }) as unknown as typeof fetch;
    return { impl, seen };
  }

  it("reads Gmail messages into the common shape, and sends a MIME message with the Sent copy in the mailbox", async () => {
    const text = Buffer.from("Hello from Jane").toString("base64url");
    const s = server((url) => {
      if (url.includes("/messages?")) return { messages: [{ id: "g1" }] };
      if (url.includes("/messages/g1")) {
        return { id: "g1", labelIds: ["INBOX"], internalDate: String(Date.now()), payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "Jane <Jane@Client.test>" }, { name: "To", value: "me@mine.test" }, { name: "Subject", value: "Hi" }, { name: "Message-ID", value: "<g1@gmail.test>" }], parts: [{ mimeType: "text/plain", body: { data: text } }] } };
      }
      return { id: "sent-1" };
    });
    const client = createMailProvider("GOOGLE", s.impl);
    const got = await client.listMessages("tok", { since: new Date(Date.now() - 1000), limit: 10 });
    expect(got[0]).toMatchObject({ id: "g1", internetMessageId: "<g1@gmail.test>", from: { email: "jane@client.test", name: "Jane" }, to: ["me@mine.test"], subject: "Hi", bodyText: "Hello from Jane", sent: false });
    expect((s.seen[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const sent = await client.sendMessage("tok", { to: ["a@b.test"], cc: [], subject: "Subj", body: "Body", attachments: [{ name: "a.png", mimeType: "image/png", content: PNG }] });
    expect(sent.externalId).toBe("sent-1");
    const raw = Buffer.from(JSON.parse(String(s.seen.at(-1)!.init.body)).raw, "base64url").toString("utf8");
    expect(raw).toContain("To: a@b.test");
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain(sent.internetMessageId!);
  });

  it("sends through Graph's sendMail with the sent copy saved, and reads inbox and sent folders", async () => {
    const s = server((url) => (url.includes("/mailFolders/") ? { value: [{ id: "o1", subject: "Hi", internetMessageId: "<o1@o.test>", from: { emailAddress: { address: "Jane@Client.test" } }, toRecipients: [{ emailAddress: { address: "me@mine.test" } }], body: { content: "x" }, receivedDateTime: new Date().toISOString() }] } : {}));
    const client = createMailProvider("MICROSOFT", s.impl);
    const got = await client.listMessages("tok", { since: new Date(Date.now() - 1000), limit: 10 });
    expect(got.map((m) => m.sent).sort()).toEqual([false, true]);
    await client.sendMessage("tok", { to: ["a@b.test"], cc: [], subject: "S", body: "B", attachments: [] });
    const call = s.seen.at(-1)!;
    expect(call.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(JSON.parse(String(call.init.body))).toMatchObject({ saveToSentItems: true, message: { subject: "S" } });
  });
});

describe("review fixes: snippets, mail.use, settings ownership and MIME safety", () => {
  it("stores a snippet of at most 200 characters from a synced message, not the whole body", async () => {
    const { org, sales, contact } = await setup();
    const conn = await connectMail(sales);
    mail.inbox = [incoming({ id: "long1", bodyText: "A".repeat(4000) })];
    await syncMailbox(org.id, conn.id!);
    const rows = await timeline(org.id, contact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary!.length).toBeLessThanOrEqual(200);
  });

  it("needs mail.use as well as communications.create to draft, send, list or schedule", async () => {
    const { sales, contact } = await setup();
    await connectMail(sales);
    const without: AuthContext = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => k !== "mail.use") };
    await expect(createDraft(without, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendMail(without, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listDrafts(without)).rejects.toBeInstanceOf(ForbiddenError);
    const draft = await createDraft(sales, { to: ["a@b.test"], subject: "x", body: "x", contactId: contact.id });
    await expect(sendDraft(without, draft.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(scheduleDraft(without, draft.id, new Date(Date.now() + 3_600_000))).rejects.toBeInstanceOf(ForbiddenError);
    expect(mail.sent).toHaveLength(0);
  });

  it("lets only the owner change a personal connection's settings; Management may still disconnect it", async () => {
    const { org, management, sales } = await setup();
    const conn = await connectMail(sales);
    await expect(updateConnectionSettings(management, conn.id!, { excluded: ["x@y.test"] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestConnectionSyncAs(management, conn.id!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateConnectionSettings(sales, conn.id!, { excluded: ["x@y.test"] })).resolves.toBeDefined();
    await disconnectConnection(management, conn.id!);
    expect((await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: conn.id! } })).revokedAt).not.toBeNull();
    void org;
  });

  it("builds attachment headers without line breaks, with an RFC 2231 name and a safe media type", async () => {
    const seen: string[] = [];
    const impl = (async (_url: string, init: RequestInit = {}) => {
      seen.push(String(init.body ?? ""));
      return new Response(JSON.stringify({ id: "s1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createMailProvider("GOOGLE", impl);
    await client.sendMessage("tok", {
      to: ["a@b.test\r\nBcc: evil@x.test"],
      cc: [],
      subject: "S",
      body: "B",
      attachments: [{ name: 'in"voice\r\nBcc: evil@x.test\u00e9.png', mimeType: "image/png\r\nX-Evil: 1", content: PNG }],
    });
    const raw = Buffer.from(JSON.parse(seen[0]!).raw, "base64url").toString("utf8");
    const headerBlock = raw.split("\r\n\r\n")[0]!;
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw).not.toMatch(/^X-Evil:/im);
    expect(headerBlock).toContain("To: a@b.test Bcc: evil@x.test");
    expect(raw).toContain("application/octet-stream");
    expect(raw).toContain("filename*=UTF-8''");
    expect(raw).toContain("%C3%A9");
  });
});
