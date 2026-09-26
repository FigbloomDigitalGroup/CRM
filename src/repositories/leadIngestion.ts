import type { Prisma } from "@prisma/client";
import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";

/**
 * Key under which the website lead-capture round-robin assignment cursor is
 * stored in `OrganizationSetting`. Pre-seeded by
 * `src/services/organizationDefaults.ts` (which imports this constant back
 * from here, keeping the repository layer the source of truth for its own
 * storage key) so a row always exists to `SELECT ... FOR UPDATE` against —
 * see `pickNextAssignmentOwner` below.
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
 * Round-robin owner assignment across the organization's active reps
 * (FIG-436 section 8 lists "assignment rules" as org-configurable data, but
 * no ticket has built a rules-configuration UI/engine -- see
 * IMPLEMENTATION_NOTES.md's "FIG-442: lead-assignment rule" note for why
 * this fixed round-robin policy, rather than a configurable one, is the
 * deliberately smallest reasonable V1 behavior).
 *
 * The pool is "active memberships whose role can own a lead"
 * (`leads.edit.own`), not a hard-coded "SALES" role key, so it adapts if the
 * permission matrix changes later without a code change.
 *
 * Must run inside the same transaction as the Lead create it's feeding —
 * `SELECT ... FOR UPDATE` locks the cursor row for the duration of the
 * transaction, so two concurrent website submissions can't both read the
 * same cursor and assign the same rep twice in a row.
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
 * The full "receive a website form submission as a CRM lead" pipeline
 * (FIG-436 section 4.10 / FIG-442): resolve-or-create the Company/Contact,
 * auto-stamp source + an initial status, best-effort resolve a service
 * interest, round-robin assign an owner, and fire the "acknowledgement"
 * follow-up task (see IMPLEMENTATION_NOTES.md's FIG-442 notes for why an
 * internal Task is the acknowledgement mechanism, not an outbound
 * email/SMS system this codebase has no infrastructure for).
 *
 * Everything happens inside one `withOrgContext` transaction so a failure
 * partway through (e.g. no configured lead status) leaves nothing
 * half-created — a website submission either becomes a fully-formed lead or
 * nothing at all.
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
