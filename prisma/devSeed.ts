import type { Prisma } from "@prisma/client";
import { DEV_FIXTURE_PASSWORD } from "../src/auth/devAccounts";
import { hashPassword } from "../src/auth/password";
import { adminDb } from "../src/db/adminClient";
import { seedOrganizationDefaults } from "../src/services/organizationDefaults";
import {
  SAMPLE_DATA,
  SAMPLE_NOW,
  type DevUserId,
  type SampleData,
} from "./sampleData";
import { seedRolesAndPermissions } from "./seedReference";

/**
 * The development and demo seed (FIG-1016, B0.08): two organizations, the
 * dev accounts, and the prototype's sample data, so a fresh database is
 * demo-ready with one command. Dev-only (CLAUDE.md rule 10): it refuses to
 * run when `NODE_ENV=production` and unless `ALLOW_DEV_ACCOUNTS=true`.
 *
 * Idempotent. Accounts, memberships and the reference catalogues are
 * upserts; the sample data goes in one transaction together with a marker
 * (`dev_seed` organization setting), so a re-run adds nothing and a crashed
 * run leaves nothing half-written.
 *
 * Also creates the Dev Super Admin platform identity (FIG-1196, B0.09).
 *
 * Not seeded yet because the models do not exist: the Customer Support
 * account (its role arrives with B1.01 / B6.23), payments, tags and
 * templates (B3.03 and later issues add them to this seed).
 */
export interface DevUser {
  id: DevUserId;
  email: string;
  name: string;
  roleKey: string;
}

export const DEV_USERS: readonly DevUser[] = [
  { id: "mg", email: "dev.management@figbloom.local", name: "Dev Management", roleKey: "MANAGEMENT" },
  { id: "s1", email: "dev.sales@figbloom.local", name: "Dev Sales", roleKey: "SALES" },
  { id: "s2", email: "dev.sales2@figbloom.local", name: "Dev Sales Two", roleKey: "SALES" },
  { id: "dl", email: "dev.delivery@figbloom.local", name: "Dev Delivery", roleKey: "DELIVERY" },
  { id: "fn", email: "dev.finance@figbloom.local", name: "Dev Finance", roleKey: "FINANCE" },
  { id: "tc", email: "dev.tech@figbloom.local", name: "Dev Restricted Technical", roleKey: "RESTRICTED_TECHNICAL" },
];

/**
 * The Dev Super Admin (FIG-1196, B0.09): a platform identity, not a tenant
 * user. It has no organization, no membership and no tenant permissions;
 * the dev sign-in lands it on the "Platform console arrives in V1.1" page.
 * B6.03 adopts the `platform_identities` table for real platform admins.
 */
export const DEV_PLATFORM_IDENTITY = {
  email: "dev.superadmin@platform.figbloom.local",
  name: "Dev Super Admin",
} as const;

export const DEV_ORGANIZATIONS = {
  main: { slug: "figbloom", name: "Figbloom Digital Group" },
  sandbox: { slug: "figbloom-sandbox", name: "Figbloom Sandbox" },
} as const;

const SEED_MARKER_KEY = "dev_seed";
const SEED_VERSION = 2;

type Env = Record<string, string | undefined>;

/** Throws unless dev data may be created in this environment. */
export function assertDevSeedAllowed(env: Env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run the dev seed: NODE_ENV is production. Dev accounts and sample data must never exist in production.",
    );
  }
  if (env.ALLOW_DEV_ACCOUNTS !== "true") {
    throw new Error(
      'Refusing to run the dev seed: set ALLOW_DEV_ACCOUNTS="true" (for example in .env) to confirm this is a development database.',
    );
  }
}

type Tx = Prisma.TransactionClient;

interface OrgContext {
  organizationId: string;
  slug: string;
  /** Dev user id -> membership id for the members of this organization. */
  members: Map<DevUserId, string>;
  /** Used when a sample record's owner is not a member of this organization. */
  fallbackOwner: DevUserId;
  shift: number;
  /** Which sample companies to load; all when undefined. */
  companyIds?: Set<string>;
}

async function nameMap(
  rows: Promise<{ id: string; name: string }[]>,
  what: string,
) {
  const map = new Map<string, string>();
  // Keyed case-insensitively: the catalogue says "Linkedin", the prototype "LinkedIn".
  for (const r of await rows) map.set(r.name.toLowerCase(), r.id);
  if (map.size === 0) throw new Error(`No ${what} found; run the organization defaults first.`);
  return map;
}

function need(map: Map<string, string>, name: string | undefined | null, what: string) {
  if (!name) return undefined;
  const id = map.get(name.toLowerCase());
  if (!id) throw new Error(`Sample data names a ${what} "${name}" that the organization does not have.`);
  return id;
}

const ACTIVITY_TYPE: Record<string, "CALL" | "MEETING" | "EMAIL" | "WHATSAPP" | "NOTE"> = {
  call: "CALL",
  meeting: "MEETING",
  email: "EMAIL",
  whatsapp: "WHATSAPP",
};
const TASK_STATUS: Record<string, "PENDING" | "IN_PROGRESS" | "COMPLETED"> = {
  Pending: "PENDING",
  "In progress": "IN_PROGRESS",
  Completed: "COMPLETED",
};
const NOTIFICATION_TYPE: Record<string, "LEAD_ASSIGNED" | "TASK_DUE" | "TASK_OVERDUE" | "DEAL_WON_HANDOFF"> = {
  "Lead assigned": "LEAD_ASSIGNED",
  "Task due": "TASK_DUE",
  "Task overdue": "TASK_OVERDUE",
  Handoff: "DEAL_WON_HANDOFF",
};
/** The prototype's "recurring" rows, as the service each renews (their text names differ from the catalogue). */
const RECURRING_SERVICE: Record<string, string> = {
  r1: "Web Development",
  r2: "Starlink / Internet",
};

async function seedSampleData(
  tx: Tx,
  ctx: OrgContext,
  data: SampleData,
  refs: {
    leadStatus: Map<string, string>;
    leadSource: Map<string, string>;
    stage: Map<string, string>;
    lostReason: Map<string, string>;
    service: Map<string, string>;
    lifecycle: Map<string, string>;
  },
) {
  const { organizationId: orgId } = ctx;
  const d = (iso: string) => new Date(Date.parse(iso) + ctx.shift);
  const dOpt = (iso: string | null | undefined) => (iso ? d(iso) : undefined);
  const owner = (id: DevUserId | null | undefined) => {
    if (!id) return undefined;
    return ctx.members.get(id) ?? ctx.members.get(ctx.fallbackOwner)!;
  };
  const admin = ctx.members.get("mg") ?? ctx.members.get(ctx.fallbackOwner)!;
  const keep = (companyId: string | null | undefined) =>
    !ctx.companyIds || (companyId != null && ctx.companyIds.has(companyId));

  const companyIds = new Map<string, string>();
  const contactIds = new Map<string, string>();
  const leadIds = new Map<string, string>();
  const dealIds = new Map<string, string>();
  const taskIds = new Map<string, string>();

  // Companies
  for (const c of data.companies.filter((c) => keep(c.id))) {
    const row = await tx.company.create({
      data: {
        organizationId: orgId,
        name: c.name,
        industry: c.industry ?? undefined,
        website: c.website ? `https://${c.website.replace(/^https?:\/\//, "")}` : undefined,
        location: c.location ?? undefined,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        lifecycleStateId: need(refs.lifecycle, c.lifecycle, "lifecycle state"),
        ownerMembershipId: owner(c.ownerId),
        createdByMembershipId: admin,
        createdAt: d(c.createdAt),
      },
    });
    companyIds.set(c.id, row.id);
  }

  // Company services (with the renewal date from the prototype's recurring rows)
  for (const c of data.companies.filter((c) => companyIds.has(c.id))) {
    for (const s of c.services) {
      const recurring = data.recurring.find(
        (r) => r.companyId === c.id && RECURRING_SERVICE[r.id] === s.name,
      );
      await tx.companyService.create({
        data: {
          organizationId: orgId,
          companyId: companyIds.get(c.id)!,
          serviceId: need(refs.service, s.name, "service")!,
          status: "ACTIVE",
          startDate: d(c.createdAt),
          endDate: recurring ? d(recurring.renews) : undefined,
          notes: s.label ?? s.status,
        },
      });
    }
  }

  // Contacts
  for (const p of data.contacts.filter((p) => keep(p.companyId))) {
    const row = await tx.contact.create({
      data: {
        organizationId: orgId,
        companyId: p.companyId ? companyIds.get(p.companyId) : undefined,
        firstName: p.first,
        lastName: p.last ?? undefined,
        jobTitle: p.title ?? undefined,
        department: p.department ?? undefined,
        email: p.email ?? undefined,
        phone: p.phone ?? undefined,
        ownerMembershipId: owner(p.ownerId),
        createdByMembershipId: admin,
      },
    });
    contactIds.set(p.id, row.id);
  }

  // Leads. A lead the prototype shows without a company gets a small prospect
  // company of the same name, since a lead is displayed by its company.
  const dealForLead = new Map(data.deals.filter((x) => x.id).map((x) => [x.id, x]));
  for (const l of data.leads.filter((l) => keep(l.companyId))) {
    let companyId = l.companyId ? companyIds.get(l.companyId) : undefined;
    if (!companyId) {
      const prospect = await tx.company.create({
        data: {
          organizationId: orgId,
          name: l.name,
          lifecycleStateId: need(refs.lifecycle, "Prospect", "lifecycle state"),
          ownerMembershipId: owner(l.ownerId),
          createdByMembershipId: admin,
          createdAt: d(l.createdAt),
        },
      });
      companyId = prospect.id;
    }
    const converted = l.status === "Converted";
    const lost = l.status === "Lost";
    const row = await tx.lead.create({
      data: {
        organizationId: orgId,
        companyId,
        contactId: l.contactId ? contactIds.get(l.contactId) : undefined,
        leadSourceId: need(refs.leadSource, l.source, "lead source"),
        leadStatusId: need(refs.leadStatus, l.status, "lead status")!,
        temperature: l.temp.toUpperCase() as "HOT" | "WARM" | "COLD",
        serviceInterestId: need(refs.service, l.service, "service"),
        ownerMembershipId: owner(l.ownerId),
        qualificationData:
          l.qual && Object.keys(l.qual).length > 0 ? (l.qual as Prisma.InputJsonValue) : undefined,
        lostReasonId: lost ? need(refs.lostReason, l.lostReason, "lost reason") : undefined,
        nextFollowUpAt: dOpt(l.next),
        convertedAt: converted
          ? d((l.dealId && dealForLead.get(l.dealId)?.createdAt) || l.createdAt)
          : undefined,
        notes: l.notes || undefined,
        createdByMembershipId: owner(l.ownerId) ?? admin,
        archivedAt: l.archived ? d(l.createdAt) : undefined,
        createdAt: d(l.createdAt),
      },
    });
    leadIds.set(l.id, row.id);
  }

  // Deals, across every stage
  const leadByDeal = new Map(
    data.leads.filter((l) => l.dealId).map((l) => [l.dealId!, l.id]),
  );
  for (const x of data.deals.filter((x) => keep(x.companyId))) {
    const won = x.stage === "Closed Won";
    const lost = x.stage === "Closed Lost";
    const leadSampleId = leadByDeal.get(x.id);
    const row = await tx.deal.create({
      data: {
        organizationId: orgId,
        companyId: companyIds.get(x.companyId)!,
        primaryContactId: x.contactId ? contactIds.get(x.contactId) : undefined,
        leadId: leadSampleId ? leadIds.get(leadSampleId) : undefined,
        serviceId: need(refs.service, x.service, "service"),
        ownerMembershipId: owner(x.ownerId)!,
        pipelineStageId: need(refs.stage, x.stage, "pipeline stage")!,
        value: x.value,
        expectedCloseDate: dOpt(x.close),
        outcome: won ? "WON" : lost ? "LOST" : "OPEN",
        wonAt: won ? d(x.wonAt ?? x.createdAt) : undefined,
        lostAt: lost ? d(x.close ?? x.createdAt) : undefined,
        lostReasonId: lost ? need(refs.lostReason, x.lostReason, "lost reason") : undefined,
        notes: x.title,
        createdByMembershipId: owner(x.ownerId),
        createdAt: d(x.createdAt),
      },
    });
    dealIds.set(x.id, row.id);
    if (x.handoff) {
      await tx.dealHandoff.create({
        data: {
          organizationId: orgId,
          dealId: row.id,
          deliveryOwnerMembershipId: owner(x.handoff.ownerId)!,
          createdByMembershipId: owner(x.ownerId)!,
          createdAt: d(x.wonAt ?? x.createdAt),
        },
      });
    }
  }

  // Tasks
  const linkId = (link: { type: string; id: string } | null | undefined) => {
    if (!link) return {};
    if (link.type === "lead") return { leadId: leadIds.get(link.id) };
    if (link.type === "deal") return { dealId: dealIds.get(link.id) };
    if (link.type === "company") return { companyId: companyIds.get(link.id) };
    if (link.type === "contact") return { contactId: contactIds.get(link.id) };
    return {};
  };
  for (const t of data.tasks) {
    const link = linkId(t.link);
    if (ctx.companyIds && t.link && Object.values(link).every((v) => !v)) continue;
    if (ctx.companyIds && !t.link) continue;
    const status = TASK_STATUS[t.status] ?? "PENDING";
    const row = await tx.task.create({
      data: {
        organizationId: orgId,
        title: t.title,
        description: t.desc ?? undefined,
        assigneeMembershipId: owner(t.assigneeId)!,
        createdByMembershipId: owner(t.assigneeId)!,
        dueAt: dOpt(t.due),
        priority: t.priority.toUpperCase() as "LOW" | "MEDIUM" | "HIGH",
        status,
        completedAt: status === "COMPLETED" ? d(t.doneAt ?? t.due ?? SAMPLE_NOW) : undefined,
        ...link,
      },
    });
    taskIds.set(t.id, row.id);
  }

  // Activities (the prototype's status, stage and system lines become notes)
  for (const a of data.activities) {
    const target =
      a.rt === "lead" ? { leadId: leadIds.get(a.rid) }
      : a.rt === "deal" ? { dealId: dealIds.get(a.rid) }
      : a.rt === "company" ? { companyId: companyIds.get(a.rid) }
      : a.rt === "contact" ? { contactId: contactIds.get(a.rid) }
      : {};
    if (!Object.values(target).some(Boolean)) continue;
    await tx.activity.create({
      data: {
        organizationId: orgId,
        type: ACTIVITY_TYPE[a.kind] ?? "NOTE",
        subject: ACTIVITY_TYPE[a.kind] ? undefined : a.kind === "handoff" ? "Handed off to Delivery" : undefined,
        description: a.text,
        outcome: a.outcome ?? undefined,
        occurredAt: d(a.at),
        authorMembershipId: owner(a.byId) ?? admin,
        ...target,
      },
    });
  }

  // Notifications (only the types the app has; the main organization only)
  if (!ctx.companyIds) {
    for (const n of data.notifications) {
      const type = NOTIFICATION_TYPE[n.type];
      if (!type) continue;
      const [kind, sampleId] = n.link ?? [];
      const entity =
        kind === "lead" && sampleId ? { entityType: "Lead", id: leadIds.get(sampleId), path: "leads" }
        : kind === "deal" && sampleId ? { entityType: "Deal", id: dealIds.get(sampleId), path: "deals" }
        : kind === "task" && sampleId ? { entityType: "Task", id: taskIds.get(sampleId), path: "tasks" }
        : undefined;
      for (const to of n.to) {
        const membershipId = ctx.members.get(to);
        if (!membershipId) continue;
        await tx.notification.create({
          data: {
            organizationId: orgId,
            membershipId,
            type,
            title: n.type,
            body: n.text,
            entityType: entity?.entityType,
            entityId: entity?.id,
            link: entity?.id
              ? `/o/${ctx.slug}/${entity.path}${entity.path === "tasks" ? "" : `/${entity.id}`}`
              : undefined,
            readAt: n.read ? d(n.at) : undefined,
            createdAt: d(n.at),
          },
        });
      }
    }
  }

  return {
    companies: companyIds.size,
    contacts: contactIds.size,
    leads: leadIds.size,
    deals: dealIds.size,
    tasks: taskIds.size,
  };
}

async function seedOrganization(
  org: { slug: string; name: string },
  memberUserIds: DevUserId[],
  passwordHash: string,
  options: { fallbackOwner: DevUserId; companyIds?: Set<string>; now: Date },
) {
  const organization = await adminDb.organization.upsert({
    where: { slug: org.slug },
    update: { name: org.name },
    create: { name: org.name, slug: org.slug },
  });
  await seedOrganizationDefaults(organization.id);

  const members = new Map<DevUserId, string>();
  for (const id of memberUserIds) {
    const devUser = DEV_USERS.find((u) => u.id === id)!;
    const user = await adminDb.user.upsert({
      where: { email: devUser.email },
      update: { name: devUser.name, passwordHash },
      create: { email: devUser.email, name: devUser.name, passwordHash },
    });
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: devUser.roleKey } });
    const membership = await adminDb.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { roleId: role.id },
      create: {
        organizationId: organization.id,
        userId: user.id,
        roleId: role.id,
        joinedAt: new Date(),
      },
    });
    members.set(id, membership.id);
  }

  const marker = await adminDb.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId: organization.id, key: SEED_MARKER_KEY } },
  });
  if (marker) {
    console.log(`"${org.slug}": already seeded (v${(marker.value as { version?: number }).version}); sample data untouched.`);
    return { organizationId: organization.id, seeded: false as const };
  }

  const orgId = organization.id;
  if ((await adminDb.company.count({ where: { organizationId: orgId } })) > 0) {
    // An older dev database (hand-added demo data, or records made through the
    // app): adding the sample set would duplicate companies, so leave it alone.
    console.log(`"${org.slug}": already has records; sample data skipped (run migrate:reset for a clean demo database).`);
    return { organizationId: orgId, seeded: false as const };
  }
  const refs = {
    leadStatus: await nameMap(adminDb.leadStatus.findMany({ where: { organizationId: orgId } }), "lead statuses"),
    leadSource: await nameMap(adminDb.leadSource.findMany({ where: { organizationId: orgId } }), "lead sources"),
    stage: await nameMap(adminDb.pipelineStage.findMany({ where: { organizationId: orgId } }), "pipeline stages"),
    lostReason: await nameMap(adminDb.lostReason.findMany({ where: { organizationId: orgId } }), "lost reasons"),
    service: await nameMap(adminDb.service.findMany({ where: { organizationId: orgId } }), "services"),
    lifecycle: await nameMap(adminDb.customerLifecycleState.findMany({ where: { organizationId: orgId } }), "lifecycle states"),
  };

  const counts = await adminDb.$transaction(
    async (tx) => {
      const result = await seedSampleData(
        tx,
        {
          organizationId: orgId,
          slug: org.slug,
          members,
          fallbackOwner: options.fallbackOwner,
          shift: options.now.getTime() - Date.parse(SAMPLE_NOW),
          companyIds: options.companyIds,
        },
        SAMPLE_DATA,
        refs,
      );
      await tx.organizationSetting.create({
        data: {
          organizationId: orgId,
          key: SEED_MARKER_KEY,
          value: { version: SEED_VERSION, seededAt: options.now.toISOString() },
        },
      });
      return result;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  console.log(
    `"${org.slug}": seeded ${counts.companies} companies, ${counts.contacts} contacts, ${counts.leads} leads, ${counts.deals} deals, ${counts.tasks} tasks.`,
  );
  return { organizationId: orgId, seeded: true as const, counts };
}

/**
 * Runs the whole dev seed. `env` and `now` exist for tests; the CLI
 * (`prisma/seedDev.ts`) passes the real ones.
 */
export async function runDevSeed(options: { env?: Env; now?: Date } = {}) {
  assertDevSeedAllowed(options.env ?? process.env);
  const now = options.now ?? new Date();

  await seedRolesAndPermissions();
  const passwordHash = await hashPassword(DEV_FIXTURE_PASSWORD);

  await adminDb.platformIdentity.upsert({
    where: { email: DEV_PLATFORM_IDENTITY.email },
    update: { name: DEV_PLATFORM_IDENTITY.name, passwordHash, isDev: true },
    create: { ...DEV_PLATFORM_IDENTITY, passwordHash, isDev: true },
  });

  // The main organization is created first, so it is every dev user's oldest
  // membership and login lands there.
  const main = await seedOrganization(
    DEV_ORGANIZATIONS.main,
    DEV_USERS.map((u) => u.id),
    passwordHash,
    { fallbackOwner: "mg", now },
  );
  // The sandbox gives the organization switcher (V1.1) a second organization:
  // Management and one Sales user belong to both, with a small slice of data.
  const sandbox = await seedOrganization(
    DEV_ORGANIZATIONS.sandbox,
    ["mg", "s1"],
    passwordHash,
    { fallbackOwner: "mg", companyIds: new Set(["c2", "c3"]), now },
  );

  console.log(
    `Dev seed ready: ${DEV_USERS.length} accounts plus the Dev Super Admin (password "${DEV_FIXTURE_PASSWORD}"), organizations "${DEV_ORGANIZATIONS.main.slug}" and "${DEV_ORGANIZATIONS.sandbox.slug}".`,
  );
  return { main, sandbox };
}
