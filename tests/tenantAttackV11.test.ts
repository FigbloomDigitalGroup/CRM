/**
 * G2.01 (FIG-1156): organisation A can never read or write organisation B's data, for everything V1.1 added.
 *
 * tests/tenantAttack.test.ts (G1.03) does this for the V1 world. B's world there holds no quote, approval, chat channel, sequence, form,
 * saved view, mail draft, camera capture, connection or assistant record, and a V1 organisation answers every V1.1 route "not in your
 * release", so a V1.1 route that ignored the organisation would never have been caught. Here both organisations are at release V1.1
 * with one real record of every V1.1 kind (tests/helpers/worldV11.ts):
 *
 *   1. Every V1.1 tenant table has row-level security with a read and a write policy on the caller's organisation, and A sees none of
 *      B's rows in any of them; the tables that matter hold B's rows, so the check is not vacuous.
 *   2. The attacker walk: every organisation route, as each of A's five roles, with B's real ids in the URL and in the body. Nothing of
 *      B's in a response, nothing of B's changed, no server error. Quotes, approvals, sequences, chat, mail drafts, captures,
 *      connections and the assistant are all in it.
 *   3. Realtime and files: chat sync, typing and presence, and chat attachment links never reach B's channel, B's message or B's file.
 *   4. Inside one organisation: chat cards and the chat record channel show no payment and no masked deal value to a role that may not see it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { hasPermission } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...actual,
    resolveRequestContext: async () => {
      if (!current.ctx) {
        const { UnauthorizedError } = await import("../src/auth/errors");
        throw new UnauthorizedError();
      }
      return current.ctx;
    },
  };
});
vi.mock("../src/app/api/_lib/validation", async () => (await import("./helpers/validationCapture")).capturingValidation());

import { discoverRoutes, fillParams, isOrganisationRoute } from "./helpers/routeHarness";
import { bodyHints, walkRoute } from "./helpers/routeWalker";
import { idFor, ROLE_KEYS, SENTINEL_PATTERNS } from "./helpers/world";
import { buildWorldV11, type WorldV11 } from "./helpers/worldV11";
import { getChannel, joinChannel, listMessages, postMessage, createChannel, getMessageAttachmentLink } from "../src/services/chatService";
import { setTyping, syncChat, heartbeat } from "../src/services/chatRealtimeService";

/** The tables V1.1 added with an organisation id (migrations 20261106090000 to 20261120100000 that are tenant-owned). */
const V11_TABLES = [
  "approval_requests",
  "assistant_proposals",
  "assistant_requests",
  "calendar_event_links",
  "card_captures",
  "catalogue_items",
  "chat_channel_members",
  "chat_channels",
  "chat_message_attachments",
  "chat_message_mentions",
  "chat_messages",
  "chat_presence",
  "chat_reactions",
  "chat_read_markers",
  "follow_up_enrollments",
  "follow_up_runs",
  "follow_up_sequences",
  "follow_up_steps",
  "mail_drafts",
  "oauth_connections",
  "oauth_states",
  "pipeline_services",
  "pipelines",
  "quote_events",
  "quote_lines",
  "quote_shares",
  "quote_versions",
  "quotes",
  "sales_targets",
  "saved_view_pins",
  "saved_views",
  "stage_rules",
  "web_form_submissions",
  "web_forms",
];

/** These must hold at least one of B's rows after the world is built, or the "A sees none" check proves nothing for them. */
const MUST_BE_POPULATED = [
  "approval_requests",
  "assistant_proposals",
  "assistant_requests",
  "card_captures",
  "catalogue_items",
  "chat_channel_members",
  "chat_channels",
  "chat_messages",
  "follow_up_enrollments",
  "follow_up_sequences",
  "follow_up_steps",
  "mail_drafts",
  "oauth_connections",
  "pipelines",
  "quote_lines",
  "quote_shares",
  "quote_versions",
  "quotes",
  "saved_views",
  "web_forms",
];

async function tenantTables(): Promise<string[]> {
  const rows = await adminDb.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' ORDER BY 1`;
  return rows.map((r) => r.table_name);
}

/** A fingerprint of everything one organisation owns: a row count and a hash of the rows, per table. */
async function fingerprint(organizationId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of await tenantTables()) {
    const rows = await adminDb.$queryRawUnsafe<{ n: number; h: string }[]>(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${table}" t WHERE organization_id = $1`,
      organizationId,
    );
    out[table] = `${rows[0]!.n}:${rows[0]!.h}`;
  }
  return out;
}

describe("G2.01 tenant isolation, V1.1", () => {
  let A: WorldV11;
  let B: WorldV11;

  beforeAll(async () => {
    A = await buildWorldV11("AttackV11A");
    B = await buildWorldV11("AttackV11B");
    expect(A.missing).toEqual([]);
    expect(B.missing).toEqual([]);
  }, 300_000);

  describe("row-level security on every V1.1 table", () => {
    it("lists every V1.1 table that exists, so a table added later has to be added here", async () => {
      const real = new Set(await tenantTables());
      expect(V11_TABLES.filter((t) => !real.has(t))).toEqual([]);
    });

    it("has RLS enabled and a read-and-write policy on the caller's organisation on each of them", async () => {
      const problems: string[] = [];
      for (const table of V11_TABLES) {
        const [flags] = await adminDb.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`public."${table}"`}::regclass`;
        if (!flags?.relrowsecurity) problems.push(`${table}: row-level security is off`);
        const policies = await adminDb.$queryRaw<{ cmd: string; qual: string | null; with_check: string | null }[]>`SELECT cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}`;
        const guard = (text: string | null) => (text ?? "").includes("app.current_organization_id");
        if (!policies.some((p) => (p.cmd === "ALL" || p.cmd === "SELECT") && guard(p.qual))) problems.push(`${table}: no policy checks reads against the organisation`);
        if (!policies.some((p) => (p.cmd === "ALL" && guard(p.with_check ?? p.qual)) || (p.cmd === "INSERT" && guard(p.with_check)))) problems.push(`${table}: no policy checks writes against the organisation`);
      }
      expect(problems).toEqual([]);
    });

    it("shows A none of B's rows in any V1.1 table, and B has rows in the tables that matter", async () => {
      const leaks: string[] = [];
      const empty: string[] = [];
      for (const table of V11_TABLES) {
        const [{ n }] = await adminDb.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE organization_id = $1`, B.organization.id);
        if (n === 0 && MUST_BE_POPULATED.includes(table)) empty.push(table);
        const seen = await withOrgContext(A.organization.id, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE organization_id = $1`, B.organization.id));
        if (seen[0]!.n !== 0) leaks.push(`${table}: A sees ${seen[0]!.n} of B's rows`);
      }
      expect(empty, "B's world must hold a row here, or the check is vacuous").toEqual([]);
      expect(leaks).toEqual([]);
    });

    it("refuses a write into B from A's context on the V1.1 tables a bare insert can reach", async () => {
      const refused = /row-level security/i;
      await expect(withOrgContext(A.organization.id, (tx) => tx.catalogueItem.create({ data: { organizationId: B.organization.id, name: "Planted by A", price: 1 } as any }))).rejects.toThrow(refused);
      await expect(withOrgContext(A.organization.id, (tx) => tx.chatChannel.create({ data: { organizationId: B.organization.id, kind: "PUBLIC", name: "planted", createdByMembershipId: B.ctx.SALES.membershipId } as any }))).rejects.toThrow(refused);
      await expect(withOrgContext(A.organization.id, (tx) => tx.savedView.create({ data: { organizationId: B.organization.id, entity: "leads", name: "planted", ownerMembershipId: B.ctx.SALES.membershipId } as any }))).rejects.toThrow(refused);
      await expect(withOrgContext(A.organization.id, (tx) => tx.assistantRequest.create({ data: { organizationId: B.organization.id, membershipId: B.ctx.SALES.membershipId, question: "planted", status: "ANSWERED" } }))).rejects.toThrow(refused);
    });
  });

  describe("the attacker walk: every route, A's five roles, B's ids", () => {
    it("returns nothing of B's, changes nothing of B's, and never fails with a server error", async () => {
      const before = await fingerprint(B.organization.id);
      const hints = await bodyHints(B);
      const routes = discoverRoutes().filter(isOrganisationRoute);
      const leaks: string[] = [];
      const errors: string[] = [];
      const answered: Record<string, number> = {};
      let calls = 0;

      for (const route of routes) {
        for (const method of route.methods) {
          for (const role of ROLE_KEYS) {
            current.ctx = A.ctx[role];
            // A's slug in the URL, B's ids everywhere else: the strongest thing a client holding A's session can send.
            const values = fillParams(route, A.organization.slug, (name) => idFor(B, route.path, name));
            const res = await walkRoute(route, method, values, hints);
            calls++;
            answered[String(res.status)] = (answered[String(res.status)] ?? 0) + 1;
            if (res.status >= 500) errors.push(`${role} ${method} ${route.path} -> ${res.status} ${res.code ?? ""}`);
            // A refusal that repeats the id the caller itself put in the URL tells them nothing they did not send; anything else of B's is a leak.
            const sent = [...Object.values(values), ...Object.values(B.ids), ...Object.values(B.overrides)].filter((v): v is string => typeof v === "string" && v.length > 8);
            const text = res.status >= 400 ? sent.reduce((t, v) => t.split(v).join(""), res.text) : res.text;
            const hit = B.markers.find((m) => text.includes(m));
            if (hit) leaks.push(`${role} ${method} ${route.path} -> ${res.status} contains B's "${hit.slice(0, 12)}..."`);
          }
        }
      }
      const after = await fingerprint(B.organization.id);
      const changed = Object.keys(before).filter((t) => before[t] !== after[t]);

      expect(calls).toBeGreaterThan(2000);
      expect(leaks).toEqual([]);
      expect(changed).toEqual([]);
      expect(errors).toEqual([]);
      // The walk is only an attack if the records it names exist: most answers are "not found" or a refusal.
      expect((answered["404"] ?? 0) + (answered["403"] ?? 0)).toBeGreaterThan(calls / 4);
    }, 2_400_000);
  });

  describe("realtime and files", () => {
    it("never lets A read, type in or sync B's chat channel", async () => {
      const channelId = B.ids.channelId!;
      const sync = await syncChat(A.ctx.MANAGEMENT, { known: { [channelId]: 0 } });
      expect(JSON.stringify(sync)).not.toContain(channelId);
      expect(sync.channels.map((c: { channelId: string }) => c.channelId)).not.toContain(channelId);
      expect(sync.messages.length).toBe(0);
      await expect(setTyping(A.ctx.MANAGEMENT, channelId)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(getChannel(A.ctx.MANAGEMENT, channelId)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(listMessages(A.ctx.MANAGEMENT, channelId)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(joinChannel(A.ctx.MANAGEMENT, channelId)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(postMessage(A.ctx.MANAGEMENT, channelId, { body: "planted by A" })).rejects.toMatchObject({ name: "NotFoundError" });
      expect(await adminDb.chatMessage.count({ where: { channelId, body: "planted by A" } })).toBe(0);
    });

    it("keeps presence inside the organisation: A's heartbeat is not in B's online list", async () => {
      await heartbeat(A.ctx.MANAGEMENT);
      const bSync = await syncChat(B.ctx.MANAGEMENT);
      expect(JSON.stringify(bSync.online)).not.toContain(A.ctx.MANAGEMENT.membershipId);
      const aSync = await syncChat(A.ctx.MANAGEMENT);
      expect(JSON.stringify(aSync.online)).not.toContain(B.ctx.MANAGEMENT.membershipId);
    });

    it("does not give A a link to B's chat attachment, with B's file in A's own channel or B's channel", async () => {
      // A's own channel and message, B's file id: the link must not be made.
      const own = await createChannel(A.ctx.MANAGEMENT, { kind: "PUBLIC", name: `own-${Date.now().toString(36)}` });
      const ownChannelId = (own as any).id ?? (own as any).channel?.id;
      const message = await postMessage(A.ctx.MANAGEMENT, ownChannelId, { body: "hello" });
      const messageId = (message as any).id ?? (message as any).message?.id;
      await expect(getMessageAttachmentLink(A.ctx.MANAGEMENT, ownChannelId, messageId, B.ids.fileId!)).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(getMessageAttachmentLink(A.ctx.MANAGEMENT, B.ids.channelId!, B.ids.messageId!, B.ids.fileId!)).rejects.toMatchObject({ name: "NotFoundError" });
    });

    it("refuses an attachment of B's on a message in A's channel", async () => {
      const own = await createChannel(A.ctx.MANAGEMENT, { kind: "PUBLIC", name: `files-${Date.now().toString(36)}` });
      const ownChannelId = (own as any).id ?? (own as any).channel?.id;
      await expect(postMessage(A.ctx.MANAGEMENT, ownChannelId, { body: "with a file", fileIds: [B.ids.fileId!] })).rejects.toThrow();
      expect(await adminDb.chatMessageAttachment.count({ where: { organizationId: A.organization.id, fileId: B.ids.fileId! } })).toBe(0);
    });

    it("refuses a chat card for B's deal, company or invoice in A's channel", async () => {
      const own = await createChannel(A.ctx.MANAGEMENT, { kind: "PUBLIC", name: `cards-${Date.now().toString(36)}` });
      const ownChannelId = (own as any).id ?? (own as any).channel?.id;
      for (const card of [
        { type: "DEAL" as const, id: B.ids.dealId! },
        { type: "COMPANY" as const, id: B.ids.companyId! },
        { type: "INVOICE" as const, id: B.ids.invoiceId! },
      ]) {
        await expect(postMessage(A.ctx.MANAGEMENT, ownChannelId, { body: "look", card })).rejects.toMatchObject({ name: "NotFoundError" });
      }
    });
  });

  describe("inside one organisation: chat cards and masked figures", () => {
    it("shows a deal card, an invoice card and a deal's record channel without the payment or the deal value to a role that may not see them", async () => {
      const channel = await createChannel(B.ctx.MANAGEMENT, { kind: "PUBLIC", name: `cards-${Date.now().toString(36)}` });
      const channelId = (channel as any).id ?? (channel as any).channel?.id;
      await postMessage(B.ctx.MANAGEMENT, channelId, { body: "The deal", card: { type: "DEAL", id: B.ids.dealId! } });
      await postMessage(B.ctx.MANAGEMENT, channelId, { body: "Invoice attached, KES 8,123,456 outstanding, deal worth KES 7,654,321", card: { type: "INVOICE", id: B.ids.invoiceId! } });
      const record = await createChannel(B.ctx.MANAGEMENT, { kind: "RECORD", record: { type: "DEAL", id: B.ids.dealId! } } as any).catch(() => null);
      const recordId = (record as any)?.id ?? (record as any)?.channel?.id;
      if (recordId) await postMessage(B.ctx.MANAGEMENT, recordId, { body: "Deal value KES 7,654,321" });

      const leaks: string[] = [];
      for (const role of ROLE_KEYS) {
        const ctx = B.ctx[role];
        if (role !== "MANAGEMENT") for (const id of [channelId, recordId].filter(Boolean) as string[]) await joinChannel(ctx, id).catch(() => null);
        const seen: string[] = [];
        for (const id of [channelId, recordId].filter(Boolean) as string[]) {
          seen.push(JSON.stringify(await listMessages(ctx, id).catch(() => null)));
        }
        seen.push(JSON.stringify(await syncChat(ctx, { known: { [channelId]: 0, ...(recordId ? { [recordId]: 0 } : {}) } }).catch(() => null)));
        const text = seen.join("\n");
        const canSeeDealValue = hasPermission(ctx, "deals.view.value") || ctx.membershipId === B.ctx.SALES.membershipId;
        const canSeePayments = hasPermission(ctx, "finance.view.payments");
        if (!canSeePayments && (SENTINEL_PATTERNS.invoiceAmount.test(text) || SENTINEL_PATTERNS.invoiceNumber.test(text))) leaks.push(`${role} sees a payment in chat`);
        if (!canSeeDealValue && SENTINEL_PATTERNS.dealValue.test(text)) leaks.push(`${role} sees a masked deal value in chat`);
      }
      expect(leaks).toEqual([]);
    });
  });
});
