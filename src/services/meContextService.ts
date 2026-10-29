import type { Session } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { NotFoundError } from "../auth/errors";
import { summariseSession } from "../auth/session";
import { getSessionLifetimeHours } from "../auth/sessionPolicy";
import { resolveActiveMembership } from "../repositories/memberships";
import { getAccessState } from "./accessStateService";
import { getFeatureSnapshot } from "./featureService";
import { getMyUnreadNotificationCount } from "./notificationService";
import { readOrganizationLook } from "./organizationLookService";
import { getMyPreferences } from "./preferenceService";
import { getMyProfile } from "./profileService";
import { cachedMeContext } from "./meContextCache";
import { getPlatformPreferences } from "./platformPreferenceService";

/**
 * `/api/me/context` (FIG-1026, B1.10): the one call the shell makes to draw
 * itself. Identical in shape for every role; sections that do not apply are
 * `null`. See `src/api/dto/meContext.ts` for the contract.
 */

/** Roles the design still shows as proposed, wherever the person sees their own role. */
const ROLE_NAME_SUFFIX: Record<string, string> = { CUSTOMER_SUPPORT: " (proposed)" };

export const WORKSPACE_LABELS: Record<string, string> = {
  MANAGEMENT: "Management dashboard",
  SALES: "Sales workspace",
  DELIVERY: "Delivery workspace",
  FINANCE: "Finance workspace",
  RESTRICTED_TECHNICAL: "Technical workspace",
  CUSTOMER_SUPPORT: "Support workspace (proposed)",
};

function formatLocal(date: Date, timeZone: string | null, hourFormat: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: hourFormat !== "H24",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timeZone ?? "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  }
}

export interface MeContextRequest {
  userId: string;
  session: Session | null;
  /** Optional: open a specific organisation the person belongs to (the V1.1 switcher). */
  orgSlug?: string | null;
}

/** The organisation to describe: the requested one, else the session's, else the oldest active membership. */
async function chooseOrganization(
  organizations: { id: string; slug: string }[],
  session: Session | null,
  orgSlug?: string | null,
): Promise<string | null> {
  if (organizations.length === 0) return null;
  if (orgSlug) {
    const wanted = organizations.find((o) => o.slug === orgSlug);
    if (!wanted) throw new NotFoundError("Organization", orgSlug);
    return wanted.id;
  }
  const fromSession = organizations.find((o) => o.id === session?.organizationId);
  return (fromSession ?? organizations[0]!).id;
}

export async function getMemberContext(req: MeContextRequest) {
  const user = await adminDb.user.findUniqueOrThrow({ where: { id: req.userId } });
  const access = await getAccessState(req.userId);
  const organizationId = await chooseOrganization(access.organizations, req.session, req.orgSlug);
  const ctx = organizationId ? await resolveActiveMembership(req.userId, organizationId) : null;

  // The slow-changing half is cached; the clock, the session and the unread count are always live.
  const stable = await cachedMeContext({ userId: req.userId, organizationId }, async () => {
    if (!ctx || !organizationId) return null;
    const [org, prefs, profile, snapshot, roleRow] = await Promise.all([
      readOrganizationLook(organizationId),
      getMyPreferences(ctx),
      getMyProfile(ctx),
      getFeatureSnapshot(ctx),
      adminDb.role.findUnique({ where: { key: ctx.roleKey } }),
    ]);
    const orgRow = access.organizations.find((o) => o.id === organizationId)!;
    const startOption = prefs.startPage.options.find((o) => o.key === prefs.startPage.key);
    return {
      organisation: {
        id: organizationId,
        slug: orgRow.slug,
        name: org.name,
        shownName: org.shownName,
        logoUrl: org.logoUrl,
        showLogoOnClientPages: org.showLogoOnClientPages,
        allowPersonalisation: org.allowPersonalisation,
      },
      membership: {
        id: ctx.membershipId,
        avatar: { url: profile.avatar.url, initials: profile.avatar.initials, updatedAt: profile.avatar.updatedAt },
      },
      role: {
        key: ctx.roleKey,
        // The design shows the proposed role as such wherever the person sees their own role (the identity block, the user chip).
        name: `${roleRow?.name ?? ctx.roleKey}${ROLE_NAME_SUFFIX[ctx.roleKey] ?? ""}`,
        workspaceLabel: WORKSPACE_LABELS[ctx.roleKey] ?? "Workspace",
      },
      permissions: [...ctx.permissionKeys].sort(),
      look: prefs.appearance.effective,
      preferences: {
        startPage: { key: startOption?.key ?? null, path: startOption ? startOption.path : null },
        density: prefs.appearance.density,
        sidebar: prefs.sidebar,
        hourFormat: prefs.regional.hourFormat,
        firstDayOfWeek: prefs.regional.firstDayOfWeek,
        dateFormat: prefs.regional.dateFormat,
      },
      organizationTimeZone: profile.organizationTimeZone,
      features: { release: snapshot.release, flags: snapshot.flags },
      userRow: { name: profile.name, phone: profile.phone, timeZone: profile.timeZone },
    };
  });

  const now = new Date();
  let signedIn = null;
  let sessionBlock = null;
  if (req.session) {
    const hours = await getSessionLifetimeHours(req.session.organizationId);
    const summary = summariseSession(req.session, hours, req.session.id, now.getTime());
    signedIn = {
      at: summary.signedInAt,
      local: formatLocal(req.session.createdAt, stable?.userRow.timeZone ?? stable?.organizationTimeZone ?? null, stable?.preferences.hourFormat ?? "H12"),
      device: summary.deviceLabel,
      place: summary.place,
      ipAddress: summary.ipAddress,
    };
    sessionBlock = {
      id: summary.id,
      expiresAt: summary.expiresAt,
      secondsLeft: summary.secondsLeft,
      warn: summary.warn,
      warnInSeconds: summary.warnInSeconds,
      canExtend: summary.canExtend,
      lifetimeHours: summary.lifetimeHours,
    };
  }

  const userTz = stable?.userRow.timeZone ?? user.timeZone ?? null;
  const orgTz = stable?.organizationTimeZone ?? null;

  return {
    kind: "member" as const,
    generatedAt: now.toISOString(),
    user: {
      id: user.id,
      name: stable?.userRow.name ?? user.name,
      email: user.email,
      phone: stable?.userRow.phone ?? user.phone,
      timeZone: userTz,
    },
    access: {
      state: access.state,
      awaitingAccess: access.awaitingAccess,
      reason: access.reason,
      pendingInvites: access.pendingInvites,
    },
    organisation: stable?.organisation ?? null,
    organisations: access.organizations.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      current: o.id === organizationId,
    })),
    membership: stable?.membership ?? null,
    role: stable?.role ?? null,
    permissions: stable?.permissions ?? [],
    look: stable?.look ?? null,
    preferences: stable?.preferences ?? null,
    signedIn,
    session: sessionBlock,
    timeZone: {
      user: userTz,
      organisation: orgTz,
      effective: userTz ?? orgTz,
      differsFromOrganisation: userTz !== null && orgTz !== null && userTz !== orgTz,
    },
    features: stable?.features ?? null,
    notifications: { unread: ctx ? await getMyUnreadNotificationCount(ctx) : 0 },
    supportView: null,
  };
}

/** The Platform Super Admin's variant (dev only until B6.03): who they are and the one thing they can set. */
export async function getPlatformContext(identity: { id: string; name: string; email: string; isDev: boolean }) {
  const prefs = await getPlatformPreferences(identity.id);
  return {
    kind: "platform" as const,
    generatedAt: new Date().toISOString(),
    identity: { id: identity.id, name: identity.name, email: identity.email, dev: identity.isDev },
    uiMode: prefs.uiMode,
    preferences: { supported: ["uiMode", "textSize", "bold", "higherContrast", "reduceMotion"] },
    notice: "This account belongs to the platform, not to an organisation, so it has no tenant data, role or permissions.",
  };
}
