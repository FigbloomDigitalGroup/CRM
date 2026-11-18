import type { Prisma, SignInOutcome } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import type { ClientInfo } from "../auth/deviceInfo";
import { describeDevice } from "../auth/deviceInfo";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { buildPage, resolvePaging, type Page, type PageRequest } from "../lib/pagination";

/**
 * Sign-in events (B1.04): success, failure, lockout, new device -- with the
 * device and place. Who sees them:
 *
 *   - the person themselves (their own sign-ins, `listMySignInEvents`)
 *   - the organisation's Management users (`security.manage`) for the people
 *     in that organisation, tenant-scoped by row-level security.
 *
 * Nobody else. Each event is written once for every organisation the person
 * belongs to (active or deactivated), all sharing one timestamp, so each
 * tenant only ever holds -- and can only ever read -- its own copy.
 */
const VIEW = "security.manage";

export interface RecordSignInEventInput {
  userId?: string | null;
  email: string;
  outcome: SignInOutcome;
  reason?: string | null;
  sessionId?: string | null;
  client?: Partial<ClientInfo>;
  deviceLabel?: string | null;
  /** Restrict to one organisation (accepting an invite signs in under that organisation only). */
  organizationId?: string | null;
}

export async function recordSignInEvent(input: RecordSignInEventInput): Promise<void> {
  const createdAt = new Date();
  const client = input.client ?? {};
  const base = {
    userId: input.userId ?? null,
    email: input.email.trim().toLowerCase(),
    outcome: input.outcome,
    reason: input.reason ?? null,
    sessionId: input.sessionId ?? null,
    deviceLabel: input.deviceLabel ?? describeDevice(client.userAgent),
    userAgent: client.userAgent ?? null,
    ipAddress: client.ipAddress ?? null,
    place: client.place ?? null,
    createdAt,
  };

  let organizationIds: string[];
  if (input.organizationId) {
    organizationIds = [input.organizationId];
  } else if (input.userId) {
    const memberships = await adminDb.membership.findMany({
      where: { userId: input.userId, status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { organizationId: true },
    });
    organizationIds = memberships.map((m) => m.organizationId);
  } else {
    organizationIds = [];
  }

  if (organizationIds.length === 0) {
    await adminDb.signInEvent.create({ data: { ...base, organizationId: null } });
    return;
  }
  await adminDb.signInEvent.createMany({
    data: organizationIds.map((organizationId) => ({ ...base, organizationId })),
  });
}

export interface SignInEventDto {
  id: string;
  userId: string | null;
  membershipId: string | null;
  userName: string | null;
  email: string;
  outcome: SignInOutcome;
  reason: string | null;
  deviceLabel: string | null;
  ipAddress: string | null;
  place: string | null;
  createdAt: string;
}

export interface SignInEventFilters {
  /** A member of this organisation (membership id). */
  membershipId?: string;
  outcome?: SignInOutcome;
  /** Inclusive lower bound, ISO date or timestamp. */
  from?: string;
  /** Exclusive upper bound, ISO date or timestamp. */
  to?: string;
}

function parseBound(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${field} must be a date.`, [
      { path: field, message: "Use an ISO date such as 2026-10-23." },
    ]);
  }
  return date;
}

/** The organisation's sign-in events, newest first, for Management (S8). */
export async function listSignInEvents(
  ctx: AuthContext,
  filters: SignInEventFilters = {},
  request: PageRequest = {},
): Promise<Page<SignInEventDto>> {
  requirePermission(ctx, VIEW);

  let userId: string | undefined;
  if (filters.membershipId) {
    const membership = await adminDb.membership.findFirst({
      where: { id: filters.membershipId, organizationId: ctx.organizationId },
      select: { userId: true },
    });
    if (!membership) throw new NotFoundError("Membership", filters.membershipId);
    userId = membership.userId;
  }
  const from = parseBound(filters.from, "from");
  const to = parseBound(filters.to, "to");

  const where: Prisma.SignInEventWhereInput = {
    organizationId: ctx.organizationId,
    ...(userId ? { userId } : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
  const paging = resolvePaging(request);

  const [rows, total] = await withOrgContext(ctx.organizationId, async (tx) =>
    Promise.all([
      tx.signInEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: paging.skip,
        take: paging.take,
      }),
      tx.signInEvent.count({ where }),
    ]),
  );

  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const members = userIds.length
    ? await adminDb.membership.findMany({
        where: { organizationId: ctx.organizationId, userId: { in: userIds } },
        select: { id: true, userId: true, user: { select: { name: true } } },
      })
    : [];
  const byUser = new Map(members.map((m) => [m.userId, m]));

  const items = rows.map<SignInEventDto>((r) => {
    const member = r.userId ? byUser.get(r.userId) : undefined;
    return {
      id: r.id,
      userId: r.userId,
      membershipId: member?.id ?? null,
      userName: member?.user.name ?? null,
      email: r.email,
      outcome: r.outcome,
      reason: r.reason,
      deviceLabel: r.deviceLabel,
      ipAddress: r.ipAddress,
      place: r.place,
      createdAt: r.createdAt.toISOString(),
    };
  });
  return buildPage(items, total, paging);
}

/** The person's own recent sign-ins, newest first (one row per attempt, not one per organisation). */
export async function listMySignInEvents(
  userId: string,
  limit = 50,
): Promise<SignInEventDto[]> {
  const rows = await adminDb.signInEvent.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(1, limit), 100) * 3,
  });
  const seen = new Set<string>();
  const items: SignInEventDto[] = [];
  for (const r of rows) {
    const key = `${r.createdAt.getTime()}|${r.outcome}|${r.deviceLabel}|${r.ipAddress}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: r.id,
      userId: r.userId,
      membershipId: null,
      userName: null,
      email: r.email,
      outcome: r.outcome,
      reason: r.reason,
      deviceLabel: r.deviceLabel,
      ipAddress: r.ipAddress,
      place: r.place,
      createdAt: r.createdAt.toISOString(),
    });
    if (items.length >= limit) break;
  }
  return items;
}
