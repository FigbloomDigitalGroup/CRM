import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/**
 * G1.07: fills an existing organisation with production-shaped volume using plain SQL that is valid on BOTH the `pre-makeover` schema and the
 * current one (only columns both have), so the same script can load the old database before the migrations run.
 *
 *   DATABASE_URL=<rehearsal database> npx tsx scripts/rehearsal-scale.ts <organisation slug>
 *
 * Numbers are about a quarter of the G1.04 scale: 12,000 leads, 5,000 contacts, 2,000 companies, 3,500 deals, 40,000 activities, 8,000 tasks,
 * 8,000 communications, 8,000 notifications. Everything is invented.
 */
const slug = process.argv[2];
if (!slug) throw new Error("Usage: rehearsal-scale.ts <organisation slug>");

const db = new PrismaClient();

const one = async <T>(sql: string) => (await db.$queryRawUnsafe<T[]>(sql))[0]!;

async function main() {
  const org = await one<{ id: string }>(`SELECT id FROM organizations WHERE slug = '${slug}'`);
  const col = async (table: string, extra = "") => (await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${table} WHERE organization_id = '${org.id}' ${extra}`)).map((r) => r.id);
  const members = await col("memberships");
  const statuses = await col("lead_statuses");
  const sources = await col("lead_sources");
  const services = await col("services");
  const openStages = await col("pipeline_stages", "AND is_won = false AND is_lost = false");
  const arr = (list: string[]) => `ARRAY[${list.map((v) => `'${v}'::text`).join(",")}]`;
  const pickFrom = (list: string[]) => `(${arr(list)})[1 + floor(random() * ${list.length})::int]`;
  const when = "now() - (random() * interval '540 days')";
  const run = async (label: string, sql: string) => {
    const t = Date.now();
    await db.$executeRawUnsafe(sql);
    console.log(`  ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  };

  await run("companies", `INSERT INTO companies (id, organization_id, name, industry, email, phone, location, owner_membership_id, created_at, updated_at)
    SELECT gen_random_uuid(), '${org.id}', 'Rehearsal Co ' || i, 'Retail', 'info' || i || '@rehearsal.example.test', '+2547' || lpad((30000000 + i)::text, 8, '0'), 'Nairobi', ${pickFrom(members)}, ${when}, now()
    FROM generate_series(1, 2000) AS i`);
  await run("contacts", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}')
    INSERT INTO contacts (id, organization_id, company_id, first_name, last_name, email, phone, owner_membership_id, created_at, updated_at)
    SELECT gen_random_uuid(), '${org.id}', (c.a)[1 + floor(random() * cardinality(c.a))::int], 'First' || i, 'Last' || (i % 300), 'person' || i || '@rehearsal.example.test', '+2547' || lpad((40000000 + i)::text, 8, '0'), ${pickFrom(members)}, ${when}, now()
    FROM generate_series(1, 5000) AS i, c`);
  await run("leads", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}'), k AS (SELECT array_agg(id) AS a FROM contacts WHERE organization_id = '${org.id}')
    INSERT INTO leads (id, organization_id, lead_status_id, company_id, contact_id, lead_source_id, temperature, service_interest_id, owner_membership_id, created_by_membership_id, created_at, updated_at)
    SELECT gen_random_uuid(), '${org.id}', ${pickFrom(statuses)}, (c.a)[1 + floor(random() * cardinality(c.a))::int], (k.a)[1 + floor(random() * cardinality(k.a))::int], ${pickFrom(sources)},
      (ARRAY['HOT','WARM','COLD'])[1 + (i % 3)]::"LeadTemperature", ${pickFrom(services)}, ${pickFrom(members)}, ${pickFrom(members)}, ${when}, now()
    FROM generate_series(1, 12000) AS i, c, k`);
  await run("deals", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}')
    INSERT INTO deals (id, organization_id, company_id, service_id, owner_membership_id, pipeline_stage_id, value, outcome, created_at, updated_at)
    SELECT gen_random_uuid(), '${org.id}', (c.a)[1 + floor(random() * cardinality(c.a))::int], ${pickFrom(services)}, ${pickFrom(members)}, ${pickFrom(openStages)},
      round((random() * 900000 + 10000)::numeric, 2), 'OPEN', ${when}, now()
    FROM generate_series(1, 3500) AS i, c`);
  await run("activities", `WITH r AS (SELECT array_agg(id) AS a FROM leads WHERE organization_id = '${org.id}')
    INSERT INTO activities (id, organization_id, type, subject, description, occurred_at, author_membership_id, lead_id, created_at)
    SELECT gen_random_uuid(), '${org.id}', (ARRAY['CALL','MEETING','NOTE','EMAIL','WHATSAPP','OTHER'])[1 + (i % 6)]::"ActivityType", 'Activity ' || i, 'Notes ' || i, ${when}, ${pickFrom(members)}, (r.a)[1 + floor(random() * cardinality(r.a))::int], now()
    FROM generate_series(1, 40000) AS i, r`);
  await run("tasks", `WITH r AS (SELECT array_agg(id) AS a FROM leads WHERE organization_id = '${org.id}')
    INSERT INTO tasks (id, organization_id, title, assignee_membership_id, created_by_membership_id, due_at, priority, status, lead_id, created_at, updated_at)
    SELECT gen_random_uuid(), '${org.id}', 'Follow up ' || i, ${pickFrom(members)}, ${pickFrom(members)}, now() + ((random() * 60 - 20) * interval '1 day'),
      (ARRAY['LOW','MEDIUM','HIGH'])[1 + (i % 3)]::"TaskPriority", (ARRAY['PENDING','PENDING','IN_PROGRESS','COMPLETED'])[1 + (i % 4)]::"TaskStatus", (r.a)[1 + floor(random() * cardinality(r.a))::int], ${when}, now()
    FROM generate_series(1, 8000) AS i, r`);
  await run("communications", `WITH r AS (SELECT array_agg(id) AS a FROM contacts WHERE organization_id = '${org.id}')
    INSERT INTO communications (id, organization_id, channel, direction, occurred_at, subject, summary, author_membership_id, contact_id, created_at)
    SELECT gen_random_uuid(), '${org.id}', (ARRAY['EMAIL','PHONE','WHATSAPP'])[1 + (i % 3)]::"CommunicationChannel", (ARRAY['INBOUND','OUTBOUND'])[1 + (i % 2)]::"CommunicationDirection",
      ${when}, 'Subject ' || i, 'Summary ' || i, ${pickFrom(members)}, (r.a)[1 + floor(random() * cardinality(r.a))::int], now()
    FROM generate_series(1, 8000) AS i, r`);
  await run("notifications", `INSERT INTO notifications (id, organization_id, membership_id, type, title, body, created_at)
    SELECT gen_random_uuid(), '${org.id}', ${pickFrom(members)}, 'LEAD_ASSIGNED'::"NotificationType", 'Notification ' || i, 'Body ' || i, ${when}
    FROM generate_series(1, 8000) AS i`);
  await db.$executeRawUnsafe("ANALYZE");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
