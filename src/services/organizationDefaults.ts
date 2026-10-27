import { adminDb } from "../db/adminClient";
import { GENERAL_QUESTIONS, SERVICE_QUESTIONS, type QualificationQuestion } from "../lib/qualificationDefaults";
import { WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY } from "../repositories/leadIngestion";

/**
 * Default controlled-value catalog applied to every new organization.
 * These are organization-configurable business data (FIG-436), so each
 * org gets its own editable copy rather than sharing one global row --
 * this seed just establishes sensible V1 starting values.
 *
 * Sources: lead sources and services (FIG-297); lead statuses (FIG-299,
 * kept separate from temperature -- a fixed native enum -- and from deal
 * pipeline stage); pipeline stages (FIG-299, split at the lead/deal
 * boundary: a lead converts once qualified, deal stages pick up from
 * "Solution Presented" onward -- see IMPLEMENTATION_NOTES.md); customer
 * lifecycle states and lost reasons (FIG-297/FIG-299).
 */

const LEAD_SOURCES = [
  "WEBSITE",
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "FACEBOOK",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "REFERRAL",
  "EXISTING_CUSTOMER",
  "DIRECT_OUTREACH",
  "PHYSICAL_MEETING",
  "NETWORKING",
  "ADVERTISING",
  "OTHER",
].map((key, i) => ({ key, name: toTitle(key), sequence: i + 1 }));

const LEAD_STATUSES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "NEEDS_IDENTIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "LOST",
  "INACTIVE",
].map((key, i) => ({ key, name: toTitle(key), sequence: i + 1 }));

const PIPELINE_STAGES = [
  { key: "SOLUTION_PRESENTED", name: "Solution Presented", sequence: 1 },
  { key: "PROPOSAL_SENT", name: "Proposal Sent", sequence: 2 },
  { key: "NEGOTIATION", name: "Negotiation", sequence: 3 },
  { key: "CLOSED_WON", name: "Closed Won", sequence: 4, isWon: true },
  { key: "CLOSED_LOST", name: "Closed Lost", sequence: 5, isLost: true },
];

const CUSTOMER_LIFECYCLE_STATES = [
  "PROSPECT",
  "CUSTOMER",
  "ONBOARDING",
  "ACTIVE_CUSTOMER",
  "DORMANT_CUSTOMER",
  "RENEWAL",
].map((key, i) => ({ key, name: toTitle(key), sequence: i + 1 }));

const LOST_REASONS = [
  "NOT_INTERESTED",
  "NOT_QUALIFIED",
  "NO_BUDGET",
  "COMPETITOR",
  "NO_NEED",
  "WRONG_CONTACT",
  "NO_RESPONSE",
  "TIMING",
  "LOCATION",
  "DUPLICATE",
  "OTHER",
].map((key, i) => ({ key, name: toTitle(key), sequence: i + 1 }));

const SERVICES: { key: string; name: string; category: string; sequence: number }[] = [
  { key: "ACCOUNTING", name: "Accounting", category: "Software" },
  { key: "HR", name: "HR", category: "Software" },
  { key: "CRM", name: "CRM", category: "Software" },
  { key: "INVENTORY", name: "Inventory", category: "Software" },
  {
    key: "PROPERTY_MANAGEMENT",
    name: "Property Management",
    category: "Software",
  },
  { key: "FLEET_GPS", name: "Fleet / GPS", category: "Automation" },
  { key: "CCTV", name: "CCTV", category: "Installation" },
  {
    key: "STARLINK_INTERNET",
    name: "Starlink / Internet",
    category: "Connectivity",
  },
  { key: "ISP_BILLING", name: "ISP Billing", category: "Software" },
  { key: "WEB_DEVELOPMENT", name: "Web Development", category: "Digital" },
  { key: "BRANDING", name: "Branding", category: "Digital" },
  {
    key: "SOCIAL_MEDIA_MANAGEMENT",
    name: "Social Media Management",
    category: "Digital",
  },
  {
    key: "AUTOMATION_SYSTEMS",
    name: "Automation Systems",
    category: "Automation",
  },
  { key: "CONSULTING_OTHER", name: "Consulting / Other", category: "Services" },
].map((s, i) => ({ ...s, sequence: i + 1 }));

function toTitle(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Idempotent: safe to call repeatedly -- every row is an upsert keyed on
 * (organizationId, key).
 *
 * By default an existing row is brought back to the catalogue (its name and
 * order), which is right when an organization is provisioned. For an
 * organization that already exists and may have renamed or reordered its own
 * statuses, stages and sources, pass `fillOnly`: rows that are missing are
 * created and nothing that is already there is changed (the upgrade backfill,
 * scripts/backfill-organization-defaults.ts).
 */
export async function seedOrganizationDefaults(
  organizationId: string,
  options: { fillOnly?: boolean } = {},
): Promise<void> {
  const fillOnly = options.fillOnly === true;
  await Promise.all(
    LEAD_SOURCES.map((s) =>
      adminDb.leadSource.upsert({
        where: { organizationId_key: { organizationId, key: s.key } },
        update: fillOnly ? {} : { name: s.name, sequence: s.sequence },
        create: { organizationId, ...s },
      }),
    ),
  );

  await Promise.all(
    LEAD_STATUSES.map((s) =>
      adminDb.leadStatus.upsert({
        where: { organizationId_key: { organizationId, key: s.key } },
        update: fillOnly ? {} : { name: s.name, sequence: s.sequence },
        create: { organizationId, ...s },
      }),
    ),
  );

  await Promise.all(
    PIPELINE_STAGES.map((s) =>
      adminDb.pipelineStage.upsert({
        where: { organizationId_key: { organizationId, key: s.key } },
        update: fillOnly
          ? {}
          : {
              name: s.name,
              sequence: s.sequence,
              isWon: s.isWon ?? false,
              isLost: s.isLost ?? false,
            },
        create: {
          organizationId,
          key: s.key,
          name: s.name,
          sequence: s.sequence,
          isWon: s.isWon ?? false,
          isLost: s.isLost ?? false,
        },
      }),
    ),
  );

  await Promise.all(
    CUSTOMER_LIFECYCLE_STATES.map((s) =>
      adminDb.customerLifecycleState.upsert({
        where: { organizationId_key: { organizationId, key: s.key } },
        update: fillOnly ? {} : { name: s.name, sequence: s.sequence },
        create: { organizationId, ...s },
      }),
    ),
  );

  await Promise.all(
    LOST_REASONS.map((s) =>
      adminDb.lostReason.upsert({
        where: { organizationId_key: { organizationId, key: s.key } },
        update: fillOnly ? {} : { name: s.name, sequence: s.sequence },
        create: { organizationId, ...s },
      }),
    ),
  );

  await Promise.all(
    SERVICES.map((s) =>
      adminDb.service.upsert({
        where: { organizationId_key: { organizationId, key: s.key } },
        update: fillOnly ? {} : { name: s.name, category: s.category, sequence: s.sequence },
        create: { organizationId, ...s },
      }),
    ),
  );

  await adminDb.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId,
        key: WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY,
      },
    },
    update: {},
    create: {
      organizationId,
      key: WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY,
      value: { lastMembershipId: null },
    },
  });

  await seedQualificationQuestions(organizationId);
}

/**
 * Starting qualification questions (FIG-1030, B2.01). Create-only: a question
 * Management has edited, hidden or made required is never put back.
 */
async function seedQualificationQuestions(organizationId: string): Promise<void> {
  const services = await adminDb.service.findMany({ where: { organizationId }, select: { id: true, key: true } });
  const serviceIdByKey = new Map(services.map((s) => [s.key, s.id]));

  const rows: { question: QualificationQuestion; serviceId: string | null; sortOrder: number }[] = [];
  GENERAL_QUESTIONS.forEach((question, i) => rows.push({ question, serviceId: null, sortOrder: 10 + i }));
  for (const [serviceKey, questions] of Object.entries(SERVICE_QUESTIONS)) {
    const serviceId = serviceIdByKey.get(serviceKey);
    if (!serviceId) continue;
    questions.forEach((question, i) => rows.push({ question, serviceId, sortOrder: 100 + i }));
  }

  await Promise.all(
    rows.map(({ question, serviceId, sortOrder }) =>
      adminDb.customFieldDefinition.upsert({
        where: { organizationId_entityType_key: { organizationId, entityType: "LEAD", key: question.key } },
        update: {},
        create: {
          organizationId,
          entityType: "LEAD",
          section: "QUALIFICATION",
          key: question.key,
          label: question.label,
          fieldType: question.fieldType,
          options: question.options,
          helpText: question.helpText,
          requiredOnQualify: question.requiredOnQualify ?? false,
          serviceId,
          sortOrder,
        },
      }),
    ),
  );
}
