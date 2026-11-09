import { Client } from "pg";

/**
 * Removes what the Playwright specs create in the dev (or test) database, so a run leaves the data the way the seed made it.
 * Used by `e2e/support/global-setup.ts` and `global-teardown.ts` and, for a one-off clean-up, by `scripts/e2e-cleanup.ts`.
 * Documented in `docs/E2E_DATA_CLEANUP.md`.
 *
 * How a test record is recognised (never "everything newer than X"):
 *  - by MARKER: a name, title, label, e-mail or message that contains `E2E`, `e2e` or a 13-digit millisecond timestamp (`Date.now()`), which is
 *    how every spec makes its data unique. Specs name what they create with `E2E` in it; see docs/E2E_DATA_CLEANUP.md.
 *  - by dependency: leads, deals, tasks and contacts that belong to a marked company or contact, and everything that hangs off them, is deleted
 *    through the database's own `ON DELETE CASCADE`; audit events, notifications and other rows that point at a record by id (no foreign key)
 *    are deleted by that id.
 *  - LEGACY_NAMES (exact names that older versions of the specs created without a marker) and the technical/config tables below are only touched
 *    when `since` is given, and only rows created at or after it, so a person's own catalogue item or setting is never removed.
 *
 * Safety: refuses to run unless the database is figbloom_crm_dev or figbloom_crm_test and NODE_ENV is not production (hard rule 10).
 */

/** Postgres and JavaScript read this expression the same way (the unit test checks the JavaScript side). */
export const E2E_MARKER = "(E2E|e2e|[0-9]{13})";

/** Exact names created by older versions of the specs, before they carried a marker. Used only together with `since`. */
export const LEGACY_NAMES = {
  contacts: ["CsrfOwnOrigin"],
  catalogueItems: ["Support retainer"],
  savedViews: ["My hot ones"],
  chatMessages: ["Morning everyone"],
} as const;

export const ALLOWED_DATABASES = ["figbloom_crm_dev", "figbloom_crm_test"] as const;

/** Settings the specs write and never put back. Removed when created at or after `since`. */
export const SPEC_SETTING_KEYS = ["session.lifetime_hours", "privacy.retention", "assistant.config"] as const;

const MARKER_RE = new RegExp(E2E_MARKER);

/** The database stores created_at as a UTC `timestamp` without a time zone, so a cutoff is compared as the same UTC wall-clock text (never as a JS Date, which the driver would shift to local time). */
export function utcTimestampLiteral(d: Date): string {
  return d.toISOString().slice(0, 23).replace("T", " ");
}

export function isE2eMarked(text: string | null | undefined): boolean {
  return typeof text === "string" && MARKER_RE.test(text);
}

export function databaseNameOf(connectionString: string): string {
  const path = new URL(connectionString).pathname.replace(/^\//, "");
  return decodeURIComponent(path);
}

/** Throws unless the clean-up may run against this connection. Never prints the connection string. */
export function assertSafeTarget(connectionString: string | undefined, env: { NODE_ENV?: string } = process.env): string {
  if (!connectionString) throw new Error("E2E clean-up: no database URL (set DATABASE_URL).");
  if (env.NODE_ENV === "production") throw new Error("E2E clean-up refuses to run with NODE_ENV=production.");
  let name: string;
  try {
    name = databaseNameOf(connectionString);
  } catch {
    throw new Error("E2E clean-up: the database URL could not be read.");
  }
  if (!(ALLOWED_DATABASES as readonly string[]).includes(name)) {
    throw new Error(`E2E clean-up refuses to run against database "${name}": only ${ALLOWED_DATABASES.join(" or ")} are allowed.`);
  }
  return name;
}

export interface CleanupOptions {
  /** Rows of the legacy/config/technical kinds created at or after this are removed; also the guard that no marked row is older than it. */
  since?: Date;
  /** Blank leads (no company, no contact) the one-off clean-up has verified to be test data. Only the one-off script passes these. */
  extraLeadIds?: string[];
  /** Roll back instead of commit; the report is the same. */
  dryRun?: boolean;
}

export interface CleanupReport {
  database: string;
  dryRun: boolean;
  /** Rows removed per table, including rows removed by cascade (counted before and after, inside the transaction). */
  deleted: Record<string, number>;
  /** Tables whose row count went up (should be none). */
  grew: Record<string, number>;
  total: number;
}

async function tableCounts(client: Client): Promise<Record<string, number>> {
  const tables = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename not like '\\_%' order by 1",
  );
  const counts: Record<string, number> = {};
  for (const { tablename } of tables.rows) {
    const r = await client.query<{ n: string }>(`select count(*)::text as n from "${tablename}"`);
    counts[tablename] = Number(r.rows[0]!.n);
  }
  return counts;
}

const sqlList = (names: readonly string[]) => names.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ") || "''";

/** The ordered statements. Parameters: $1 marker regex, $2 since (timestamptz or null), $3 extra lead ids (uuid[]). */
export function cleanupStatements(withSince: boolean): string[] {
  const legacy = (names: readonly string[], col: string) => (withSince ? ` OR (${col} IN (${sqlList(names)}) AND created_at >= $2)` : "");
  const sinceOnly = withSince ? "created_at >= $2" : "false";
  return [
    // Roots, by marker.
    `CREATE TEMP TABLE e2e_companies ON COMMIT DROP AS SELECT id FROM companies WHERE name ~ $1`,
    `CREATE TEMP TABLE e2e_contacts ON COMMIT DROP AS SELECT id FROM contacts
       WHERE (first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '')) ~ $1${legacy(LEGACY_NAMES.contacts, "first_name")}
          OR company_id IN (SELECT id FROM e2e_companies)`,
    `CREATE TEMP TABLE e2e_leads ON COMMIT DROP AS SELECT id FROM leads
       WHERE company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts) OR id = ANY($3::text[])`,
    `CREATE TEMP TABLE e2e_deals ON COMMIT DROP AS SELECT id FROM deals
       WHERE company_id IN (SELECT id FROM e2e_companies) OR lead_id IN (SELECT id FROM e2e_leads) OR primary_contact_id IN (SELECT id FROM e2e_contacts)`,
    `CREATE TEMP TABLE e2e_tasks ON COMMIT DROP AS SELECT id FROM tasks
       WHERE title ~ $1 OR company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts)
          OR lead_id IN (SELECT id FROM e2e_leads) OR deal_id IN (SELECT id FROM e2e_deals)`,
    `CREATE TEMP TABLE e2e_other ON COMMIT DROP AS
       SELECT id::text AS id, 'catalogue_items' AS t FROM catalogue_items WHERE name ~ $1${legacy(LEGACY_NAMES.catalogueItems, "name")}
       UNION ALL SELECT id::text, 'saved_views' FROM saved_views WHERE name ~ $1${legacy(LEGACY_NAMES.savedViews, "name")}
       UNION ALL SELECT id::text, 'tags' FROM tags WHERE name ~ $1
       UNION ALL SELECT id::text, 'email_templates' FROM email_templates WHERE name ~ $1
       UNION ALL SELECT id::text, 'custom_field_definitions' FROM custom_field_definitions WHERE label ~ $1
       UNION ALL SELECT id::text, 'chat_messages' FROM chat_messages WHERE body ~ $1${legacy(LEGACY_NAMES.chatMessages, "body")}
       UNION ALL SELECT id::text, 'users' FROM users WHERE email ~ '^e2e\\.'`,
    // Every id a row elsewhere may point at without a foreign key (audit events, notifications, ...): the roots and their children.
    `CREATE TEMP TABLE e2e_ids ON COMMIT DROP AS
       SELECT id::text AS id FROM e2e_companies UNION SELECT id::text FROM e2e_contacts UNION SELECT id::text FROM e2e_leads
       UNION SELECT id::text FROM e2e_deals UNION SELECT id::text FROM e2e_tasks UNION SELECT id FROM e2e_other
       UNION SELECT id::text FROM invoices WHERE deal_id IN (SELECT id FROM e2e_deals) OR company_id IN (SELECT id FROM e2e_companies)
       UNION SELECT id::text FROM payment_records WHERE invoice_id IN (SELECT id FROM invoices WHERE deal_id IN (SELECT id FROM e2e_deals) OR company_id IN (SELECT id FROM e2e_companies))
       UNION SELECT id::text FROM quotes WHERE deal_id IN (SELECT id FROM e2e_deals)
       UNION SELECT id::text FROM approval_requests WHERE deal_id IN (SELECT id FROM e2e_deals)
       UNION SELECT id::text FROM deal_handoffs WHERE deal_id IN (SELECT id FROM e2e_deals)
       UNION SELECT id::text FROM comments WHERE company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts)
          OR lead_id IN (SELECT id FROM e2e_leads) OR deal_id IN (SELECT id FROM e2e_deals) OR task_id IN (SELECT id FROM e2e_tasks)
       UNION SELECT id::text FROM activities WHERE company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts)
          OR lead_id IN (SELECT id FROM e2e_leads) OR deal_id IN (SELECT id FROM e2e_deals)
       UNION SELECT id::text FROM communications WHERE company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts)
          OR lead_id IN (SELECT id FROM e2e_leads) OR deal_id IN (SELECT id FROM e2e_deals)
       UNION SELECT id::text FROM activities WHERE subject ~ $1`,
    // Rows that point at a record by id only.
    `DELETE FROM audit_events WHERE entity_id::text IN (SELECT id FROM e2e_ids)`,
    `DELETE FROM notifications WHERE entity_id::text IN (SELECT id FROM e2e_ids)`,
    // What a row says about a test record in its own text: a notification about a handoff that no longer exists, an audit line whose values
    // name a test e-mail or a test reference value, a merge snapshot. Case-sensitive "E2E" and the "e2e." e-mail form only: "e2e" alone also
    // occurs inside ids.
    `DELETE FROM notifications WHERE title ~ $1 OR body ~ $1`,
    `DELETE FROM audit_events WHERE new_value::text ~ 'E2E|e2e\\.' OR previous_value::text ~ 'E2E|e2e\\.' OR metadata::text ~ 'E2E|e2e\\.'`,
    `DELETE FROM merge_records WHERE snapshot::text ~ 'E2E'`,
    `DELETE FROM communications WHERE activity_id IN (SELECT id FROM activities WHERE subject ~ $1)`,
    `DELETE FROM activities WHERE subject ~ $1`,
    `DELETE FROM automation_runs WHERE entity_id::text IN (SELECT id FROM e2e_ids)`,
    `DELETE FROM sync_mutations WHERE entity_id::text IN (SELECT id FROM e2e_ids)`,
    `DELETE FROM chat_channels WHERE record_id::text IN (SELECT id FROM e2e_ids)`,
    // What the database will not cascade (RESTRICT / NO ACTION foreign keys), children first. Everything else goes with its parent.
    `DELETE FROM payment_records WHERE invoice_id IN (
       SELECT id FROM invoices WHERE deal_id IN (SELECT id FROM e2e_deals) OR company_id IN (SELECT id FROM e2e_companies))`,
    `DELETE FROM invoices WHERE deal_id IN (SELECT id FROM e2e_deals) OR company_id IN (SELECT id FROM e2e_companies)`,
    `DELETE FROM deal_handoffs WHERE deal_id IN (SELECT id FROM e2e_deals)`,
    `DELETE FROM proposal_references WHERE deal_id IN (SELECT id FROM e2e_deals)`,
    `DELETE FROM communications WHERE company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts)
       OR lead_id IN (SELECT id FROM e2e_leads) OR deal_id IN (SELECT id FROM e2e_deals)`,
    `DELETE FROM activities WHERE company_id IN (SELECT id FROM e2e_companies) OR contact_id IN (SELECT id FROM e2e_contacts)
       OR lead_id IN (SELECT id FROM e2e_leads) OR deal_id IN (SELECT id FROM e2e_deals)`,
    `DELETE FROM tasks WHERE id IN (SELECT id FROM e2e_tasks)`,
    `DELETE FROM company_services WHERE company_id IN (SELECT id FROM e2e_companies)`,
    `UPDATE companies SET merged_into_id = NULL WHERE merged_into_id IN (SELECT id FROM e2e_companies)`,
    `UPDATE contacts SET merged_into_id = NULL WHERE merged_into_id IN (SELECT id FROM e2e_contacts)`,
    `DELETE FROM follow_up_steps WHERE email_template_id IN (SELECT id::text FROM e2e_other WHERE t = 'email_templates')`,
    `DELETE FROM deals WHERE id IN (SELECT id FROM e2e_deals)`,
    `DELETE FROM leads WHERE id IN (SELECT id FROM e2e_leads)`,
    `DELETE FROM contacts WHERE id IN (SELECT id FROM e2e_contacts)`,
    `DELETE FROM companies WHERE id IN (SELECT id FROM e2e_companies)`,
    `DELETE FROM catalogue_items WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'catalogue_items')`,
    `DELETE FROM saved_views WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'saved_views')`,
    `DELETE FROM tags WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'tags')`,
    `DELETE FROM email_templates WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'email_templates')`,
    `DELETE FROM custom_field_definitions WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'custom_field_definitions')`,
    `DELETE FROM chat_messages WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'chat_messages')`,
    // A test user (invited by a spec) and the few rows that name that user's membership.
    `CREATE TEMP TABLE e2e_memberships ON COMMIT DROP AS SELECT id FROM memberships WHERE user_id IN (SELECT id FROM e2e_other WHERE t = 'users')`,
    `DELETE FROM audit_events WHERE actor_membership_id IN (SELECT id FROM e2e_memberships)`,
    `DELETE FROM notifications WHERE membership_id IN (SELECT id FROM e2e_memberships)`,
    `DELETE FROM notification_preferences WHERE membership_id IN (SELECT id FROM e2e_memberships)`,
    `DELETE FROM memberships WHERE id IN (SELECT id FROM e2e_memberships)`,
    `DELETE FROM users WHERE id::text IN (SELECT id FROM e2e_other WHERE t = 'users')`,
    // Settings, keys, targets and technical rows the specs leave behind; only with `since`, only what was created at or after it.
    ...(withSince
      ? [
          `DELETE FROM organization_settings WHERE key IN (${sqlList(SPEC_SETTING_KEYS)}) AND created_at >= $2`,
          `UPDATE organization_settings SET value = '{"lastMembershipId": null}'::jsonb
             WHERE key = 'website_lead_assignment_cursor' AND created_at < $2 AND updated_at >= $2`,
          `DELETE FROM sales_targets WHERE ${sinceOnly}`,
          `DELETE FROM automation_rules WHERE ${sinceOnly}`,
          `DELETE FROM website_api_keys WHERE ${sinceOnly}`,
          `DELETE FROM files WHERE ${sinceOnly}`,
          `DELETE FROM card_captures WHERE ${sinceOnly}`,
          `DELETE FROM idempotency_keys WHERE ${sinceOnly}`,
          `DELETE FROM background_jobs WHERE ${sinceOnly}`,
          `DELETE FROM auth_rate_limit_attempts WHERE action = 'LOGIN' AND ${sinceOnly}`,
        ]
      : []),
  ];
}

/** Marked rows older than `since` would be seed data that happens to look like test data: stop instead of deleting them. */
async function assertNothingOlderThan(client: Client, since: Date): Promise<void> {
  const r = await client.query<{ n: string }>(
    `SELECT (
       (SELECT count(*) FROM companies WHERE name ~ $1 AND created_at < $2) +
       (SELECT count(*) FROM contacts WHERE (first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '')) ~ $1 AND created_at < $2) +
       (SELECT count(*) FROM tasks WHERE title ~ $1 AND created_at < $2) +
       (SELECT count(*) FROM tags WHERE name ~ $1 AND created_at < $2) +
       (SELECT count(*) FROM users WHERE email ~ '^e2e\\.' AND created_at < $2)
     )::text AS n`.replace(/\$2/g, `${client.escapeLiteral(utcTimestampLiteral(since))}::timestamp`),
    [E2E_MARKER],
  );
  if (Number(r.rows[0]!.n) > 0) {
    throw new Error(`E2E clean-up stopped: ${r.rows[0]!.n} marked row(s) are older than ${since.toISOString()}, which looks like seed data. Nothing was deleted.`);
  }
}

export async function cleanE2eData(connectionString: string | undefined, options: CleanupOptions = {}): Promise<CleanupReport> {
  const database = assertSafeTarget(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      if (options.since) await assertNothingOlderThan(client, options.since);
      const before = await tableCounts(client);
      // `CREATE TABLE ... AS` cannot take bind parameters, so the three values are written into the statements as escaped literals.
      const ids = options.extraLeadIds ?? [];
      if (!ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error("E2E clean-up: extraLeadIds must be UUIDs.");
      const literals: Record<string, string> = {
        $1: client.escapeLiteral(E2E_MARKER),
        $2: options.since ? `${client.escapeLiteral(utcTimestampLiteral(options.since))}::timestamp` : "NULL::timestamp",
        $3: `ARRAY[${ids.map((id) => client.escapeLiteral(id)).join(", ")}]::text[]`,
      };
      for (const sql of cleanupStatements(Boolean(options.since))) {
        await client.query(sql.replace(/\$[123]/g, (m) => literals[m]!));
      }
      const after = await tableCounts(client);
      const deleted: Record<string, number> = {};
      const grew: Record<string, number> = {};
      for (const [table, n] of Object.entries(before)) {
        const diff = n - (after[table] ?? 0);
        if (diff > 0) deleted[table] = diff;
        if (diff < 0) grew[table] = -diff;
      }
      await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
      return { database, dryRun: Boolean(options.dryRun), deleted, grew, total: Object.values(deleted).reduce((a, b) => a + b, 0) };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    }
  } finally {
    await client.end();
  }
}
