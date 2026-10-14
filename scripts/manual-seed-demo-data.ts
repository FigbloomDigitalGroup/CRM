/**
 * Manual dev helper (not part of any npm script): populates the seeded
 * "figbloom" organization with a small, realistic-looking set of demo
 * records -- companies, contacts, leads, deals, and tasks -- so the app
 * doesn't look empty ("No leads yet.", "No companies yet.") during a
 * walkthrough or stakeholder demo.
 *
 * Deliberately kept OUT of `prisma/seed.ts`, which documents on purpose
 * that it seeds no Companies/Contacts/Leads/Deals so nothing there looks
 * like real customer data -- this script is the opt-in, dev-only
 * alternative for when you actually want a populated-looking demo
 * environment. Every company/contact name below is fictional scaffolding:
 * real, well-known Kenyan companies are used as the *company* records
 * (plausible prospective clients for FigBloom's service catalog), but the
 * contact *people* at them are made up -- not real employees.
 *
 * Idempotent per company: if a company with a given name already exists in
 * the org, that company's whole bundle (contact/lead/deal/tasks) is
 * skipped, so re-running this script is safe and doesn't create
 * duplicates. Refuses to run outside local development.
 *
 * Run with: `npx tsx scripts/manual-seed-demo-data.ts`.
 */
import "dotenv/config";
import { DEV_FIXTURE_PASSWORD } from "../src/auth/devAccounts";
import { hashPassword } from "../src/auth/password";
import { adminDb } from "../src/db/adminClient";
import { resolveActiveMembership, type ActiveMembership } from "../src/repositories/memberships";
import { createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import { createLead, updateLead } from "../src/services/leadService";
import { createDeal, updateDeal } from "../src/services/dealService";
import { createTask } from "../src/services/taskService";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run: this seeds obviously-fake demo data and must never touch production.");
  process.exit(1);
}

interface CompanyBundle {
  company: { name: string; industry: string; location: string; website: string };
  contact: {
    firstName: string;
    lastName: string;
    jobTitle: string;
    emailLocalPart: string;
    phone: string;
  };
  lead?: {
    statusKey: string;
    sourceKey: string;
    temperature: "HOT" | "WARM" | "COLD";
    serviceKey: string;
    owner: "sales" | "sales2";
    notes: string;
  };
  deal?: {
    serviceKey: string;
    stageKey: "SOLUTION_PRESENTED" | "PROPOSAL_SENT" | "NEGOTIATION";
    value: number;
    expectedCloseDate: string;
    owner: "sales" | "sales2";
    notes: string;
    closeAsWon?: boolean;
  };
  task?: {
    title: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
    dueInDays: number;
    assignee: "sales" | "sales2";
    linkTo: "lead" | "deal";
  };
}

const COMPANIES: CompanyBundle[] = [
  {
    company: {
      name: "Java House Africa",
      industry: "Hospitality",
      location: "Nairobi, Kenya",
      website: "https://javahouseafrica.com",
    },
    contact: {
      firstName: "Wanjiru",
      lastName: "Kamau",
      jobTitle: "Operations Manager",
      emailLocalPart: "wanjiru.kamau",
      phone: "+254712345601",
    },
    lead: {
      statusKey: "QUALIFIED",
      sourceKey: "REFERRAL",
      temperature: "HOT",
      serviceKey: "INVENTORY",
      owner: "sales",
      notes: "Wants a unified inventory system across 12 branches. Warm referral from an existing client.",
    },
  },
  {
    company: {
      name: "Naivas Supermarket",
      industry: "Retail",
      location: "Nairobi, Kenya",
      website: "https://naivas.co.ke",
    },
    contact: {
      firstName: "Otieno",
      lastName: "Odhiambo",
      jobTitle: "Procurement Lead",
      emailLocalPart: "otieno.odhiambo",
      phone: "+254712345602",
    },
    lead: {
      statusKey: "CONTACTED",
      sourceKey: "WEBSITE",
      temperature: "WARM",
      serviceKey: "ISP_BILLING",
      owner: "sales2",
      notes: "Submitted an enquiry through the website about branch connectivity billing.",
    },
    task: {
      title: "Follow up with Naivas procurement on ISP billing quote",
      priority: "MEDIUM",
      dueInDays: -2,
      assignee: "sales2",
      linkTo: "lead",
    },
  },
  {
    company: {
      name: "Twiga Foods",
      industry: "Agribusiness",
      location: "Nairobi, Kenya",
      website: "https://twiga.com",
    },
    contact: {
      firstName: "Akinyi",
      lastName: "Owino",
      jobTitle: "IT Manager",
      emailLocalPart: "akinyi.owino",
      phone: "+254712345603",
    },
    lead: {
      statusKey: "NEW",
      sourceKey: "LINKEDIN",
      temperature: "WARM",
      serviceKey: "AUTOMATION_SYSTEMS",
      owner: "sales",
      notes: "Connected on LinkedIn after a post about warehouse automation.",
    },
  },
  {
    company: {
      name: "Artcaffe Group",
      industry: "Hospitality",
      location: "Nairobi, Kenya",
      website: "https://artcaffe.co.ke",
    },
    contact: {
      firstName: "Njoroge",
      lastName: "Mwangi",
      jobTitle: "Finance Director",
      emailLocalPart: "njoroge.mwangi",
      phone: "+254712345604",
    },
    deal: {
      serviceKey: "ACCOUNTING",
      stageKey: "PROPOSAL_SENT",
      value: 320000,
      expectedCloseDate: "2026-11-15",
      owner: "sales2",
      notes: "Proposal sent for multi-branch accounting consolidation.",
    },
  },
  {
    company: {
      name: "Brookside Dairy",
      industry: "Manufacturing",
      location: "Ruiru, Kenya",
      website: "https://brookside.co.ke",
    },
    contact: {
      firstName: "Chebet",
      lastName: "Kiprono",
      jobTitle: "Supply Chain Manager",
      emailLocalPart: "chebet.kiprono",
      phone: "+254712345605",
    },
    deal: {
      serviceKey: "INVENTORY",
      stageKey: "SOLUTION_PRESENTED",
      value: 450000,
      expectedCloseDate: "2026-12-01",
      owner: "sales",
      notes: "Cold-chain inventory tracking across 3 depots.",
    },
    task: {
      title: "Send inventory system proposal to Brookside Dairy",
      priority: "HIGH",
      dueInDays: 1,
      assignee: "sales",
      linkTo: "deal",
    },
  },
  {
    company: {
      name: "Two Rivers Mall",
      industry: "Real Estate",
      location: "Nairobi, Kenya",
      website: "https://tworiversmall.co.ke",
    },
    contact: {
      firstName: "Wafula",
      lastName: "Simiyu",
      jobTitle: "Facilities Manager",
      emailLocalPart: "wafula.simiyu",
      phone: "+254712345606",
    },
    lead: {
      statusKey: "NEEDS_IDENTIFIED",
      sourceKey: "DIRECT_OUTREACH",
      temperature: "HOT",
      serviceKey: "CCTV",
      owner: "sales2",
      notes: "Mall-wide CCTV upgrade -- needs identified after a walkthrough.",
    },
  },
  {
    company: {
      name: "Sarova Hotels",
      industry: "Hospitality",
      location: "Nairobi, Kenya",
      website: "https://sarovahotels.com",
    },
    contact: {
      firstName: "Nyambura",
      lastName: "Githinji",
      jobTitle: "General Manager",
      emailLocalPart: "nyambura.githinji",
      phone: "+254712345607",
    },
    deal: {
      serviceKey: "CCTV",
      stageKey: "NEGOTIATION",
      value: 980000,
      expectedCloseDate: "2026-11-20",
      owner: "sales",
      notes: "Negotiating final pricing for a property-wide CCTV and access-control rollout.",
    },
    task: {
      title: "Schedule CCTV site visit at Sarova Hotels",
      priority: "MEDIUM",
      dueInDays: 3,
      assignee: "sales",
      linkTo: "deal",
    },
  },
  {
    company: {
      name: "Davis & Shirtliff",
      industry: "Engineering",
      location: "Nairobi, Kenya",
      website: "https://davisandshirtliff.com",
    },
    contact: {
      firstName: "Mutiso",
      lastName: "Kyalo",
      jobTitle: "Engineering Lead",
      emailLocalPart: "mutiso.kyalo",
      phone: "+254712345608",
    },
    deal: {
      serviceKey: "FLEET_GPS",
      stageKey: "SOLUTION_PRESENTED",
      value: 1250000,
      expectedCloseDate: "2026-10-30",
      owner: "sales2",
      notes: "Fleet GPS tracking for their service-vehicle fleet -- deal won.",
      closeAsWon: true,
    },
    task: {
      title: "Prepare signed contract for Davis & Shirtliff",
      priority: "HIGH",
      dueInDays: 1,
      assignee: "sales2",
      linkTo: "deal",
    },
  },
];

async function ensureSalesTwo(organizationId: string): Promise<string> {
  const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
  const passwordHash = await hashPassword(DEV_FIXTURE_PASSWORD);
  const user = await adminDb.user.upsert({
    where: { email: "dev.sales2@figbloom.local" },
    update: { passwordHash },
    create: {
      email: "dev.sales2@figbloom.local",
      name: "Dev Sales Two",
      passwordHash,
    },
  });
  await adminDb.membership.upsert({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    update: {},
    create: { organizationId, userId: user.id, roleId: role.id, joinedAt: new Date() },
  });
  return user.id;
}

async function main() {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { slug: "figbloom" } });

  const [managementUser, salesUser] = await Promise.all([
    adminDb.user.findUniqueOrThrow({ where: { email: "dev.management@figbloom.local" } }),
    adminDb.user.findUniqueOrThrow({ where: { email: "dev.sales@figbloom.local" } }),
  ]);
  const salesTwoUserId = await ensureSalesTwo(org.id);

  const [managementCtx, salesCtx, salesTwoCtx] = await Promise.all([
    resolveActiveMembership(managementUser.id, org.id),
    resolveActiveMembership(salesUser.id, org.id),
    resolveActiveMembership(salesTwoUserId, org.id),
  ]);
  if (!managementCtx || !salesCtx || !salesTwoCtx) {
    throw new Error("Expected dev.management, dev.sales, and dev.sales2 to all have active memberships.");
  }
  const owners: Record<"sales" | "sales2", ActiveMembership> = {
    sales: salesCtx,
    sales2: salesTwoCtx,
  };

  const [leadStatuses, leadSources, services, pipelineStages] = await Promise.all([
    adminDb.leadStatus.findMany({ where: { organizationId: org.id } }),
    adminDb.leadSource.findMany({ where: { organizationId: org.id } }),
    adminDb.service.findMany({ where: { organizationId: org.id } }),
    adminDb.pipelineStage.findMany({ where: { organizationId: org.id } }),
  ]);
  const statusId = (key: string) => leadStatuses.find((s) => s.key === key)?.id;
  const sourceId = (key: string) => leadSources.find((s) => s.key === key)?.id;
  const serviceId = (key: string) => services.find((s) => s.key === key)?.id;
  const stageId = (key: string) => pipelineStages.find((s) => s.key === key)?.id;
  const closedWonStageId = pipelineStages.find((s) => s.isWon)?.id;

  let created = 0;
  let skipped = 0;

  for (const bundle of COMPANIES) {
    const existing = await adminDb.company.findFirst({
      where: { organizationId: org.id, name: bundle.company.name },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const { company } = await createCompany(managementCtx, bundle.company);

    const emailDomain = bundle.company.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 20);
    const { contact } = await createContact(managementCtx, {
      firstName: bundle.contact.firstName,
      lastName: bundle.contact.lastName,
      jobTitle: bundle.contact.jobTitle,
      companyId: company.id,
      email: `${bundle.contact.emailLocalPart}@${emailDomain}.co.ke`,
      phone: bundle.contact.phone,
    });

    let leadId: string | undefined;
    if (bundle.lead) {
      const ownerCtx = owners[bundle.lead.owner];
      const { lead } = await createLead(ownerCtx, {
        leadStatusId: statusId(bundle.lead.statusKey)!,
        leadSourceId: sourceId(bundle.lead.sourceKey),
        companyId: company.id,
        contactId: contact.id,
        temperature: bundle.lead.temperature,
        serviceInterestId: serviceId(bundle.lead.serviceKey),
      });
      // CreateLeadInput has no `notes` field (it's update-only) -- set it
      // in a follow-up call so the New Lead form's Notes field has a
      // real-world counterpart here too.
      await updateLead(ownerCtx, lead.id, { notes: bundle.lead.notes });
      leadId = lead.id;
    }

    let dealId: string | undefined;
    if (bundle.deal) {
      const ownerCtx = owners[bundle.deal.owner];
      const deal = await createDeal(ownerCtx, {
        companyId: company.id,
        primaryContactId: contact.id,
        serviceId: serviceId(bundle.deal.serviceKey),
        pipelineStageId: stageId(bundle.deal.stageKey)!,
        value: bundle.deal.value,
        currency: "KES",
        expectedCloseDate: bundle.deal.expectedCloseDate,
        notes: bundle.deal.notes,
      });
      dealId = deal.id;
      if (bundle.deal.closeAsWon && closedWonStageId) {
        await updateDeal(ownerCtx, deal.id, { pipelineStageId: closedWonStageId });
      }
    }

    if (bundle.task) {
      const assigneeCtx = owners[bundle.task.assignee];
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + bundle.task.dueInDays);
      await createTask(assigneeCtx, {
        title: bundle.task.title,
        priority: bundle.task.priority,
        dueAt: dueAt.toISOString(),
        assigneeMembershipId: assigneeCtx.membershipId,
        ...(bundle.task.linkTo === "lead" ? { leadId } : { dealId }),
      });
    }

    created++;
    console.log(`Created: ${bundle.company.name}`);
  }

  console.log(`\nDone. ${created} companies created, ${skipped} already existed (skipped).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
