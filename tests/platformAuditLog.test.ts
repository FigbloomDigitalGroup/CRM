import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { appDb } from "../src/db/orgScopedClient";
import { getPlatformDb } from "../src/db/platformClient";
import * as auditService from "../src/services/platformAuditService";
import { exportAuditCsv, lastVerification, listAuditEvents, recordPlatformAudit, verifyAuditChain } from "../src/services/platformAuditService";
import { ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins } from "./helpers/platform";
import { discoverRoutes } from "./helpers/routeHarness";

/**
 * FIG-1138 (B6.06): the platform audit log is append-only and tamper-evident.
 *
 * Tamper tests change the table as the schema owner (the one role that can switch the triggers off), look at what the
 * verification says, and put everything back, so concurrent test files only ever see a consistent log.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));

const platform = () => getPlatformDb();

async function add(action: string, extra: Partial<Parameters<typeof recordPlatformAudit>[1]> = {}) {
  await recordPlatformAudit(platform(), { actorIdentityId: null, actorLabel: "audit-test", action, targetType: "Test", ...extra });
}

async function latest(action: string) {
  return (await listAuditEvents({ action, limit: 1 })).items[0]!;
}

interface RawRow {
  seq: bigint;
  id: string;
  occurred_at: Date;
  actor_identity_id: string | null;
  actor_label: string;
  action: string;
  target_type: string;
  target_id: string | null;
  organization_id: string | null;
  organization_slug: string | null;
  reason: string | null;
  metadata: unknown;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}

/** Runs `change` with one trigger of the table switched off, then switches it back on. */
async function withTriggerOff<T>(trigger: string, change: () => Promise<T>): Promise<T> {
  await adminDb.$executeRawUnsafe(`ALTER TABLE platform_audit_events DISABLE TRIGGER ${trigger}`);
  try {
    return await change();
  } finally {
    await adminDb.$executeRawUnsafe(`ALTER TABLE platform_audit_events ENABLE TRIGGER ${trigger}`);
  }
}

afterEach(() => {
  holder.jar = { get: () => undefined };
});
afterAll(async () => {
  await removeTestPlatformAdmins();
  await platform().$disconnect();
});

describe("appending", () => {
  it("chains every entry to the one before it, with no gap in seq", async () => {
    const tag = `chain.${randomUUID().slice(0, 8)}`;
    await add(`${tag}.one`);
    await add(`${tag}.two`);
    await add(`${tag}.three`);
    const rows = (await listAuditEvents({ action: tag, limit: 10 })).items.reverse();
    expect(rows.map((r) => r.action)).toEqual([`${tag}.one`, `${tag}.two`, `${tag}.three`]);
    // Another test file may append between our entries, so check each link against the row that really precedes it.
    for (const row of rows) {
      const [before] = await adminDb.$queryRaw<{ hash: string }[]>`SELECT hash FROM platform_audit_events WHERE seq = ${row.seq - 1}::bigint`;
      expect(row.prevHash).toBe(before ? before.hash : "GENESIS");
      expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const seqs = await adminDb.$queryRaw<{ seq: bigint }[]>`SELECT seq FROM platform_audit_events ORDER BY seq`;
    seqs.forEach((s, i) => expect(Number(s.seq)).toBe(Number(seqs[0]!.seq) + i));
  });

  it("stays in one unbroken chain when many entries arrive at once", async () => {
    const tag = `burst.${randomUUID().slice(0, 8)}`;
    await Promise.all(Array.from({ length: 12 }, (_, i) => add(`${tag}.${i}`)));
    const result = await verifyAuditChain("MANUAL");
    expect(result).toMatchObject({ ok: true, firstBadSeq: null, problem: null });
    expect((await listAuditEvents({ action: tag, limit: 50 })).items).toHaveLength(12);
  });

  it("keeps who, what, which organisation, why, and refuses values, payments or secrets in the metadata", async () => {
    const org = randomUUID();
    await add("fields.checked", { actorIdentityId: "identity-1", actorLabel: "someone@platform.example.com", targetId: "t-1", organizationId: org, organizationSlug: "acme", reason: "Because", metadata: { from: "ACTIVE", to: "SUSPENDED", count: 3, flag: true }, requestId: "req-12345678" });
    expect(await latest("fields.checked")).toMatchObject({ actorIdentityId: "identity-1", actorLabel: "someone@platform.example.com", targetType: "Test", targetId: "t-1", organizationId: org, organizationSlug: "acme", reason: "Because", metadata: { from: "ACTIVE", to: "SUSPENDED", count: 3, flag: true }, requestId: "req-12345678" });

    await expect(add("bad.metadata", { metadata: { dealValue: 5000 } })).rejects.toThrow(/not allowed/);
    await expect(add("bad.metadata", { metadata: { paymentRef: "x" } })).rejects.toThrow(/not allowed/);
    await expect(add("bad.metadata", { metadata: { nested: {} as never } })).rejects.toThrow(/plain value/);
    await expect(add("bad.metadata", { metadata: { note: "x".repeat(3000) } })).rejects.toThrow(/too large/);
    expect((await listAuditEvents({ action: "bad.metadata" })).items).toHaveLength(0);
  });

  it("commits with the change it records, or not at all", async () => {
    const tag = `atomic.${randomUUID().slice(0, 8)}`;
    await expect(
      adminDb.$transaction(async (tx) => {
        await recordPlatformAudit(tx, { actorIdentityId: null, actorLabel: "t", action: tag, targetType: "Test" });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow(/the change failed/);
    expect((await listAuditEvents({ action: tag })).items).toHaveLength(0);
    expect((await verifyAuditChain("MANUAL")).ok).toBe(true);
  });
});

describe("no update or delete path exists", () => {
  it("the platform role may only read and add; the database refuses the rest", async () => {
    await add("readonly.check");
    const row = await latest("readonly.check");
    await expect(platform().$executeRawUnsafe(`UPDATE platform_audit_events SET reason = 'x' WHERE seq = ${row.seq}`)).rejects.toThrow(/permission denied/i);
    await expect(platform().$executeRawUnsafe(`DELETE FROM platform_audit_events WHERE seq = ${row.seq}`)).rejects.toThrow(/permission denied/i);
    await expect(platform().$executeRawUnsafe(`TRUNCATE platform_audit_events`)).rejects.toThrow(/permission denied/i);
  });

  it("the tenant application role cannot even read it", async () => {
    await expect(appDb.$queryRawUnsafe(`SELECT 1 FROM platform_audit_events LIMIT 1`)).rejects.toThrow(/permission denied/i);
    await expect(appDb.$executeRawUnsafe(`DELETE FROM platform_audit_events`)).rejects.toThrow(/permission denied/i);
  });

  it("a trigger refuses update, delete and truncate for every role, the schema owner included", async () => {
    await add("trigger.check");
    const row = await latest("trigger.check");
    await expect(adminDb.$executeRawUnsafe(`UPDATE platform_audit_events SET reason = 'x' WHERE seq = ${row.seq}`)).rejects.toThrow(/append-only/);
    await expect(adminDb.$executeRawUnsafe(`DELETE FROM platform_audit_events WHERE seq = ${row.seq}`)).rejects.toThrow(/append-only/);
    await expect(adminDb.$executeRawUnsafe(`TRUNCATE platform_audit_events`)).rejects.toThrow(/append-only/);
    expect(await latest("trigger.check")).toMatchObject({ hash: row.hash });
  });

  it("the other append-only records refuse change too", async () => {
    const run = await verifyAuditChain("MANUAL");
    await expect(adminDb.$executeRawUnsafe(`UPDATE platform_audit_verifications SET ok = NOT ok WHERE id = '${run.runId}'`)).rejects.toThrow(/append-only/);
    await expect(adminDb.$executeRawUnsafe(`DELETE FROM platform_audit_verifications WHERE id = '${run.runId}'`)).rejects.toThrow(/append-only/);
    const event = await adminDb.organizationLifecycleEvent.create({ data: { organizationId: randomUUID(), fromStatus: "ACTIVE", toStatus: "SUSPENDED", action: "suspend", reason: "append-only check" } });
    await expect(adminDb.organizationLifecycleEvent.update({ where: { id: event.id }, data: { reason: "forged" } })).rejects.toThrow(/append-only/);
    await expect(adminDb.organizationLifecycleEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });

  it("the service and the routes expose no way to edit or remove an entry", async () => {
    expect(Object.keys(auditService).filter((name) => /update|delete|remove|edit|purge|truncate/i.test(name))).toEqual([]);
    const routes = discoverRoutes().filter((r) => r.path.startsWith("/api/platform/audit"));
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const route of routes) expect(route.methods.filter((m) => m === "PUT" || m === "PATCH" || m === "DELETE")).toEqual([]);
  });
});

describe("verification", () => {
  it("passes on an untouched log and stores the run", async () => {
    await add("verify.ok");
    const result = await verifyAuditChain("MANUAL");
    expect(result).toMatchObject({ ok: true, firstBadSeq: null });
    expect(result.rowsChecked).toBeGreaterThan(0);
    expect(await lastVerification()).toMatchObject({ id: result.runId, ok: true, trigger: "MANUAL" });
  });

  it("notices an edited entry, and says which one", async () => {
    await add("tamper.edit", { reason: "original reason" });
    const row = await latest("tamper.edit");
    await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`UPDATE platform_audit_events SET reason = 'forged reason' WHERE seq = ${row.seq}`));
    try {
      const result = await verifyAuditChain("MANUAL");
      expect(result.ok).toBe(false);
      expect(result.firstBadSeq).toBe(row.seq);
      expect(result.problem).toMatch(/was changed/);
    } finally {
      await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`UPDATE platform_audit_events SET reason = 'original reason' WHERE seq = ${row.seq}`));
    }
    expect((await verifyAuditChain("MANUAL")).ok).toBe(true);
  });

  it("notices a changed hash that was made to fit, because the next row no longer follows it", async () => {
    await add("tamper.rehash.a");
    await add("tamper.rehash.b");
    const a = await latest("tamper.rehash.a");
    const next = (await adminDb.$queryRaw<RawRow[]>`SELECT * FROM platform_audit_events WHERE seq = ${a.seq + 1}::bigint`)[0]!;
    await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`UPDATE platform_audit_events SET reason = 'forged', hash = repeat('a', 64) WHERE seq = ${a.seq}`));
    try {
      const result = await verifyAuditChain("MANUAL");
      expect(result.ok).toBe(false);
      expect(result.firstBadSeq).toBe(a.seq);
      expect(next.prev_hash).toBe(a.hash);
    } finally {
      await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`UPDATE platform_audit_events SET reason = NULL, hash = '${a.hash}' WHERE seq = ${a.seq}`));
    }
    expect((await verifyAuditChain("MANUAL")).ok).toBe(true);
  });

  it("notices a removed entry in the middle", async () => {
    await add("tamper.delete.a");
    await add("tamper.delete.b");
    await add("tamper.delete.c");
    const b = await latest("tamper.delete.b");
    const [saved] = await adminDb.$queryRaw<RawRow[]>`SELECT * FROM platform_audit_events WHERE seq = ${b.seq}::bigint`;
    await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`DELETE FROM platform_audit_events WHERE seq = ${b.seq}::bigint`));
    try {
      const result = await verifyAuditChain("MANUAL");
      expect(result.ok).toBe(false);
      expect(result.firstBadSeq).toBe(b.seq);
      expect(result.problem).toMatch(/missing|removed|follow/);
    } finally {
      await withTriggerOff("platform_audit_events_chain", () =>
        adminDb.$executeRaw`INSERT INTO platform_audit_events (seq, id, occurred_at, actor_identity_id, actor_label, action, target_type, target_id, organization_id, organization_slug, reason, metadata, request_id, prev_hash, hash)
          VALUES (${saved!.seq}, ${saved!.id}, ${saved!.occurred_at}, ${saved!.actor_identity_id}, ${saved!.actor_label}, ${saved!.action}, ${saved!.target_type}, ${saved!.target_id}, ${saved!.organization_id}, ${saved!.organization_slug}, ${saved!.reason}, ${JSON.stringify(saved!.metadata)}::jsonb, ${saved!.request_id}, ${saved!.prev_hash}, ${saved!.hash})`,
      );
    }
    expect((await verifyAuditChain("MANUAL")).ok).toBe(true);
  });

  it("notices an entry forged into the middle", async () => {
    await add("tamper.insert.a");
    await add("tamper.insert.b");
    const a = await latest("tamper.insert.a");
    const [after] = await adminDb.$queryRaw<RawRow[]>`SELECT * FROM platform_audit_events WHERE seq = ${a.seq + 1}::bigint`;
    // A row with the same seq cannot exist (primary key), so a forger renumbers: here, an extra row far past the head with a made-up link.
    const [head] = await adminDb.$queryRaw<{ seq: bigint }[]>`SELECT max(seq) AS seq FROM platform_audit_events`;
    const forgedSeq = Number(head!.seq) + 5;
    await withTriggerOff("platform_audit_events_chain", () =>
      adminDb.$executeRaw`INSERT INTO platform_audit_events (seq, actor_label, action, target_type, metadata, prev_hash, hash) VALUES (${forgedSeq}, 'forger', 'forged.entry', 'Test', '{}'::jsonb, ${after!.hash}, repeat('b', 64))`,
    );
    try {
      const result = await verifyAuditChain("MANUAL");
      expect(result.ok).toBe(false);
      expect(result.problem).toBeTruthy();
    } finally {
      await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`DELETE FROM platform_audit_events WHERE seq = ${forgedSeq}`));
    }
    expect((await verifyAuditChain("MANUAL")).ok).toBe(true);
  });

  it("notices rows cut off the end, through the head the last run recorded", async () => {
    await add("tamper.tail");
    const before = await verifyAuditChain("MANUAL");
    expect(before.ok).toBe(true);
    const [saved] = await adminDb.$queryRaw<RawRow[]>`SELECT * FROM platform_audit_events WHERE seq = ${before.headSeq}::bigint`;
    await withTriggerOff("platform_audit_events_no_update", () => adminDb.$executeRawUnsafe(`DELETE FROM platform_audit_events WHERE seq = ${before.headSeq}::bigint`));
    try {
      const result = await verifyAuditChain("MANUAL");
      expect(result.ok).toBe(false);
      expect(result.firstBadSeq).toBe(before.headSeq);
    } finally {
      await withTriggerOff("platform_audit_events_chain", () =>
        adminDb.$executeRaw`INSERT INTO platform_audit_events (seq, id, occurred_at, actor_identity_id, actor_label, action, target_type, target_id, organization_id, organization_slug, reason, metadata, request_id, prev_hash, hash)
          VALUES (${saved!.seq}, ${saved!.id}, ${saved!.occurred_at}, ${saved!.actor_identity_id}, ${saved!.actor_label}, ${saved!.action}, ${saved!.target_type}, ${saved!.target_id}, ${saved!.organization_id}, ${saved!.organization_slug}, ${saved!.reason}, ${JSON.stringify(saved!.metadata)}::jsonb, ${saved!.request_id}, ${saved!.prev_hash}, ${saved!.hash})`,
      );
    }
    expect((await verifyAuditChain("MANUAL")).ok).toBe(true);
  });

  it("the scheduled job (cron route) runs the same check, is secret-protected, and stores a SCHEDULED run", async () => {
    const route = await import("../src/app/api/cron/platform-maintenance/route");
    vi.stubEnv("CRON_SECRET", "cron-secret-for-audit-test");
    try {
      expect((await route.GET(jsonRequest("/api/cron/platform-maintenance", "GET"))).status).toBe(401);
      expect((await route.GET(jsonRequest("/api/cron/platform-maintenance", "GET", undefined, { authorization: "Bearer wrong" }))).status).toBe(401);
      const ok = await route.GET(jsonRequest("/api/cron/platform-maintenance", "GET", undefined, { authorization: "Bearer cron-secret-for-audit-test" }));
      expect(ok.status).toBe(200);
      expect((await ok.json()).audit).toMatchObject({ ok: true });
      expect(await lastVerification()).toMatchObject({ trigger: "SCHEDULED", ok: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("query and export", () => {
  it("filters by action, organisation, actor and date, and pages newest first", async () => {
    const tag = `query.${randomUUID().slice(0, 8)}`;
    const orgA = randomUUID();
    const orgB = randomUUID();
    await add(`${tag}.alpha`, { organizationId: orgA, actorIdentityId: `actor-a-${tag}` });
    await add(`${tag}.beta`, { organizationId: orgB, actorIdentityId: `actor-b-${tag}` });
    await add(`${tag}.beta`, { organizationId: orgA, actorIdentityId: `actor-b-${tag}` });

    expect((await listAuditEvents({ action: tag, limit: 10 })).items).toHaveLength(3);
    expect((await listAuditEvents({ action: `${tag}.beta` })).items).toHaveLength(2);
    expect((await listAuditEvents({ organizationId: orgA })).items.map((e) => e.action).sort()).toEqual([`${tag}.alpha`, `${tag}.beta`]);
    expect((await listAuditEvents({ actorIdentityId: `actor-b-${tag}` })).items).toHaveLength(2);
    expect((await listAuditEvents({ organizationId: orgA, from: new Date(Date.now() + 60_000) })).items).toHaveLength(0);
    expect((await listAuditEvents({ organizationId: orgA, to: new Date(Date.now() - 3_600_000) })).items).toHaveLength(0);

    const first = await listAuditEvents({ organizationId: orgA, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0]!.seq);
    const second = await listAuditEvents({ organizationId: orgA, limit: 1, before: first.nextCursor! });
    expect(second.items[0]!.seq).toBeLessThan(first.items[0]!.seq);
    expect(second.nextCursor).toBeNull();
  });

  it("exports the filtered rows as a CSV that cannot run a formula", async () => {
    const tag = `export.${randomUUID().slice(0, 8)}`;
    await add(tag, { reason: '=HYPERLINK("http://evil.example","click")', organizationSlug: "acme" });
    const { csv, rows, truncated } = await exportAuditCsv({ action: tag });
    expect(rows).toBe(1);
    expect(truncated).toBe(false);
    expect(csv.split("\n")[0]).toBe("seq,occurred_at,actor,action,target_type,target_id,organisation,reason,metadata,request_id,hash");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});

describe("the routes", () => {
  it("serve the log, the export and the verification to a platform admin, and record the export in the log", async () => {
    const admin = await makePlatformAdmin("auditor");
    holder.jar = admin.jar;
    const tag = `route.${randomUUID().slice(0, 8)}`;
    await add(tag);

    const list = await import("../src/app/api/platform/audit/route");
    const res = await list.GET(jsonRequest(`/api/platform/audit?action=${tag}`, "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);

    const exp = await import("../src/app/api/platform/audit/export/route");
    const csv = await exp.GET(jsonRequest(`/api/platform/audit/export?action=${tag}`, "GET"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(await csv.text()).toContain(tag);
    expect(await latest("audit.exported")).toMatchObject({ actorIdentityId: admin.id, actorLabel: admin.email, metadata: { rows: 1 } });

    const verify = await import("../src/app/api/platform/audit/verify/route");
    const post = await verify.POST();
    expect(post.status).toBe(200);
    expect(await post.json()).toMatchObject({ ok: true });
    expect((await (await verify.GET()).json()).last).toMatchObject({ ok: true });

    const bad = await list.GET(jsonRequest(`/api/platform/audit?from=not-a-date`, "GET"));
    expect(bad.status).toBe(400);
    void ctxParams;
  });
});
