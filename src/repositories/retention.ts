import { withOrgContext } from "../db/orgScopedClient";
import { LAST_ACTIVITY_SQL } from "./lifecycle";

/** Data access for the renewals and retention lists (FIG-1052, B3.06). Every call runs inside the organisation's RLS context. */

export interface CustomerRow {
  id: string;
  name: string;
  ownerMembershipId: string | null;
  industry: string | null;
  lifecycleKey: string | null;
  createdAt: Date;
  lastActivity: Date | null;
}

/**
 * Every customer: a company in a customer lifecycle state, or with a won deal or a running recurring service. Each comes
 * with the last time anything happened.
 */
export function listCustomers(organizationId: string): Promise<CustomerRow[]> {
  return withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<CustomerRow[]>`
      SELECT c.id, c.name, c.owner_membership_id AS "ownerMembershipId", c.industry, s.key AS "lifecycleKey", c.created_at AS "createdAt",
             ${LAST_ACTIVITY_SQL} AS "lastActivity"
      FROM companies c
      LEFT JOIN customer_lifecycle_states s ON s.organization_id = c.organization_id AND s.id = c.lifecycle_state_id
      WHERE c.organization_id = ${organizationId}
        AND c.archived_at IS NULL
        AND c.merged_into_id IS NULL
        AND (
          s.key IN ('CUSTOMER', 'ONBOARDING', 'ACTIVE_CUSTOMER', 'DORMANT_CUSTOMER', 'RENEWAL')
          OR EXISTS (SELECT 1 FROM deals d WHERE d.organization_id = c.organization_id AND d.company_id = c.id AND d.outcome = 'WON' AND d.archived_at IS NULL)
          OR EXISTS (SELECT 1 FROM recurring_services r WHERE r.organization_id = c.organization_id AND r.company_id = c.id AND r.cancelled_at IS NULL)
        )`,
  );
}

export function listLiveRecurring(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.recurringService.findMany({
      where: { organizationId, cancelledAt: null, company: { archivedAt: null } },
      select: {
        id: true,
        companyId: true,
        serviceId: true,
        startsOn: true,
        renewsOn: true,
        cancelledAt: true,
        stateOverride: true,
        value: true,
        currency: true,
        ownerMembershipId: true,
        service: { select: { name: true } },
      },
    }),
  );
}

/** Proposals sent and not answered, on open deals. */
export function listSentProposals(organizationId: string, olderThan: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.proposalReference.findMany({
      where: { organizationId, status: "SENT", updatedAt: { lt: olderThan }, deal: { outcome: "OPEN", archivedAt: null, company: { archivedAt: null } } },
      select: {
        id: true,
        proposalNumber: true,
        sentAt: true,
        updatedAt: true,
        ownerMembershipId: true,
        dealId: true,
        deal: { select: { companyId: true, ownerMembershipId: true } },
      },
    }),
  );
}

export interface HoldingRow {
  companyId: string;
  serviceId: string;
}

/** Which service each company has: a running company service, a recurring service or a won deal. */
export function listHoldings(organizationId: string): Promise<HoldingRow[]> {
  return withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<HoldingRow[]>`
      SELECT DISTINCT company_id AS "companyId", service_id AS "serviceId" FROM (
        SELECT company_id, service_id FROM company_services WHERE organization_id = ${organizationId} AND status = 'ACTIVE'
        UNION ALL
        SELECT company_id, service_id FROM recurring_services WHERE organization_id = ${organizationId} AND cancelled_at IS NULL
        UNION ALL
        SELECT company_id, service_id FROM deals WHERE organization_id = ${organizationId} AND outcome = 'WON' AND service_id IS NOT NULL
      ) h`,
  );
}

export function listServiceNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.service.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true } }),
  );
}
