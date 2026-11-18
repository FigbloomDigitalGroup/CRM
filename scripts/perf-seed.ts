import { execSync } from "node:child_process";

/**
 * G1.04: builds the scale database the performance run measures, in its own database (`figbloom_crm_perf`), never in dev or test.
 *
 *   npx tsx scripts/perf-seed.ts            # create, migrate, seed (skips if already seeded)
 *   npx tsx scripts/perf-seed.ts --reset    # drop and rebuild
 *
 * Two organisations, 50,000 leads, 20,000 contacts, 8,000 companies, 15,000 deals and 200,000 activities between them (organisation A
 * holds 80%), plus tasks, communications, notifications, invoices and one very busy company for the Customer 360 measure. Rows are
 * written with set-based SQL (generate_series), so the whole thing takes a couple of minutes. Names and numbers are invented.
 */

import { CONTROL_URL as ADMIN_URL, PERF_DB, usePerfDatabase } from "./perfDatabase";

// Everything below runs against the perf database, whatever .env points at.
usePerfDatabase();

const SCALE = { leads: 50_000, contacts: 20_000, companies: 8_000, deals: 15_000, activities: 200_000, tasks: 30_000, communications: 30_000, notifications: 40_000, invoices: 4_000 };

async function main() {
  const reset = process.argv.includes("--reset");
  const { PrismaClient } = await import("@prisma/client");
  const control = new PrismaClient({ datasourceUrl: ADMIN_URL });
  const exists = (await control.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_database WHERE datname = '${PERF_DB}'`))[0]!.n > 0;
  if (exists && reset) {
    await control.$executeRawUnsafe(`DROP DATABASE "${PERF_DB}" WITH (FORCE)`);
  }
  if (!exists || reset) await control.$executeRawUnsafe(`CREATE DATABASE "${PERF_DB}"`);
  await control.$disconnect();

  const env = { ...process.env };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx scripts/db-admin.ts bootstrap-role", { stdio: "inherit", env });
  execSync("npx tsx scripts/db-admin.ts grant-role", { stdio: "inherit", env });

  const { adminDb } = await import("../src/db/adminClient");
  const { seedRolesAndPermissions } = await import("../prisma/seedReference");
  await seedRolesAndPermissions();

  const already = await adminDb.organization.count({ where: { slug: { startsWith: "perf-" } } });
  if (already > 0) {
    console.log("The scale database is already seeded (use --reset to rebuild).");
    await adminDb.$disconnect();
    return;
  }

  const { seedOrganizationDefaults } = await import("../src/services/organizationDefaults");
  const roles = await adminDb.role.findMany();
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
  const t0 = Date.now();

  for (const [slug, share] of [["perf-alpha", 0.8], ["perf-beta", 0.2]] as const) {
    const org = await adminDb.organization.create({ data: { name: `Perf ${slug}`, slug } });
    await seedOrganizationDefaults(org.id);
    const spread: [string, number][] = [["MANAGEMENT", 2], ["SALES", 6], ["DELIVERY", 3], ["FINANCE", 2], ["RESTRICTED_TECHNICAL", 1]];
    const members: { id: string; role: string }[] = [];
    for (const [role, count] of spread) {
      for (let i = 0; i < count; i++) {
        const user = await adminDb.user.create({ data: { email: `${slug}.${role.toLowerCase()}.${i}@example.test`, name: `${role} ${i}` } });
        const m = await adminDb.membership.create({ data: { organizationId: org.id, userId: user.id, roleId: roleId(role), joinedAt: new Date() } });
        members.push({ id: m.id, role });
      }
    }
    const pick = async (table: string, where = "") => (await adminDb.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM ${table} WHERE organization_id = '${org.id}' ${where}`)).map((r) => r.id);
    const ids = {
      statuses: await pick("lead_statuses"),
      sources: await pick("lead_sources"),
      services: await pick("services"),
      openStages: await pick("pipeline_stages", "AND is_won = false AND is_lost = false"),
      wonStages: await pick("pipeline_stages", "AND is_won = true"),
      lostStages: await pick("pipeline_stages", "AND is_lost = true"),
      lostReasons: await pick("lost_reasons"),
      lifecycle: await pick("customer_lifecycle_states"),
      sales: members.filter((m) => m.role === "SALES" || m.role === "MANAGEMENT").map((m) => m.id),
      all: members.map((m) => m.id),
    };
    const arr = (list: string[]) => `ARRAY[${list.map((v) => `'${v}'::text`).join(",")}]`;
    const n = (total: number) => Math.round(total * share);
    const rnd = (a: string) => `(${a})[1 + floor(random() * cardinality(${a}))::int]`;
    const when = "now() - (random() * interval '540 days')";
    const run = async (label: string, sql: string) => {
      const t = Date.now();
      await adminDb.$executeRawUnsafe(sql);
      console.log(`  ${slug} ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    };

    await run("companies", `INSERT INTO companies (id, organization_id, name, industry, email, phone, location, owner_membership_id, lifecycle_state_id, created_at, updated_at)
      SELECT gen_random_uuid(), '${org.id}', 'Company ' || i || ' ' || substr(md5(i::text), 1, 5),
        (ARRAY['Retail','Logistics','Hospitality','Health','Education','Agriculture','Finance'])[1 + (i % 7)], 'info' || i || '@co' || i || '.example.test',
        '+2547' || lpad((10000000 + i)::text, 8, '0'), (ARRAY['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret'])[1 + (i % 5)],
        ${rnd(arr(ids.sales))}::text, ${rnd(arr(ids.lifecycle))}::text, ${when}, now()
      FROM generate_series(1, ${n(SCALE.companies)}) AS i`);
    await run("contacts", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}')
      INSERT INTO contacts (id, organization_id, company_id, first_name, last_name, email, phone, owner_membership_id, created_at, updated_at)
      SELECT gen_random_uuid(), '${org.id}', (c.a)[1 + floor(random() * cardinality(c.a))::int], 'First' || i, 'Last' || (i % 500), 'person' || i || '@mail' || (i % 40) || '.example.test',
        '+2547' || lpad((20000000 + i)::text, 8, '0'), ${rnd(arr(ids.sales))}::text, ${when}, now()
      FROM generate_series(1, ${n(SCALE.contacts)}) AS i, c`);
    await run("leads", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}'), k AS (SELECT array_agg(id) AS a FROM contacts WHERE organization_id = '${org.id}')
      INSERT INTO leads (id, organization_id, lead_status_id, company_id, contact_id, lead_source_id, temperature, service_interest_id, owner_membership_id, created_by_membership_id, notes, created_at, updated_at)
      SELECT gen_random_uuid(), '${org.id}', ${rnd(arr(ids.statuses))}::text, (c.a)[1 + floor(random() * cardinality(c.a))::int], (k.a)[1 + floor(random() * cardinality(k.a))::int],
        ${rnd(arr(ids.sources))}::text, (ARRAY['HOT','WARM','COLD'])[1 + (i % 3)]::"LeadTemperature", ${rnd(arr(ids.services))}::text, ${rnd(arr(ids.sales))}::text, ${rnd(arr(ids.sales))}::text,
        'Lead note ' || i, ${when}, now()
      FROM generate_series(1, ${n(SCALE.leads)}) AS i, c, k`);
    const dealRows = n(SCALE.deals);
    await run("deals (open)", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}'), k AS (SELECT array_agg(id) AS a FROM contacts WHERE organization_id = '${org.id}')
      INSERT INTO deals (id, organization_id, company_id, primary_contact_id, service_id, owner_membership_id, pipeline_stage_id, value, outcome, created_at, updated_at, last_activity_at)
      SELECT gen_random_uuid(), '${org.id}', (c.a)[1 + floor(random() * cardinality(c.a))::int], (k.a)[1 + floor(random() * cardinality(k.a))::int], ${rnd(arr(ids.services))}::text,
        ${rnd(arr(ids.sales))}::text, ${rnd(arr(ids.openStages))}::text, round((random() * 900000 + 10000)::numeric, 2), 'OPEN', ${when}, now(), now() - (random() * interval '60 days')
      FROM generate_series(1, ${Math.round(dealRows * 0.7)}) AS i, c, k`);
    await run("deals (won)", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}')
      INSERT INTO deals (id, organization_id, company_id, service_id, owner_membership_id, pipeline_stage_id, value, outcome, won_at, created_at, updated_at, last_activity_at)
      SELECT gen_random_uuid(), '${org.id}', (c.a)[1 + floor(random() * cardinality(c.a))::int], ${rnd(arr(ids.services))}::text, ${rnd(arr(ids.sales))}::text, ${rnd(arr(ids.wonStages))}::text,
        round((random() * 900000 + 10000)::numeric, 2), 'WON', now() - (random() * interval '300 days'), ${when}, now(), now() - (random() * interval '100 days')
      FROM generate_series(1, ${Math.round(dealRows * 0.2)}) AS i, c`);
    await run("deals (lost)", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}')
      INSERT INTO deals (id, organization_id, company_id, service_id, owner_membership_id, pipeline_stage_id, value, outcome, lost_at, lost_reason_id, created_at, updated_at, last_activity_at)
      SELECT gen_random_uuid(), '${org.id}', (c.a)[1 + floor(random() * cardinality(c.a))::int], ${rnd(arr(ids.services))}::text, ${rnd(arr(ids.sales))}::text, ${rnd(arr(ids.lostStages))}::text,
        round((random() * 900000 + 10000)::numeric, 2), 'LOST', now() - (random() * interval '300 days'), ${rnd(arr(ids.lostReasons))}::text, ${when}, now(), now() - (random() * interval '100 days')
      FROM generate_series(1, ${Math.round(dealRows * 0.1)}) AS i, c`);
    // Activities hang off one record each: leads 60%, contacts 20%, companies 10%, deals 10%.
    for (const [kind, table, column, fraction] of [["leads", "leads", "lead_id", 0.6], ["contacts", "contacts", "contact_id", 0.2], ["companies", "companies", "company_id", 0.1], ["deals", "deals", "deal_id", 0.1]] as const) {
      await run(`activities on ${kind}`, `WITH r AS (SELECT array_agg(id) AS a FROM ${table} WHERE organization_id = '${org.id}')
        INSERT INTO activities (id, organization_id, type, subject, description, occurred_at, author_membership_id, ${column}, created_at)
        SELECT gen_random_uuid(), '${org.id}', (ARRAY['CALL','MEETING','NOTE','EMAIL','WHATSAPP','OTHER'])[1 + (i % 6)]::"ActivityType", 'Activity ' || i, 'Notes for activity ' || i, ${when},
          ${rnd(arr(ids.all))}::text, (r.a)[1 + floor(random() * cardinality(r.a))::int], now()
        FROM generate_series(1, ${Math.round(n(SCALE.activities) * fraction)}) AS i, r`);
    }
    await run("tasks", `WITH r AS (SELECT array_agg(id) AS a FROM leads WHERE organization_id = '${org.id}')
      INSERT INTO tasks (id, organization_id, title, assignee_membership_id, created_by_membership_id, due_at, priority, status, lead_id, created_at, updated_at)
      SELECT gen_random_uuid(), '${org.id}', 'Follow up ' || i, ${rnd(arr(ids.all))}::text, ${rnd(arr(ids.sales))}::text, now() + ((random() * 60 - 20) * interval '1 day'),
        (ARRAY['LOW','MEDIUM','HIGH'])[1 + (i % 3)]::"TaskPriority", (ARRAY['PENDING','PENDING','IN_PROGRESS','COMPLETED'])[1 + (i % 4)]::"TaskStatus", (r.a)[1 + floor(random() * cardinality(r.a))::int], ${when}, now()
      FROM generate_series(1, ${n(SCALE.tasks)}) AS i, r`);
    await run("communications", `WITH r AS (SELECT array_agg(id) AS a FROM contacts WHERE organization_id = '${org.id}')
      INSERT INTO communications (id, organization_id, channel, direction, occurred_at, subject, summary, author_membership_id, contact_id, created_at)
      SELECT gen_random_uuid(), '${org.id}', (ARRAY['EMAIL','PHONE','WHATSAPP'])[1 + (i % 3)]::"CommunicationChannel", (ARRAY['INBOUND','OUTBOUND'])[1 + (i % 2)]::"CommunicationDirection",
        ${when}, 'Subject ' || i, 'Summary of message ' || i, ${rnd(arr(ids.all))}::text, (r.a)[1 + floor(random() * cardinality(r.a))::int], now()
      FROM generate_series(1, ${n(SCALE.communications)}) AS i, r`);
    await run("notifications", `INSERT INTO notifications (id, organization_id, membership_id, type, title, body, created_at)
      SELECT gen_random_uuid(), '${org.id}', ${rnd(arr(ids.all))}::text, 'LEAD_ASSIGNED'::"NotificationType", 'Notification ' || i, 'Body ' || i, ${when}
      FROM generate_series(1, ${n(SCALE.notifications)}) AS i`);
    await run("invoices", `WITH c AS (SELECT array_agg(id) AS a FROM companies WHERE organization_id = '${org.id}')
      INSERT INTO invoices (id, organization_id, number, amount, currency, issued_on, due_on, status, company_id, created_at, updated_at)
      SELECT gen_random_uuid(), '${org.id}', 'INV-' || i, round((random() * 90000 + 1000)::numeric, 2), 'KES', (now() - (random() * interval '200 days'))::date, (now() + (random() * interval '60 days'))::date,
        (ARRAY['DRAFT','SENT','SENT','PAID'])[1 + (i % 4)]::"InvoiceStatus", (c.a)[1 + floor(random() * cardinality(c.a))::int], now(), now()
      FROM generate_series(1, ${n(SCALE.invoices)}) AS i, c`);
    // One company that has a long history, for the Customer 360 measure.
    await adminDb.$executeRawUnsafe(`UPDATE companies SET name = 'Busiest Customer Ltd' WHERE id = (SELECT id FROM companies WHERE organization_id = '${org.id}' ORDER BY id LIMIT 1)`);
    await adminDb.$executeRawUnsafe(`INSERT INTO activities (id, organization_id, type, subject, occurred_at, author_membership_id, company_id, created_at)
      SELECT gen_random_uuid(), '${org.id}', 'NOTE'::"ActivityType", 'History ' || i, now() - (i * interval '1 day'), '${ids.all[0]}', (SELECT id FROM companies WHERE name = 'Busiest Customer Ltd' AND organization_id = '${org.id}'), now()
      FROM generate_series(1, 2000) AS i`);
  }
  await adminDb.$executeRawUnsafe("ANALYZE");
  const counts = await adminDb.$queryRawUnsafe<{ t: string; n: number }[]>(
    `SELECT 'leads' AS t, count(*)::int AS n FROM leads UNION ALL SELECT 'contacts', count(*)::int FROM contacts UNION ALL SELECT 'companies', count(*)::int FROM companies
     UNION ALL SELECT 'deals', count(*)::int FROM deals UNION ALL SELECT 'activities', count(*)::int FROM activities UNION ALL SELECT 'tasks', count(*)::int FROM tasks`,
  );
  console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, counts.map((c) => `${c.t} ${c.n}`).join(", "));
  await adminDb.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
