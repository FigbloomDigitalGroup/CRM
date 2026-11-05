import "dotenv/config";

/**
 * Adoption report for the internal pilot (FIG-1130, P1.08; docs/PILOT_PLAN.md).
 *
 *   npx tsx scripts/adoption-report.ts --org <slug> [--days 14]
 *   (the connection comes from ADOPTION_REPORT_DATABASE_URL, never from the command line)
 *
 * READ-ONLY and COUNTS-ONLY. Every statement is a single SELECT that returns numbers: no names, no emails, no record ids, no deal values, no
 * payments. It runs inside a READ ONLY transaction. Point it at staging (the UAT data) or at production by a person who is allowed to; this
 * file does not connect to anything when it is imported (the tests use a fake query function).
 *
 * Masking: no query reads `deals.value` or any payment or invoice table, so the output is safe to share with any role. Payments are not
 * counted at all (a payment count would still tell a reader who may not see payments that some exist).
 *
 * Connect with a role that can see the organisation's rows (the owner role, or the app role after setting app.current_organization_id).
 */

export interface AdoptionQuery {
  id: string;
  label: string;
  /** FIG-444 measure this feeds, or "" when it is an extra. */
  measure: string;
  /** $1 = organisation slug, $2 = window in days. */
  sql: string;
}

const ORG = `(SELECT id FROM organizations WHERE slug = $1)`;
const WINDOW = `now() - ($2::int * interval '1 day')`;

/** Memberships that count as intended users: active, in the organisation. */
const ACTIVE_MEMBERS = `SELECT m.id, m.user_id, r.key AS role_key FROM memberships m JOIN roles r ON r.id = m.role_id
   WHERE m.organization_id = ${ORG} AND m.status = 'ACTIVE'`;

/** Memberships that wrote something in the window (activities, leads, deals, tasks, audit events). */
const WRITERS = `SELECT author_membership_id AS mid FROM activities WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}
   UNION SELECT created_by_membership_id FROM leads WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}
   UNION SELECT created_by_membership_id FROM deals WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}
   UNION SELECT created_by_membership_id FROM tasks WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}
   UNION SELECT assignee_membership_id FROM tasks WHERE organization_id = ${ORG} AND completed_at >= ${WINDOW}
   UNION SELECT actor_membership_id FROM audit_events WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}`;

export const ADOPTION_QUERIES: AdoptionQuery[] = [
  {
    id: "A1.active_members",
    label: "Active members (the intended users)",
    measure: "A1",
    sql: `SELECT count(*)::int AS n FROM (${ACTIVE_MEMBERS}) a`,
  },
  {
    id: "A1.signed_in",
    label: "Active members with a successful sign-in in the window",
    measure: "A1",
    sql: `SELECT count(DISTINCT a.id)::int AS n FROM (${ACTIVE_MEMBERS}) a
            JOIN sign_in_events s ON s.user_id = a.user_id AND s.organization_id = ${ORG} AND s.outcome = 'SUCCESS' AND s.created_at >= ${WINDOW}`,
  },
  {
    id: "A1.wrote",
    label: "Active members who created or updated at least one record in the window",
    measure: "A1",
    sql: `SELECT count(DISTINCT a.id)::int AS n FROM (${ACTIVE_MEMBERS}) a JOIN (${WRITERS}) w ON w.mid = a.id`,
  },
  {
    id: "A3.leads_created",
    label: "Leads created in the window",
    measure: "A3",
    sql: `SELECT count(*)::int AS n FROM leads WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}`,
  },
  {
    id: "A3.leads_created_by_import",
    label: "of which created by an import",
    measure: "A3",
    sql: `SELECT count(*)::int AS n FROM leads WHERE organization_id = ${ORG} AND created_at >= ${WINDOW} AND import_session_id IS NOT NULL`,
  },
  {
    id: "A4.deals_open",
    label: "Open deals now (a count, never a value)",
    measure: "A4",
    sql: `SELECT count(*)::int AS n FROM deals WHERE organization_id = ${ORG} AND outcome = 'OPEN' AND archived_at IS NULL`,
  },
  {
    id: "A4.deals_created",
    label: "Deals created in the window",
    measure: "A4",
    sql: `SELECT count(*)::int AS n FROM deals WHERE organization_id = ${ORG} AND created_at >= ${WINDOW}`,
  },
  {
    id: "A4.deals_moved",
    label: "Open deals with activity in the window",
    measure: "A4",
    sql: `SELECT count(*)::int AS n FROM deals WHERE organization_id = ${ORG} AND outcome = 'OPEN' AND archived_at IS NULL AND last_activity_at >= ${WINDOW}`,
  },
  {
    id: "A5.task_users_eligible",
    label: "Active Sales and Delivery members",
    measure: "A5",
    sql: `SELECT count(*)::int AS n FROM (${ACTIVE_MEMBERS}) a WHERE a.role_key IN ('SALES', 'DELIVERY')`,
  },
  {
    id: "A5.task_users_active",
    label: "of which created or completed a task in the window",
    measure: "A5",
    sql: `SELECT count(DISTINCT a.id)::int AS n FROM (${ACTIVE_MEMBERS}) a
            JOIN tasks t ON t.organization_id = ${ORG}
             AND ((t.created_by_membership_id = a.id AND t.created_at >= ${WINDOW}) OR (t.assignee_membership_id = a.id AND t.completed_at >= ${WINDOW}))
           WHERE a.role_key IN ('SALES', 'DELIVERY')`,
  },
  {
    id: "A6.management_members",
    label: "Active Management members",
    measure: "A6",
    sql: `SELECT count(*)::int AS n FROM (${ACTIVE_MEMBERS}) a WHERE a.role_key = 'MANAGEMENT'`,
  },
  {
    id: "A6.management_reports_viewers",
    label: "of which opened /reports in the window",
    measure: "A6",
    sql: `SELECT count(DISTINCT a.id)::int AS n FROM (${ACTIVE_MEMBERS}) a
            JOIN page_views p ON p.membership_id = a.id AND p.organization_id = ${ORG} AND p.page = 'reports' AND p.viewed_at >= ${WINDOW}
           WHERE a.role_key = 'MANAGEMENT'`,
  },
  {
    id: "X.page_views",
    label: "Page views recorded in the window (all pages)",
    measure: "",
    sql: `SELECT count(*)::int AS n FROM page_views WHERE organization_id = ${ORG} AND viewed_at >= ${WINDOW}`,
  },
  {
    id: "D2.leads_no_owner",
    label: "Open leads with no owner",
    measure: "D2",
    sql: `SELECT count(*)::int AS n FROM leads WHERE organization_id = ${ORG} AND archived_at IS NULL AND converted_at IS NULL AND owner_membership_id IS NULL`,
  },
  {
    id: "D2.companies_no_owner",
    label: "Companies with no owner",
    measure: "D2",
    sql: `SELECT count(*)::int AS n FROM companies WHERE organization_id = ${ORG} AND archived_at IS NULL AND owner_membership_id IS NULL`,
  },
  {
    id: "D2.contacts_no_owner",
    label: "Contacts with no owner",
    measure: "D2",
    sql: `SELECT count(*)::int AS n FROM contacts WHERE organization_id = ${ORG} AND archived_at IS NULL AND owner_membership_id IS NULL`,
  },
  {
    id: "D4.leads_stale",
    label: "Open leads with no update and no activity for 30 days",
    measure: "D4",
    sql: `SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${ORG} AND l.archived_at IS NULL AND l.converted_at IS NULL
             AND l.updated_at < now() - interval '30 days'
             AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.organization_id = l.organization_id AND a.lead_id = l.id AND a.occurred_at >= now() - interval '30 days')`,
  },
  {
    id: "D4.leads_open",
    label: "Open leads (denominator for stale leads)",
    measure: "D4",
    sql: `SELECT count(*)::int AS n FROM leads WHERE organization_id = ${ORG} AND archived_at IS NULL AND converted_at IS NULL`,
  },
  {
    id: "D4.deals_stale",
    label: "Open deals past the expected close date with no activity for 14 days",
    measure: "D4",
    sql: `SELECT count(*)::int AS n FROM deals WHERE organization_id = ${ORG} AND outcome = 'OPEN' AND archived_at IS NULL
             AND expected_close_date < current_date AND last_activity_at < now() - interval '14 days'`,
  },
  {
    id: "D5.companies_total",
    label: "Companies (denominator for D5)",
    measure: "D5",
    sql: `SELECT count(*)::int AS n FROM companies WHERE organization_id = ${ORG} AND archived_at IS NULL`,
  },
  {
    id: "D5.companies_with_contact",
    label: "Companies with at least one contact",
    measure: "D5",
    sql: `SELECT count(*)::int AS n FROM companies c WHERE c.organization_id = ${ORG} AND c.archived_at IS NULL
             AND EXISTS (SELECT 1 FROM contacts k WHERE k.organization_id = c.organization_id AND k.company_id = c.id AND k.archived_at IS NULL)`,
  },
  {
    id: "D6.deals_outcome_mismatch",
    label: "Deals whose outcome disagrees with the stage flags (should be 0)",
    measure: "D6",
    sql: `SELECT count(*)::int AS n FROM deals d JOIN pipeline_stages s ON s.id = d.pipeline_stage_id
           WHERE d.organization_id = ${ORG}
             AND ((d.outcome = 'WON' AND NOT s.is_won) OR (d.outcome = 'LOST' AND NOT s.is_lost) OR (d.outcome = 'OPEN' AND (s.is_won OR s.is_lost)))`,
  },
];

export interface AdoptionRow {
  id: string;
  label: string;
  measure: string;
  value: number | null;
  error?: string;
}

/** A function that runs one statement with the given parameters and returns the first row's `n`. Injected so tests need no database. */
export type RunCount = (sql: string, params: unknown[]) => Promise<number>;

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do)\b/i;

/** Guard: every statement must be one read-only SELECT. Exported so the test can assert it for the whole list. */
export function assertReadOnlyCountsOnly(q: AdoptionQuery): void {
  const sql = q.sql.trim();
  if (!/^select\s+count\(/i.test(sql)) throw new Error(`${q.id}: must start with SELECT count(`);
  if (sql.includes(";")) throw new Error(`${q.id}: must be a single statement`);
  if (FORBIDDEN.test(sql)) throw new Error(`${q.id}: contains a write or admin keyword`);
  if (/\b(value|amount|payments?|invoices?)\b/i.test(sql.replace(/importsession/gi, ""))) {
    throw new Error(`${q.id}: reads money (value, amount, payments or invoices), which counts-only reports must not`);
  }
}

export async function runAdoptionReport(run: RunCount, orgSlug: string, days: number, queries: AdoptionQuery[] = ADOPTION_QUERIES): Promise<AdoptionRow[]> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(orgSlug)) throw new Error("Organisation slug looks wrong");
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days must be a whole number from 1 to 365");
  const rows: AdoptionRow[] = [];
  for (const q of queries) {
    assertReadOnlyCountsOnly(q);
    try {
      rows.push({ id: q.id, label: q.label, measure: q.measure, value: await run(q.sql, [orgSlug, days]) });
    } catch (err) {
      // Print the failure class only, never a message that could echo data or a connection string.
      rows.push({ id: q.id, label: q.label, measure: q.measure, value: null, error: err instanceof Error ? err.name : "Error" });
    }
  }
  return rows;
}

export function percent(part: number | null | undefined, whole: number | null | undefined): string {
  if (part == null || whole == null || whole === 0) return "n/a";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

/** Plain-text report: the raw counts plus the ratios the pilot plan asks for. */
export function formatAdoptionReport(rows: AdoptionRow[], orgSlug: string, days: number): string {
  const v = (id: string): number | null => rows.find((r) => r.id === id)?.value ?? null;
  const lines = [`Adoption report: organisation ${orgSlug}, window ${days} days (counts only)`, ""];
  for (const r of rows) lines.push(`${r.id.padEnd(32)} ${r.error ? `ERROR (${r.error})` : String(r.value).padStart(6)}  ${r.label}`);
  lines.push(
    "",
    `A1 signed in / active members     ${percent(v("A1.signed_in"), v("A1.active_members"))}   (threshold 80%)`,
    `A1 wrote / active members         ${percent(v("A1.wrote"), v("A1.active_members"))}   (threshold 80%)`,
    `A5 task users / Sales+Delivery    ${percent(v("A5.task_users_active"), v("A5.task_users_eligible"))}   (threshold 70%)`,
    `A6 Management who opened /reports ${percent(v("A6.management_reports_viewers"), v("A6.management_members"))}   (threshold 100%, 7-day window)`,
    `D4 stale open leads               ${percent(v("D4.leads_stale"), v("D4.leads_open"))}   (threshold under 10%)`,
    `D5 companies with a contact       ${percent(v("D5.companies_with_contact"), v("D5.companies_total"))}   (threshold 90% or more)`,
  );
  return lines.join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const org = arg("org");
  const days = Number(arg("days") ?? "14");
  const url = process.env.ADOPTION_REPORT_DATABASE_URL;
  if (!org || !url) {
    console.error("Usage: ADOPTION_REPORT_DATABASE_URL=<url> npx tsx scripts/adoption-report.ts --org <slug> [--days 14]");
    process.exit(2);
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const run: RunCount = async (sql, params) => {
      const res = await client.query<{ n: number }>(sql, params);
      return Number(res.rows[0]?.n ?? 0);
    };
    const rows = await runAdoptionReport(run, org, days);
    console.log(formatAdoptionReport(rows, org, days));
    process.exitCode = rows.some((r) => r.error) ? 1 : 0;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

// Run only when started directly, never when imported by a test.
if (process.argv[1] && /adoption-report\.(ts|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.name : "Error");
    process.exit(1);
  });
}
