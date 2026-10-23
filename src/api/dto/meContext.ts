import { z } from "zod";
import { isoDateTime } from "./common";

/**
 * `GET /api/me/context` (FIG-1026, B1.10): everything the shell needs to draw
 * itself, in one call, in the same shape for every role. Sections that do not
 * apply (an account still waiting for access has no organisation, role or
 * look) are `null`, never missing, so a client never branches on the role to
 * know which keys exist.
 */
const ReleaseSchema = z.enum(["v1", "v1.1", "v2"]);

const AvatarSchema = z.strictObject({
  url: z.string().nullable(),
  initials: z.string(),
  updatedAt: isoDateTime.nullable(),
});

const LookSchema = z.strictObject({
  source: z.enum(["own", "organisation"]),
  locked: z.boolean(),
  theme: z.string(),
  pageColour: z.string(),
  toggle: z.strictObject({ light: z.string(), dark: z.string() }),
  ownColours: z
    .strictObject({
      sidebar: z.string().optional(),
      accent: z.string().optional(),
      highlight: z.string().optional(),
      page: z.string().optional(),
    })
    .nullable(),
  colours: z.strictObject({
    sidebar: z.string(),
    accent: z.string(),
    highlight: z.string(),
    page: z.strictObject({
      key: z.string(),
      label: z.string(),
      hex: z.string().nullable(),
      dark: z.boolean(),
    }),
  }),
});

export const MemberContextSchema = z.strictObject({
  kind: z.literal("member"),
  generatedAt: isoDateTime,
  user: z.strictObject({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    timeZone: z.string().nullable(),
  }),
  access: z.strictObject({
    state: z.enum(["active", "awaitingAccess", "deactivated"]),
    awaitingAccess: z.boolean(),
    reason: z.enum(["NO_MEMBERSHIP", "INVITE_PENDING", "REMOVED"]).nullable(),
    pendingInvites: z.array(
      z.strictObject({
        organizationName: z.string(),
        expiresAt: isoDateTime.nullable(),
        expired: z.boolean(),
      }),
    ),
  }),
  organisation: z
    .strictObject({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      shownName: z.string(),
      logoUrl: z.string().nullable(),
      showLogoOnClientPages: z.boolean(),
      allowPersonalisation: z.boolean(),
    })
    .nullable(),
  /** Every organisation the person can open; one in V1, more with the V1.1 switcher. */
  organisations: z.array(
    z.strictObject({ id: z.string(), slug: z.string(), name: z.string(), current: z.boolean() }),
  ),
  membership: z.strictObject({ id: z.string(), avatar: AvatarSchema }).nullable(),
  role: z
    .strictObject({
      key: z.string(),
      name: z.string(),
      /** What the shell calls the person's home: "Sales workspace", "Management dashboard", ... */
      workspaceLabel: z.string(),
    })
    .nullable(),
  permissions: z.array(z.string()),
  look: LookSchema.nullable(),
  preferences: z
    .strictObject({
      startPage: z.strictObject({ key: z.string().nullable(), path: z.string().nullable() }),
      density: z.string(),
      sidebar: z.strictObject({ collapsed: z.boolean(), hidden: z.array(z.string()) }),
      hourFormat: z.string(),
      firstDayOfWeek: z.string(),
      dateFormat: z.string(),
    })
    .nullable(),
  signedIn: z
    .strictObject({
      at: isoDateTime,
      /** The sign-in time written in the person's own zone and hour format. */
      local: z.string(),
      device: z.string().nullable(),
      place: z.string().nullable(),
      ipAddress: z.string().nullable(),
    })
    .nullable(),
  session: z
    .strictObject({
      id: z.string(),
      expiresAt: isoDateTime,
      secondsLeft: z.number().int(),
      warn: z.boolean(),
      warnInSeconds: z.number().int(),
      canExtend: z.boolean(),
      lifetimeHours: z.number().int(),
    })
    .nullable(),
  timeZone: z.strictObject({
    user: z.string().nullable(),
    organisation: z.string().nullable(),
    effective: z.string().nullable(),
    /** The person's own zone differs from the organisation's: worth a gentle note next to times. */
    differsFromOrganisation: z.boolean(),
  }),
  features: z.strictObject({ release: ReleaseSchema, flags: z.record(z.string(), z.boolean()) }).nullable(),
  notifications: z.strictObject({ unread: z.number().int() }),
  /** Reserved for V2 (support view): null until a support session is active. */
  supportView: z
    .strictObject({ active: z.literal(true), by: z.string(), reason: z.string(), expiresAt: isoDateTime })
    .nullable(),
});

/** What a Platform Super Admin gets (development only until B6.03): no organisation, role or permissions. */
export const PlatformContextSchema = z.strictObject({
  kind: z.literal("platform"),
  generatedAt: isoDateTime,
  identity: z.strictObject({ id: z.string(), name: z.string(), email: z.string(), dev: z.boolean() }),
  uiMode: z.enum(["LIGHT", "DARK"]),
  preferences: z.strictObject({ supported: z.array(z.string()) }),
  notice: z.string(),
});

export const MeContextSchema = z.discriminatedUnion("kind", [MemberContextSchema, PlatformContextSchema]);
