/**
 * Anonymised data refresh for staging (FIG-1123, P1.01). Full runbook: docs/STAGING.md.
 *
 *   tsx scripts/staging-refresh.ts check       # read-only: guards, rules against the live schema, unclassified columns
 *   tsx scripts/staging-refresh.ts anonymise   # in place, one transaction; needs --yes and STAGING_REFRESH_CONFIRM=<db name>
 *   tsx scripts/staging-refresh.ts verify      # read-only: residue scan (counts only), RLS still on
 *
 * The data gets into the staging database by `pg_dump | pg_restore` (docs/STAGING.md), never through this script and never
 * through a laptop. This script then scrubs the restored copy where it sits, BEFORE the app is started against it.
 *
 * Safety properties:
 *   - Refused anywhere but staging (`stagingGuard.ts`): production, unset environment, a database not named "staging".
 *   - One transaction. Any failed check rolls everything back, so a half-anonymised database is never left behind.
 *   - Nothing is printed but table names, column names and counts. Database errors are reduced to their code and location.
 *   - `organization_id` and every other id and foreign key are untouched, so row-level security and organisation isolation
 *     hold exactly as they did. Replacement values are a hash of the original plus a random salt that is discarded, so
 *     the same email gets the same stand-in everywhere in one run, and nothing can be looked up from the result.
 *   - Fail closed on new columns: a text or JSON column that no rule classifies stops the run until someone decides.
 *   - Dev data is removed too: `@figbloom.local` users are rewritten and the platform identities table is emptied, so a
 *     database restored from a dev dump is also safe to boot in production mode (the boot guard counts dev accounts).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { assertConfirmed, assertStagingEnvironment, describeDbError, STAGING_EMAIL_DOMAIN } from "./stagingGuard";

type Kind =
  | "email" | "person" | "company" | "first" | "last" | "phone" | "text" | "url" | "ip" | "agent" | "filename"
  | "json" | "json_array" | "null";
type Rule = { column: string; kind: Kind } | { column: string; kind: "raw"; sql: string };

/** Rows removed outright: credentials, secrets, queues, logs and imports that hold or could replay real data. Children first. */
export const DELETE_TABLES = [
  "import_session_changes", "import_session_issues", "import_sessions",
  "sessions", "password_reset_tokens", "idempotency_keys", "push_subscriptions", "sync_mutations",
  "website_lead_request_log", "website_api_keys", "inbound_email_keys", "auth_rate_limit_attempts",
  "background_jobs", "notification_deliveries", "sign_in_events", "search_recents", "platform_identities",
];

const t = (...columns: string[]): Rule[] => columns.map((column) => ({ column, kind: "text" }));
const j = (...columns: string[]): Rule[] => columns.map((column) => ({ column, kind: "json" }));

/** Columns rewritten in place. */
export const SCRUB: Record<string, Rule[]> = {
  organizations: [{ column: "phone", kind: "phone" }, { column: "website", kind: "url" }, ...t("address")],
  users: [
    { column: "email", kind: "email" }, { column: "name", kind: "person" }, { column: "phone", kind: "phone" },
    { column: "password_hash", kind: "null" },
    { column: "failed_sign_in_count", kind: "raw", sql: "0" },
    { column: "last_failed_sign_in_at", kind: "null" }, { column: "locked_until", kind: "null" },
  ],
  memberships: [{ column: "invite_token_hash", kind: "null" }, ...j("avatar_crop")],
  companies: [
    { column: "name", kind: "company" }, { column: "website", kind: "url" }, { column: "phone", kind: "phone" },
    { column: "email", kind: "email" }, ...t("location", "notes", "archive_reason"), ...j("custom_fields"),
  ],
  contacts: [
    { column: "first_name", kind: "first" }, { column: "last_name", kind: "last" }, { column: "phone", kind: "phone" },
    { column: "email", kind: "email" }, ...t("notes", "archive_reason"), ...j("custom_fields", "social_profiles"),
  ],
  leads: [...t("notes", "archive_reason"), ...j("qualification_data", "custom_fields")],
  deals: [...t("notes", "archive_reason"), ...j("custom_fields")],
  activities: t("subject", "description", "outcome"),
  tasks: t("title", "description", "requirements", "archive_reason"),
  communications: [
    ...t("subject", "summary", "external_reference", "dismiss_reason"),
    { column: "counterparty_email", kind: "email" }, { column: "counterparty_name", kind: "person" },
    { column: "counterparty_phone", kind: "phone" },
  ],
  proposal_references: t("document_reference", "notes"),
  company_services: t("notes"),
  invoices: t("notes", "void_reason"),
  payment_records: t("reference", "reversal_reason"),
  deal_payment_notes: t("note"),
  recurring_services: t("cancel_reason", "override_reason", "notes"),
  lifecycle_events: [...t("reason", "note"), ...j("detail")],
  deal_handoffs: [...t("scope", "requirements"), { column: "deliverables", kind: "json_array" }],
  notifications: t("title", "body"),
  comments: t("body"),
  attachments: t("title"),
  files: [{ column: "name", kind: "filename" }],
  audit_events: j("previous_value", "new_value", "metadata"),
  merge_records: j("snapshot"),
  deal_moves: j("previous"),
  lead_pool_requests: t("note", "decision_reason"),
  data_subject_requests: [...t("subject_label", "evidence_notes"), ...j("result")],
  export_approvals: [...t("reason", "decision_note"), ...j("filters")],
  data_runs: [...t("failure_message"), ...j("params")],
  automation_runs: [...t("result"), ...j("detail")],
  scheduled_job_runs: t("last_error"),
};

/** Text, JSON and array columns that hold no personal data (configuration, enums as text, structure). Everything else must be in SCRUB. */
export const KEEP_GLOBAL = /^(id|.+_id|.+_ids|key|slug|status|kind|type|scope|currency|default_currency|timezone|time_zone|colour|mime_type|theme|page_colour|default_theme|default_page_colour|ui_mode|density|start_page|hour_format|first_day_of_week|date_format|working_days|working_hours_start|working_hours_end|quiet_hours_start|quiet_hours_end|key_prefix)$/;
export const KEEP: string[] = [
  "organizations.name", "organizations.display_name",
  "roles.name", "roles.description", "roles.required_feature", "permissions.area", "permissions.description",
  "organization_settings.value", "website_lead_assignment_rules.name", "page_views.page",
  "files.checksum_sha256", "files.storage_key", "files.scan_result", "files.quarantine_reason",
  "user_preferences.toggle_light_page", "user_preferences.toggle_dark_page", "user_preferences.sidebar",
  "user_preferences.own_colours", "user_preferences.undo_snapshot", "user_preferences.undo_token_hash",
  "lead_sources.name", "lead_sources.description", "lead_statuses.name", "lead_statuses.description",
  "pipeline_stages.name", "pipeline_stages.description", "customer_lifecycle_states.name", "customer_lifecycle_states.description",
  "lost_reasons.name", "lost_reasons.description", "services.name", "services.category", "services.description",
  "companies.industry", "companies.health_band", "companies.health_factors",
  "contacts.job_title", "contacts.department", "leads.score_band", "leads.score_factors",
  "proposal_references.proposal_number", "invoices.number", "payment_records.method_label",
  "audit_events.action", "audit_events.entity_type", "custom_field_definitions.label", "custom_field_definitions.options",
  "custom_field_definitions.help_text", "tags.name", "email_templates.name", "email_templates.subject", "email_templates.body",
  "automation_rules.rule_key", "automation_rules.config", "automation_runs.rule_key", "automation_runs.trigger_key",
  "automation_runs.entity_type", "import_mapping_presets.name", "import_mapping_presets.entity",
  "import_mapping_presets.mapping", "import_mapping_presets.value_mappings", "signal_snapshots.value",
  "data_runs.entity", "export_approvals.entity", "merge_records.entity_type", "notifications.entity_type",
  "notifications.link", "scheduled_job_runs.job_key", "notification_deliveries.template_key",
  "memberships.avatar_crop",
];

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Refusing to use unsafe identifier: ${name}`);
  return `"${name}"`;
}

/** SQL for the stand-in value. `$1` is the per-run salt. Same input gives the same output within one run. */
function expression(table: string, column: string, kind: Kind, nullable: boolean, dataType: string): string {
  const c = ident(column);
  const h = (v: string) => `encode(sha256(convert_to($1::text || ':' || ${v}, 'utf8')), 'hex')`;
  const byValue = h(`lower(${c}::text)`);
  const byRow = h(`"id"::text || ':${column}'`);
  switch (kind) {
    case "email": return `'u' || substr(${byValue}, 1, 12) || '@${STAGING_EMAIL_DOMAIN}'`;
    case "person": return `'Person ' || substr(${byValue}, 1, 6)`;
    case "company": return `'Company ' || substr(${byValue}, 1, 6)`;
    case "first": return `'Contact'`;
    case "last": return `'C' || substr(${byRow}, 1, 6)`;
    // +254 0000 nnnnnn: not a dialable Kenyan number, but it passes E.164 length checks.
    case "phone": return `'+2540000' || lpad(((('x' || substr(${byValue}, 1, 7))::bit(28)::int) % 1000000)::text, 6, '0')`;
    case "text": return `'Redacted ' || substr(${byRow}, 1, 8)`;
    case "url": return `'https://' || substr(${byValue}, 1, 10) || '.example.com'`;
    // 192.0.2.0/24 is reserved for documentation (RFC 5737).
    case "ip": return `'192.0.2.' || (((('x' || substr(${byValue}, 1, 2))::bit(8)::int) % 254) + 1)::text`;
    case "agent": return `'staging-agent'`;
    case "filename": return `'file-' || substr(${byRow}, 1, 8) || coalesce(substring(${c} from '\\.[A-Za-z0-9]{1,8}$'), '')`;
    case "null": return `NULL`;
    case "json":
    case "json_array": {
      if (nullable) return `NULL`;
      const empty = kind === "json" ? "{}" : "[]";
      return dataType === "jsonb" ? `'${empty}'::jsonb` : `'${empty}'::json`;
    }
  }
}

interface Column { table: string; column: string; dataType: string; nullable: boolean }

async function loadColumns(db: Client): Promise<Column[]> {
  const { rows } = await db.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
    `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.table_name <> '_prisma_migrations'`,
  );
  return rows.map((r) => ({ table: r.table_name, column: r.column_name, dataType: r.data_type, nullable: r.is_nullable === "YES" }));
}

const TEXTUAL = new Set(["text", "character varying", "json", "jsonb", "ARRAY"]);

/** Problems with the rules themselves, against the live schema. Empty means the rules cover it. */
export function auditRules(columns: Column[]): { missing: string[]; unclassified: string[] } {
  const have = new Map(columns.map((c) => [`${c.table}.${c.column}`, c]));
  const tables = new Set(columns.map((c) => c.table));
  const missing: string[] = [];
  for (const table of DELETE_TABLES) if (!tables.has(table)) missing.push(table);
  for (const [table, rules] of Object.entries(SCRUB)) {
    for (const r of rules) if (!have.has(`${table}.${r.column}`)) missing.push(`${table}.${r.column}`);
  }
  const scrubbed = new Set(Object.entries(SCRUB).flatMap(([table, rules]) => rules.map((r) => `${table}.${r.column}`)));
  const kept = new Set(KEEP);
  const deleted = new Set(DELETE_TABLES);
  const unclassified = columns
    .filter((c) => TEXTUAL.has(c.dataType) && !deleted.has(c.table))
    .filter((c) => !scrubbed.has(`${c.table}.${c.column}`) && !kept.has(`${c.table}.${c.column}`) && !KEEP_GLOBAL.test(c.column))
    .map((c) => `${c.table}.${c.column}`);
  return { missing, unclassified };
}

const EMAIL_LIKE = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";

/** Read-only residue checks. Returns a list of failures (names and counts only). */
async function residue(db: Client, columns: Column[]): Promise<string[]> {
  const failures: string[] = [];
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

  const external = await count(`SELECT count(*) AS n FROM users WHERE email NOT LIKE $1`, [`%@${STAGING_EMAIL_DOMAIN}`]);
  if (external > 0) failures.push(`users: ${external} email(s) outside @${STAGING_EMAIL_DOMAIN}`);
  const dev = await count(`SELECT count(*) AS n FROM users WHERE lower(email) LIKE '%@figbloom.local'`);
  if (dev > 0) failures.push(`users: ${dev} dev account(s) (@figbloom.local)`);
  const platform = await count(`SELECT count(*) AS n FROM platform_identities`);
  if (platform > 0) failures.push(`platform_identities: ${platform} row(s)`);
  const hashes = await count(`SELECT count(*) AS n FROM users WHERE password_hash IS NOT NULL AND email NOT LIKE 'uat-%'`);
  if (hashes > 0) failures.push(`users: ${hashes} real password hash(es)`);
  for (const table of ["sessions", "password_reset_tokens", "background_jobs", "notification_deliveries", "push_subscriptions"]) {
    const n = await count(`SELECT count(*) AS n FROM ${ident(table)}`);
    if (n > 0) failures.push(`${table}: ${n} row(s) should be empty after a refresh`);
  }

  // Emails hiding in free text, JSON or arrays. Our own stand-in domain and reserved example.com are fine.
  const deleted = new Set(DELETE_TABLES);
  for (const c of columns.filter((x) => TEXTUAL.has(x.dataType) && !deleted.has(x.table))) {
    if (c.column === "password_hash" || c.column.endsWith("_hash") || c.column === "checksum_sha256") continue;
    const n = await count(
      `SELECT count(*) AS n FROM ${ident(c.table)}
        WHERE ${ident(c.column)}::text ~* $1 AND ${ident(c.column)}::text !~* '@(staging\\.)?example\\.com'`,
      [EMAIL_LIKE],
    );
    if (n > 0) failures.push(`${c.table}.${c.column}: ${n} row(s) contain an email address outside example.com`);
  }

  // Row-level security must still be on for every tenant table (the same check as docs/MIGRATION_REHEARSAL.md).
  const rls = await db.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'organization_id')
        AND (NOT c.relrowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`,
  );
  for (const r of rls.rows) failures.push(`${r.relname}: row-level security is off or has no policy`);
  return failures;
}

async function rowCounts(db: Client, columns: Column[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const table of new Set(columns.map((c) => c.table))) {
    out.set(table, Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${ident(table)}`)).rows[0]!.n));
  }
  return out;
}

async function check(db: Client, columns: Column[]): Promise<boolean> {
  const { missing, unclassified } = auditRules(columns);
  for (const m of missing) console.error(`Rule names something the database does not have: ${m}`);
  for (const u of unclassified) console.error(`Unclassified column (add it to SCRUB or KEEP in scripts/staging-refresh.ts): ${u}`);
  const ok = missing.length === 0 && unclassified.length === 0;
  console.log(ok ? "Rules cover every text, JSON and array column." : "Rules need attention (see above).");
  return ok;
}

async function anonymise(db: Client, columns: Column[]) {
  if (!(await check(db, columns))) throw new Error("Refusing to anonymise until every column is classified.");
  const salt = randomBytes(32).toString("hex"); // used for this run only, never printed or stored
  const byKey = new Map(columns.map((c) => [`${c.table}.${c.column}`, c]));

  await db.query("BEGIN");
  try {
    const before = await rowCounts(db, columns);

    for (const table of DELETE_TABLES) {
      const { rowCount } = await db.query(`DELETE FROM ${ident(table)}`);
      console.log(`  deleted ${rowCount ?? 0} row(s) from ${table}`);
    }

    for (const [table, rules] of Object.entries(SCRUB)) {
      const sets = rules.map((r) => {
        const col = byKey.get(`${table}.${r.column}`)!;
        const value = r.kind === "raw" ? r.sql : expression(table, r.column, r.kind, col.nullable, col.dataType);
        // Keep NULL as NULL, so "no phone" stays "no phone".
        return r.kind === "raw" || r.kind === "null" || r.kind === "agent"
          ? `${ident(r.column)} = ${value}`
          : `${ident(r.column)} = CASE WHEN ${ident(r.column)} IS NULL THEN NULL ELSE ${value} END`;
      });
      const usesSalt = sets.some((s) => s.includes("$1"));
      const { rowCount } = await db.query(`UPDATE ${ident(table)} SET ${sets.join(", ")}`, usesSalt ? [salt] : []);
      console.log(`  rewrote ${rules.length} column(s) on ${rowCount ?? 0} row(s) of ${table}`);
    }

    // No row may appear or vanish except in the tables emptied on purpose.
    const after = await rowCounts(db, columns);
    for (const [table, n] of before) {
      if (DELETE_TABLES.includes(table)) continue;
      if (after.get(table) !== n) throw new Error(`Row count changed in ${table} (${n} before, ${after.get(table)} after).`);
    }

    const failures = await residue(db, columns);
    if (failures.length > 0) {
      for (const f of failures) console.error(`  residue: ${f}`);
      throw new Error("Residue found after anonymising; rolled back.");
    }
    await db.query("COMMIT");
    console.log("Committed. Next: npx tsx scripts/staging-seed.ts (adds the UAT sign-ins), then start the app.");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const command = process.argv[2];
  if (!["check", "anonymise", "verify"].includes(command ?? "")) {
    console.error("Usage: tsx scripts/staging-refresh.ts <check|anonymise|verify>");
    process.exit(1);
  }
  const databaseName = assertStagingEnvironment();
  if (command === "anonymise") assertConfirmed(databaseName);
  console.log(`staging-refresh ${command} on database "${databaseName}"`);

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const columns = await loadColumns(db);
    if (command === "check") process.exitCode = (await check(db, columns)) ? 0 : 1;
    if (command === "anonymise") await anonymise(db, columns);
    if (command === "verify") {
      const failures = await residue(db, columns);
      for (const f of failures) console.error(`  residue: ${f}`);
      console.log(failures.length === 0 ? "Verified: no residue, row-level security on for every tenant table." : "Residue found.");
      process.exitCode = failures.length === 0 ? 0 : 1;
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1] && /staging-refresh/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(describeDbError(err));
    process.exit(1);
  });
}
