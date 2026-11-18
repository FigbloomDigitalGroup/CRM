/**
 * Q2.05 (FIG-1386): gaps found in the Communication group audit (docs/Q2_05_COMMUNICATION_QA.md).
 * Chat files inside one organisation (private channels, limited members, removed members), the figures in record
 * channels and search for every role, and the automation guard for mail (rule 9: automations draft, remind and assign;
 * they never send from a person's mailbox and never move a deal). Fake values only.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { NotFoundError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { setMailProviderFactory, type MailProviderClient, type OutgoingMail } from "../src/integrations/mail/types";
import { setOAuthProviderFactory } from "../src/integrations/oauth/providers";
import type { OAuthProviderClient } from "../src/integrations/oauth/types";
import { runDueSequences } from "../src/sequences/engine";
import { createCompany } from "../src/services/companyService";
import { createDeal } from "../src/services/dealService";
import { addMembers, createChannel, getMessageAttachmentLink, listMessages, postMessage, removeMember, searchMessages } from "../src/services/chatService";
import { createTemplate } from "../src/services/emailTemplateService";
import { createSequence, enrol, updateSequence } from "../src/services/followUpService";
import { completeConnection, startConnection } from "../src/services/oauthConnectionService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterAll(() => {
  setMailProviderFactory(null);
  setOAuthProviderFactory(null);
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});

async function world(prefix: string) {
  const org = await createTestOrganization(prefix);
  return {
    org,
    management: await createTestContext(org.id, "MANAGEMENT", `${prefix}.m`),
    sales: await createTestContext(org.id, "SALES", `${prefix}.s`),
    salesB: await createTestContext(org.id, "SALES", `${prefix}.s2`),
    delivery: await createTestContext(org.id, "DELIVERY", `${prefix}.d`),
    finance: await createTestContext(org.id, "FINANCE", `${prefix}.f`),
    technical: await createTestContext(org.id, "RESTRICTED_TECHNICAL", `${prefix}.t`),
  };
}

async function attach(orgId: string, owner: AuthContext, messageId: string) {
  const file = await adminDb.file.create({ data: { organizationId: orgId, ownerMembershipId: owner.membershipId, purpose: "ATTACHMENT", name: "plan.png", sizeBytes: 10, mimeType: "image/png", storageKey: `orgs/${orgId}/chat/${randomUUID()}`, status: "READY" } });
  await adminDb.chatMessageAttachment.create({ data: { organizationId: orgId, messageId, fileId: file.id } });
  return file.id;
}

describe("Q2.05 chat attachments inside one organisation", () => {
  it("gives a download link only to someone who may read the channel, and takes it away when they leave or are removed", { timeout: 120_000 }, async () => {
    const w = await world("Q205Files");
    const secret = await createChannel(w.sales, { kind: "PRIVATE", name: "private-files", memberIds: [w.salesB.membershipId] });
    const message = await postMessage(w.sales, secret.id, { body: "the plan" });
    const fileId = await attach(w.org.id, w.sales, message.id);

    // A member gets a link.
    expect(await getMessageAttachmentLink(w.salesB, secret.id, message.id, fileId)).toBeTruthy();
    // Non-members of a private channel get nothing, whatever their role, Management included.
    for (const ctx of [w.management, w.delivery, w.finance, w.technical]) {
      await expect(getMessageAttachmentLink(ctx, secret.id, message.id, fileId)).rejects.toBeInstanceOf(NotFoundError);
    }
    // A file of the same organisation that is not attached to this message is not reachable through it.
    const other = await postMessage(w.sales, secret.id, { body: "no file here" });
    await expect(getMessageAttachmentLink(w.salesB, secret.id, other.id, fileId)).rejects.toBeInstanceOf(NotFoundError);
    // Once a member is removed the link stops at the next call.
    await removeMember(w.sales, secret.id, w.salesB.membershipId);
    await expect(getMessageAttachmentLink(w.salesB, secret.id, message.id, fileId)).rejects.toBeInstanceOf(NotFoundError);
    // A person added later can open it.
    await addMembers(w.sales, secret.id, [w.delivery.membershipId]);
    expect(await getMessageAttachmentLink(w.delivery, secret.id, message.id, fileId)).toBeTruthy();
  });

  it("keeps a limited member (Restricted Technical) away from the files of a public channel they were not added to", async () => {
    const w = await world("Q205Limited");
    const general = await createChannel(w.management, { kind: "PUBLIC", name: "general-files", memberIds: [w.sales.membershipId] });
    const message = await postMessage(w.management, general.id, { body: "rate card" });
    const fileId = await attach(w.org.id, w.management, message.id);
    expect(await getMessageAttachmentLink(w.delivery, general.id, message.id, fileId)).toBeTruthy();
    await expect(getMessageAttachmentLink(w.technical, general.id, message.id, fileId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never links a deleted message's file", async () => {
    const w = await world("Q205Gone");
    const ch = await createChannel(w.sales, { kind: "PUBLIC", name: "gone-files" });
    const message = await postMessage(w.sales, ch.id, { body: "oops" });
    const fileId = await attach(w.org.id, w.sales, message.id);
    await adminDb.chatMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } });
    await expect(getMessageAttachmentLink(w.sales, ch.id, message.id, fileId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Q2.05 chat figures: a deal's own channel, its card, and search, for every role", () => {
  it("shows no deal value in the channel, the card or message search to a role that may not see it", { timeout: 120_000 }, async () => {
    const w = await world("Q205Money");
    const company = (await createCompany(w.management, { name: "Kisumu Greens Q205", ownerMembershipId: w.sales.membershipId } as never)).company;
    const deal = await createDeal(w.management, { companyId: company.id, pipelineStageId: await getPipelineStageId(w.org.id, "SOLUTION_PRESENTED"), ownerMembershipId: w.sales.membershipId, value: 8123456 } as never);
    const shared = await createChannel(w.management, { kind: "PUBLIC", name: "money-card", memberIds: [w.sales.membershipId, w.delivery.membershipId, w.salesB.membershipId] });
    await postMessage(w.sales, shared.id, { body: "Priced at KES 8,123,456 as discussed", card: { type: "DEAL", id: deal.id } });

    const seen = async (ctx: AuthContext) => JSON.stringify([await listMessages(ctx, shared.id), await searchMessages(ctx, "priced")]);
    // Management and the owner see it; Delivery and a Sales colleague who is not the owner do not, in the list, the card or search.
    expect(await seen(w.management)).toMatch(/8[,.]?123[,.]?456/);
    expect(await seen(w.sales)).toMatch(/8[,.]?123[,.]?456/);
    for (const ctx of [w.delivery, w.salesB]) {
      const text = await seen(ctx);
      expect(text).not.toMatch(/8[,.]?123[,.]?456/);
      expect(text).toContain("[value hidden]");
    }
  });
});

describe("Q2.05 automation guard for mail (rule 9)", () => {
  class SpyMail implements MailProviderClient {
    sent: OutgoingMail[] = [];
    listCalls = 0;
    async listMessages() {
      this.listCalls += 1;
      return [];
    }
    async sendMessage(_t: string, m: OutgoingMail) {
      this.sent.push(m);
      return { externalId: "x", internetMessageId: "<x@fake.test>" };
    }
  }
  const oauthFake: OAuthProviderClient = {
    key: "GOOGLE",
    buildAuthorizationUrl: (r) => `https://fake.test/auth?state=${r.state}`,
    exchangeCode: async () => ({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresInSeconds: 3600, accountEmail: "me@mine.test" }),
    refresh: async () => ({ accessToken: "fake-access-2", refreshToken: null, expiresInSeconds: 3600 }),
    revoke: async () => undefined,
  };
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

  it("the rule code cannot reach a mailbox, a mail provider or a send path", () => {
    const dir = join(__dirname, "..", "src", "automations");
    const forbidden = /mailService|integrations\/mail|communicationService|sendAndLogEmail|sendDraft|sendMail|sendMessage|deliverOrLog|resend|nodemailer|auth\/email|notifications\/email/i;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      expect(strip(readFileSync(join(dir, file), "utf8")), `${file} must not send mail`).not.toMatch(forbidden);
    }
  });

  it("a sequence of draft steps puts the mail in a task for a person and sends nothing, from a mailbox or otherwise", { timeout: 120_000 }, async () => {
    const w = await world("Q205Draft");
    const spy = new SpyMail();
    setMailProviderFactory(() => spy);
    setOAuthProviderFactory(() => oauthFake);
    const started = await startConnection(w.sales, { kind: "EMAIL", provider: "GOOGLE" });
    await completeConnection(w.sales, { state: new URL(started.authorizationUrl).searchParams.get("state")!, code: "c" });

    const contact = await adminDb.contact.create({ data: { organizationId: w.org.id, firstName: "Amara", lastName: "Osei", email: `amara.${randomUUID().slice(0, 6)}@example.test` } });
    const lead = await adminDb.lead.create({ data: { organizationId: w.org.id, contactId: contact.id, leadStatusId: await getLeadStatusId(w.org.id, "NEW"), ownerMembershipId: w.sales.membershipId } });
    const company = await adminDb.company.create({ data: { organizationId: w.org.id, name: "Draft Only Co" } });
    const stageId = await getPipelineStageId(w.org.id, "NEGOTIATION");
    const deal = await adminDb.deal.create({ data: { organizationId: w.org.id, companyId: company.id, ownerMembershipId: w.sales.membershipId, pipelineStageId: stageId, value: "250000.00" } });
    const template = await createTemplate(w.management, { name: "Draft intro", subject: "Hello {{contact.firstName}}", body: "Hi {{contact.firstName}}." });
    const steps = [
      { dayOffset: 0, kind: "EMAIL", title: "Draft one", emailTemplateId: template.id, emailMode: "DRAFT" },
      { dayOffset: 1, kind: "EMAIL", title: "Draft two", emailTemplateId: template.id, emailMode: "DRAFT" },
    ];
    const t0 = new Date("2026-11-16T09:00:00.000Z");
    const leadSeq = await createSequence(w.management, { name: `Drafts ${randomUUID().slice(0, 4)}`, subjectType: "LEAD", steps });
    await updateSequence(w.management, leadSeq.id, { isActive: true });
    await enrol(w.sales, leadSeq.id, { leadId: lead.id }, t0);
    const dealSeq = await createSequence(w.management, { name: `Deal drafts ${randomUUID().slice(0, 4)}`, subjectType: "DEAL", steps });
    await updateSequence(w.management, dealSeq.id, { isActive: true });
    await enrol(w.sales, dealSeq.id, { dealId: deal.id }, t0);

    const result = await runDueSequences({ organizationId: w.org.id, now: new Date(t0.getTime() + 30 * 86_400_000) });
    expect(result.stepsDone).toBeGreaterThanOrEqual(2);

    // The drafts are tasks for the owner.
    const tasks = await adminDb.task.findMany({ where: { organizationId: w.org.id, assigneeMembershipId: w.sales.membershipId } });
    expect(tasks.filter((t) => (t.description ?? "").includes("Draft prepared for you")).length).toBeGreaterThanOrEqual(4);
    // Nothing went out: not through the connected mailbox, not logged as sent mail, no mail draft was sent.
    expect(spy.sent).toHaveLength(0);
    expect(await adminDb.communication.count({ where: { organizationId: w.org.id, channel: "EMAIL", direction: "OUTBOUND" } })).toBe(0);
    expect(await adminDb.mailDraft.count({ where: { organizationId: w.org.id, status: { in: ["SENT", "SENDING", "SCHEDULED"] } } })).toBe(0);
    // And the deal did not move.
    expect(await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id }, select: { pipelineStageId: true, outcome: true, value: true } })).toMatchObject({ pipelineStageId: stageId, outcome: "OPEN" });
    expect(await adminDb.dealMove.count({ where: { organizationId: w.org.id } })).toBe(0);
  });
});
