/**
 * The V1.1 organisation for the V1.1 quality gate (G2.01, FIG-1156): the same seeded organisation the V1 walks use (tests/helpers/world.ts),
 * moved to release V1.1 with the assistant switched on, and one real record of every V1.1 kind a route can be asked about: a catalogue item,
 * a quote with a version and a share link, a discount approval, a chat channel with a message, a follow-up sequence and an enrolment, a web
 * form, a saved view, a mail draft, a card capture, a connection, an assistant request with a proposal, and a pipeline with its stages.
 *
 * Every record belongs to the Sales member (or Management where noted), like the V1 world, so "own records" rules are exercised.
 * Anything that cannot be built is listed in `missing`, so a gap shows up instead of silently weakening a walk.
 * No secret or real person is involved: tokens are random and hashed, addresses are on the reserved example.test domain.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { adminDb } from "../../src/db/adminClient";
import { TOGGLES_KEY } from "../../src/lib/featureConfig";
import { createFileRecord } from "../../src/repositories/files";
import { resolveActiveMembership } from "../../src/repositories/memberships";
import { createCatalogueEntry } from "../../src/services/catalogueService";
import { createChannel, postMessage } from "../../src/services/chatService";
import { createSequence, enrol } from "../../src/services/followUpService";
import { createDraft } from "../../src/services/mailService";
import { requestDiscountApproval } from "../../src/services/approvalService";
import { createQuote } from "../../src/services/quoteService";
import { createView } from "../../src/services/savedViewService";
import { createForm } from "../../src/services/webFormService";
import { setOrganizationRelease } from "../../src/services/featureService";
import { buildStorageKey } from "../../src/storage/keys";
import { buildWorld, ROLE_KEYS, type World } from "./world";

export interface WorldV11 extends World {
  /** What V1.1 records exist, by name, for the report. */
  v11Records: string[];
}

export async function buildWorldV11(prefix = "WalkV11"): Promise<WorldV11> {
  // The V1.1 permissions (catalogue, chat, sequences, quotes) are stripped while the deployment's release is below V1.1 (src/lib/featureFlags.ts), and CI has
  // no .env to set it. A developer's own ACTIVE_RELEASE wins; the reviewed matrix (src/api/contract/accessMatrixV11.json) is the one for v2. Q2.01 (FIG-1179):
  // without this, G2.01's four files failed in CI (PR #34, shards 3 and 6) with "catalogue item" missing.
  process.env.ACTIVE_RELEASE ||= "v2";
  const world = (await buildWorld(prefix)) as WorldV11;
  const org = world.organization.id;
  const { ids, overrides, missing } = world;
  world.v11Records = [];

  await setOrganizationRelease(org, "v1.1");
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: org, key: TOGGLES_KEY } },
    update: { value: { "assistant.enabled": true } },
    create: { organizationId: org, key: TOGGLES_KEY, value: { "assistant.enabled": true } },
  });

  // A person's permissions depend on the organisation's release, and a context carries them as they were when it was made: make every context again now
  // the organisation is at V1.1, or the V1.1 permissions (catalogue, quotes, chat, mail, assistant) are missing under a V1 deployment default, as in CI.
  for (const key of ROLE_KEYS) {
    const fresh = await resolveActiveMembership(world.ctx[key].userId, org);
    if (!fresh) throw new Error(`No active membership for ${key} after the release change`);
    world.ctx[key] = fresh;
  }
  const { MANAGEMENT: mgmt, SALES: sales } = world.ctx;

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      const value = await fn();
      world.v11Records.push(name);
      return value;
    } catch (e) {
      const message = (e as Error).message.replace(/\s+/g, " ");
      missing.push(`${name}: ${message.slice(300, 800)} ${JSON.stringify((e as any).issues ?? "").slice(0, 300)}`);
      return null;
    }
  }

  // Catalogue and quotes (B6.10 to B6.13).
  const item = await step("catalogue item", () => createCatalogueEntry(mgmt, { name: `Camera ${randomUUID().slice(0, 4)}`, price: 18500, cost: 11000, unit: "camera" }));
  if (item) ids.itemId = (item as any).id ?? (item as any).item?.id;

  let quoteVersionId: string | null = null;
  if (ids.dealId && ids.itemId) {
    const created = await step("quote", () => createQuote(sales, ids.dealId!, { lines: [{ catalogueItemId: ids.itemId!, quantity: 2 }], discountPercent: 25 }));
    const quote = (created as any)?.quote;
    if (quote) {
      ids.quoteId = quote.id;
      ids.version = "1";
      const version = await adminDb.quoteVersion.findFirst({ where: { organizationId: org, quoteId: quote.id } });
      quoteVersionId = version?.id ?? null;
      const approval = await step("discount approval", () => requestDiscountApproval(sales, quote.id, 1, {}));
      const approvalId = (approval as any)?.id ?? (approval as any)?.approval?.id ?? (approval as any)?.request?.id;
      if (approvalId) overrides["/approvals/{approvalId}:approvalId"] = approvalId;
      else {
        const row = await adminDb.approvalRequest.findFirst({ where: { organizationId: org } });
        if (row) overrides["/approvals/{approvalId}:approvalId"] = row.id;
      }
    }
  }
  if (quoteVersionId && ids.quoteId) {
    const share = await step("quote share", () =>
      adminDb.quoteShare.create({
        data: {
          organizationId: org,
          quoteVersionId: quoteVersionId!,
          tokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
          recipientEmail: "buyer@example.test",
          expiresAt: new Date(Date.now() + 7 * 86400000),
          documentHtml: "<p>Quote walk</p>",
          documentSha256: createHash("sha256").update("Quote walk").digest("hex"),
          createdByMembershipId: sales.membershipId,
        },
      }),
    );
    if (share) ids.shareId = share.id;
  }

  // Chat (B6.24 to B6.26): a channel and a message in it.
  const channel = await step("chat channel", () => createChannel(mgmt, { kind: "PUBLIC", name: `walk-${randomUUID().slice(0, 4)}` }));
  const channelId = (channel as any)?.id ?? (channel as any)?.channel?.id;
  if (channelId) {
    ids.channelId = channelId;
    const message = await step("chat message", () => postMessage(mgmt, channelId, { body: "Walk message" }));
    const messageId = (message as any)?.id ?? (message as any)?.message?.id;
    if (messageId) ids.messageId = messageId;
  }

  // Follow-up sequence and an enrolment on the Sales lead (B6.18).
  const sequence = await step("sequence", () => createSequence(mgmt, { name: `Walk seq ${randomUUID().slice(0, 4)}`, subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "TASK", title: "Call back" }] }));
  const sequenceId = (sequence as any)?.id ?? (sequence as any)?.sequence?.id;
  if (sequenceId) {
    ids.sequenceId = sequenceId;
    await adminDb.followUpSequence.updateMany({ where: { id: sequenceId, organizationId: org }, data: { isActive: true } });
    if (ids.leadId) {
      const enrolment = await step("sequence enrolment", () => enrol(sales, sequenceId, { leadId: ids.leadId! }));
      const enrollmentId = (enrolment as any)?.id ?? (enrolment as any)?.enrollment?.id ?? (enrolment as any)?.enrolment?.id;
      if (enrollmentId) ids.enrollmentId = enrollmentId;
    }
  }

  const form = await step("web form", () => createForm(mgmt, { name: `Walk form ${randomUUID().slice(0, 4)}` }));
  const formId = (form as any)?.id ?? (form as any)?.form?.id;
  if (formId) ids.formId = formId;

  const view = await step("saved view", () => createView(sales, { entity: "leads", name: `Walk view ${randomUUID().slice(0, 4)}` }));
  const viewId = (view as any)?.id ?? (view as any)?.view?.id;
  if (viewId) ids.viewId = viewId;

  const draft = await step("mail draft", () => createDraft(sales, { to: ["buyer@example.test"], subject: "Walk draft", body: "Hello" }));
  const draftId = (draft as any)?.id ?? (draft as any)?.draft?.id;
  if (draftId) ids.draftId = draftId;

  // Camera capture (B6.22): needs a file of its own, the capture holds a unique file id.
  const cardFile = await step("card file", async () => {
    const id = randomUUID();
    return createFileRecord({ id, organizationId: org, ownerMembershipId: sales.membershipId, purpose: "ATTACHMENT", name: "card.jpg", sizeBytes: 12, mimeType: "image/jpeg", storageKey: buildStorageKey(org, "attachment", id), status: "READY" } as any);
  });
  if (cardFile) {
    const capture = await step("card capture", () => adminDb.cardCapture.create({ data: { organizationId: org, membershipId: sales.membershipId, fileId: cardFile.id, status: "EXTRACTED" } }));
    if (capture) ids.captureId = capture.id;
  }

  // A connected mailbox with no tokens at all (B6.21).
  const connection = await step("connection", () =>
    adminDb.oAuthConnection.create({ data: { organizationId: org, membershipId: sales.membershipId, kind: "EMAIL", provider: "GOOGLE", status: "CONNECTED", accountEmail: "sales@example.test", scopes: [] } }),
  );
  if (connection) ids.connectionId = connection.id;

  // Assistant: one question and one proposal waiting for a confirmation (B6.20).
  const request = await step("assistant request", () =>
    adminDb.assistantRequest.create({ data: { organizationId: org, membershipId: sales.membershipId, question: "What is next for this lead?", answer: "Call back.", status: "ANSWERED" } }),
  );
  if (request) {
    overrides["/assistant/requests/{requestId}:requestId"] = request.id;
    const proposal = await step("assistant proposal", () =>
      adminDb.assistantProposal.create({ data: { organizationId: org, membershipId: sales.membershipId, requestId: request.id, kind: "CREATE_TASK", payload: { title: "Call back" }, expiresAt: new Date(Date.now() + 86400000) } }),
    );
    if (proposal) overrides["/assistant/proposals/{proposalId}:proposalId"] = proposal.id;
  }

  // Pipelines (B6.15): the default pipeline and one of its stages.
  const pipeline = await adminDb.pipeline.findFirst({ where: { organizationId: org } });
  if (pipeline) {
    ids.pipelineId = pipeline.id;
    // An open stage, the first by sequence: with no ordering the walk could be handed Closed Lost, which refuses every rule (a flaky matrix cell).
    const stage = await adminDb.pipelineStage.findFirst({ where: { organizationId: org, isWon: false, isLost: false, isActive: true }, orderBy: { sequence: "asc" } });
    if (stage) ids.stageId = stage.id;
    world.v11Records.push("pipeline and stage");
  } else missing.push("pipeline: the organisation has none");

  // The V1.1 records are tenant data like any other: the attack suite must see them as markers.
  world.markers.push(
    ...[ids.itemId, ids.quoteId, ids.shareId, ids.channelId, ids.messageId, ids.sequenceId, ids.enrollmentId, ids.formId, ids.viewId, ids.draftId, ids.captureId, ids.connectionId, ...Object.values(overrides)].filter(
      (v): v is string => typeof v === "string" && v.length > 5,
    ),
  );
  return world;
}
