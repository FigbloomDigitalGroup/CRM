import type { Prisma } from "@prisma/client";
import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";

/**
 * Storage key for the round-robin assignment cursor in
 * `OrganizationSetting`. Pre-seeded by `organizationDefaults.ts` (which
 * imports this constant back from here) so a row always exists to
 * `SELECT ... FOR UPDATE` against in `pickNextAssignmentOwner` below.
 */
export const WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY =
  "website_lead_assignment_cursor";

export interface WebsiteLeadInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  service?: string;
  message?: string;
  utm?: Record<string, string>;
}

export interface WebsiteLeadResult {
  leadId: string;
  companyId: string | null;
  contactId: string | null;
  ownerMembershipId: string | null;
  companyMatched: boolean;
  contactMatched: boolean;
}

function splitName(name: string): { firstName: string; lastName?: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed };
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1),
  };
}

/**
 * Round-robin owner assignment across active reps. Assignment rules are
 * meant to be org-configurable eventually (FIG-436), but no rules engine
 * exists yet, so this fixed round-robin is the V1 stand-in (see
 * IMPLEMENTATION_NOTES.md's FIG-442 notes).
 *
 * Pool = active memberships whose role has `leads.edit.own`, not a
 * hard-coded "SALES" role, so it tracks the permission matrix.
 *
 * Must run in the same transaction as the Lead create it's feeding:
 * `SELECT ... FOR UPDATE` locks the cursor row for the transaction's
 * duration, so two concurrent submissions can't grab the same rep.
 */
async function pickNextAssignmentOwner(
  tx: OrgScopedClient,
  organizationId: string,
): Promise<string | null> {
  await tx.$queryRaw`
    SELECT id FROM organization_settings
    WHERE organization_id = ${organizationId}
      AND key = ${WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY}
    FOR UPDATE
  `;

  const pool = await tx.membership.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      role: {
        rolePermissions: {
          some: { permission: { key: "leads.edit.own" } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (pool.length === 0) return null;

  const cursor = await tx.organizationSetting.findUnique({
    where: {
      organizationId_key: {
        organizationId,
        key: WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY,
      },
    },
  });
  const lastMembershipId = (cursor?.value as { lastMembershipId?: string } | null)
    ?.lastMembershipId;

  const lastIndex = pool.findIndex((m) => m.id === lastMembershipId);
  const next = pool[(lastIndex + 1) % pool.length]!;

  await tx.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId,
        key: WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY,
      },
    },
    update: { value: { lastMembershipId: next.id } },
    create: {
      organizationId,
      key: WEBSITE_LEAD_ASSIGNMENT_CURSOR_KEY,
      value: { lastMembershipId: next.id },
    },
  });

  return next.id;
}

/**
 * Turns a website form submission into a CRM lead (FIG-442): resolve-or-
 * create the Company/Contact, stamp source + initial status, resolve a
 * service interest, round-robin assign an owner, and create a follow-up
 * Task as the acknowledgement (there's no outbound email/SMS
 * infrastructure yet).
 *
 * Runs in one transaction so a failure partway through (e.g. no configured
 * lead status) leaves nothing half-created.
 */
export async function ingestWebsiteLead(
  organizationId: string,
  input: WebsiteLeadInput,
): Promise<WebsiteLeadResult> {
  return withOrgContext(organizationId, async (tx) => {
    let companyId: string | null = null;
    let companyMatched = false;
    if (input.company) {
      const existing = await tx.company.findFirst({
        where: {
          organizationId,
          name: { equals: input.company, mode: "insensitive" },
        },
      });
      if (existing) {
        companyId = existing.id;
        companyMatched = true;
      } else {
        const created = await tx.company.create({
          data: { organizationId, name: input.company },
        });
        companyId = created.id;
      }
    }

    const { firstName, lastName } = splitName(input.name);
    let contactId: string | null = null;
    let contactMatched = false;
    const contactLookupClauses: Prisma.ContactWhereInput[] = [];
    if (input.email)
      contactLookupClauses.push({
        email: { equals: input.email, mode: "insensitive" },
      });
    if (input.phone) contactLookupClauses.push({ phone: input.phone });

    const existingContact =
      contactLookupClauses.length > 0
        ? await tx.contact.findFirst({
            where: { organizationId, OR: contactLookupClauses },
          })
        : null;

    if (existingContact) {
      contactId = existingContact.id;
      contactMatched = true;
      if (!existingContact.companyId && companyId) {
        await tx.contact.update({
          where: { id: existingContact.id },
          data: { companyId },
        });
      }
    } else {
      const created = await tx.contact.create({
        data: {
          organizationId,
          firstName,
          lastName,
          email: input.email,
          phone: input.phone,
          companyId,
        },
      });
      contactId = created.id;
    }

    const leadSource = await tx.leadSource.findFirst({
      where: { organizationId, key: "WEBSITE" },
    });

    const leadStatus = await tx.leadStatus.findFirst({
      where: { organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    });
    if (!leadStatus) {
      throw new Error(
        `No configured lead status found for organization ${organizationId}.`,
      );
    }

    let serviceInterestId: string | undefined;
    if (input.service) {
      const service = await tx.service.findFirst({
        where: {
          organizationId,
          isActive: true,
          OR: [
            { key: input.service.trim().toUpperCase().replace(/[\s/-]+/g, "_") },
            { name: { equals: input.service, mode: "insensitive" } },
          ],
        },
      });
      serviceInterestId = service?.id;
    }

    const ownerMembershipId = await pickNextAssignmentOwner(tx, organizationId);

    const lead = await tx.lead.create({
      data: {
        organizationId,
        companyId,
        contactId,
        leadSourceId: leadSource?.id,
        leadStatusId: leadStatus.id,
        serviceInterestId,
        ownerMembershipId,
        notes: input.message,
        qualificationData: {
          source: "website_form",
          utm: input.utm ?? {},
          ...(input.service && !serviceInterestId
            ? { unmatchedService: input.service }
            : {}),
        } satisfies Prisma.InputJsonValue,
      },
    });

    if (ownerMembershipId) {
      await tx.task.create({
        data: {
          organizationId,
          title: "Follow up on new website lead",
          description: `Acknowledge and qualify the new website lead from ${input.name}.`,
          assigneeMembershipId: ownerMembershipId,
          createdByMembershipId: ownerMembershipId,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          priority: "HIGH",
          leadId: lead.id,
        },
      });
    }

    return {
      leadId: lead.id,
      companyId,
      contactId,
      ownerMembershipId,
      companyMatched,
      contactMatched,
    };
  });
}
