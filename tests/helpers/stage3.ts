import { adminDb } from "../../src/db/adminClient";
import type { AuthContext } from "../../src/auth/context";
import { getPipelineStageId } from "./fixtures";

/** Stage 3 fixtures: companies, won deals, recurring services, with the rows written directly so a test controls every date. */

export async function createCompanyRow(
  organizationId: string,
  data: { name?: string; ownerMembershipId?: string | null; lifecycleKey?: string; industry?: string; email?: string; phone?: string; createdAt?: Date } = {},
) {
  const state = data.lifecycleKey
    ? await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId, key: data.lifecycleKey } })
    : null;
  return adminDb.company.create({
    data: {
      organizationId,
      name: data.name ?? `Company ${Math.random().toString(36).slice(2, 8)}`,
      ownerMembershipId: data.ownerMembershipId ?? null,
      lifecycleStateId: state?.id ?? null,
      industry: data.industry,
      email: data.email,
      phone: data.phone,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });
}

export async function createWonDeal(
  organizationId: string,
  owner: Pick<AuthContext, "membershipId">,
  opts: { companyId?: string; value?: number; serviceKey?: string; wonAt?: Date } = {},
) {
  const companyId = opts.companyId ?? (await createCompanyRow(organizationId, { ownerMembershipId: owner.membershipId })).id;
  const service = opts.serviceKey ? await adminDb.service.findFirstOrThrow({ where: { organizationId, key: opts.serviceKey } }) : null;
  const wonAt = opts.wonAt ?? new Date();
  return adminDb.deal.create({
    data: {
      organizationId,
      companyId,
      ownerMembershipId: owner.membershipId,
      pipelineStageId: await getPipelineStageId(organizationId, "CLOSED_WON"),
      outcome: "WON",
      wonAt,
      value: opts.value ?? null,
      serviceId: service?.id,
      lastActivityAt: wonAt,
    },
  });
}

export async function createOpenDeal(organizationId: string, owner: Pick<AuthContext, "membershipId">, opts: { companyId?: string } = {}) {
  const companyId = opts.companyId ?? (await createCompanyRow(organizationId, { ownerMembershipId: owner.membershipId })).id;
  return adminDb.deal.create({
    data: {
      organizationId,
      companyId,
      ownerMembershipId: owner.membershipId,
      pipelineStageId: await getPipelineStageId(organizationId, "SOLUTION_PRESENTED"),
    },
  });
}

/** `2026-11-30` style date at midnight UTC. */
export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const daysFrom = (base: Date, n: number) => new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
