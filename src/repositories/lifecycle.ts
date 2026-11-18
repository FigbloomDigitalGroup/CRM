import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for the customer lifecycle engine (FIG-1048, B3.02). Every call runs inside the organisation's RLS context. */

export function listLifecycleStates(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.customerLifecycleState.findMany({ where: { organizationId }, orderBy: { sequence: "asc" } }),
  );
}

export interface CompanyLifecycleRow {
  id: string;
  name: string;
  lifecycleStateId: string | null;
  lifecycleChangedAt: Date | null;
  lifecycleManual: boolean;
  ownerMembershipId: string | null;
}

export function getCompanyLifecycle(organizationId: string, companyId: string): Promise<CompanyLifecycleRow | null> {
  return withOrgContext(organizationId, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, organizationId },
      select: { id: true, name: true, lifecycleStateId: true, lifecycleChangedAt: true, lifecycleManual: true, ownerMembershipId: true },
    }),
  );
}

/**
 * Moves a company from `fromStateId` to `toStateId` only if it is still in `fromStateId` (compare and set), and writes
 * the history row in the same transaction. Returns the event, or null when someone else moved it first.
 */
export function applyTransition(input: {
  organizationId: string;
  companyId: string;
  fromStateId: string | null;
  toStateId: string;
  reason: string;
  note?: string | null;
  actorMembershipId?: string | null;
  detail?: Prisma.InputJsonValue;
  manual: boolean;
  now: Date;
}) {
  return withOrgContext(input.organizationId, async (tx) => {
    const moved = await tx.company.updateMany({
      where: { id: input.companyId, organizationId: input.organizationId, lifecycleStateId: input.fromStateId },
      data: { lifecycleStateId: input.toStateId, lifecycleChangedAt: input.now, lifecycleManual: input.manual },
    });
    if (moved.count === 0) return null;
    return tx.lifecycleEvent.create({
      data: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        fromStateId: input.fromStateId,
        toStateId: input.toStateId,
        reason: input.reason,
        note: input.note ?? null,
        actorMembershipId: input.actorMembershipId ?? null,
        detail: input.detail,
        createdAt: input.now,
      },
    });
  });
}

export function setLifecycleManual(organizationId: string, companyId: string, manual: boolean) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.updateMany({ where: { id: companyId, organizationId }, data: { lifecycleManual: manual } }),
  );
}

export function listEventsForCompany(organizationId: string, companyId: string, take: number, before?: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.lifecycleEvent.findMany({
      where: { organizationId, companyId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
  );
}

export interface SweepRow {
  id: string;
  lifecycleStateId: string;
  ownerMembershipId: string | null;
  createdAt: Date;
  lastActivity: Date | null;
}

/**
 * The last time anything happened for the company aliased `c`: an activity or a message (on the company or on one of
 * its contacts), a deal moving, or a service being renewed. Shared by the daily job and the retention lists.
 */
export const LAST_ACTIVITY_SQL = Prisma.sql`GREATEST(
  (SELECT max(a.occurred_at) FROM activities a WHERE a.organization_id = c.organization_id AND a.company_id = c.id),
  (SELECT max(a.occurred_at) FROM activities a JOIN contacts ct ON ct.organization_id = a.organization_id AND ct.id = a.contact_id
     WHERE a.organization_id = c.organization_id AND ct.company_id = c.id),
  (SELECT max(m.occurred_at) FROM communications m WHERE m.organization_id = c.organization_id AND m.company_id = c.id AND NOT m.needs_linking),
  (SELECT max(m.occurred_at) FROM communications m JOIN contacts ct ON ct.organization_id = m.organization_id AND ct.id = m.contact_id
     WHERE m.organization_id = c.organization_id AND ct.company_id = c.id AND NOT m.needs_linking),
  (SELECT max(d.last_activity_at) FROM deals d WHERE d.organization_id = c.organization_id AND d.company_id = c.id),
  (SELECT max(r.last_renewed_at) FROM recurring_services r WHERE r.organization_id = c.organization_id AND r.company_id = c.id)
)`;

/**
 * The companies the daily job looks at, each with the last time anything happened. A company a person set by hand is
 * left alone.
 */
export function companiesForSweep(organizationId: string, stateIds: string[]): Promise<SweepRow[]> {
  if (stateIds.length === 0) return Promise.resolve([]);
  return withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<SweepRow[]>`
      SELECT c.id,
             c.lifecycle_state_id AS "lifecycleStateId",
             c.owner_membership_id AS "ownerMembershipId",
             c.created_at AS "createdAt",
             ${LAST_ACTIVITY_SQL} AS "lastActivity"
      FROM companies c
      WHERE c.organization_id = ${organizationId}
        AND c.archived_at IS NULL
        AND NOT c.lifecycle_manual
        AND c.lifecycle_state_id IN (${Prisma.join(stateIds)})`,
  );
}

/** Recurring services that are not cancelled, for a set of companies. */
export function liveRecurringForCompanies(organizationId: string, companyIds: string[]) {
  if (companyIds.length === 0) return Promise.resolve([]);
  return withOrgContext(organizationId, (tx) =>
    tx.recurringService.findMany({
      where: { organizationId, companyId: { in: companyIds }, cancelledAt: null },
      select: { companyId: true, startsOn: true, renewsOn: true, cancelledAt: true, stateOverride: true },
    }),
  );
}
