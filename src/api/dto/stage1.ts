import { z } from "zod";
import { isoDateTime } from "./common";

/**
 * Contracts for the Stage 1 foundation routes (B1.04 to B1.11): sessions, the
 * profile and picture, preferences, the organisation's look, and notification
 * preferences. Large read models (preferences, notification preferences) are
 * described by their stable top-level keys; the nested detail is documented in
 * `docs/API_CONVENTIONS.md`.
 */

const Avatar = z.strictObject({ url: z.string().nullable(), initials: z.string(), updatedAt: isoDateTime.nullable() });

export const MyProfileSchema = z.strictObject({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  timeZone: z.string().nullable(),
  organizationTimeZone: z.string(),
  effectiveTimeZone: z.string(),
  avatar: Avatar.extend({
    crop: z.strictObject({ x: z.number(), y: z.number(), size: z.number() }).nullable(),
  }),
});

export const UpdateMyProfileBodySchema = z.strictObject({
  name: z.string().optional(),
  phone: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
});

export const SetAvatarBodySchema = z.strictObject({
  fileId: z.string(),
  /** A square in pixels of the picture as displayed; omitted = the centre square. */
  crop: z.strictObject({ x: z.number(), y: z.number(), size: z.number() }).nullable().optional(),
});

export const OrganizationLookSchema = z.strictObject({
  name: z.string(),
  shownName: z.string(),
  displayName: z.string().nullable(),
  logoUrl: z.string().nullable(),
  defaultTheme: z.string(),
  defaultPageColour: z.string(),
  colours: z.strictObject({
    theme: z.strictObject({ key: z.string(), label: z.string() }),
    sidebar: z.string(),
    accent: z.string(),
    highlight: z.string(),
    page: z.strictObject({ key: z.string(), label: z.string(), hex: z.string().nullable(), dark: z.boolean() }),
  }),
  showLogoOnClientPages: z.boolean(),
  allowPersonalisation: z.boolean(),
});

export const UpdateOrganizationLookBodySchema = z.strictObject({
  displayName: z.string().nullable().optional(),
  logoFileId: z.string().nullable().optional(),
  defaultTheme: z.string().optional(),
  defaultPageColour: z.string().optional(),
  showLogoOnClientPages: z.boolean().optional(),
  allowPersonalisation: z.boolean().optional(),
});

export const UpdatePreferencesBodySchema = z.strictObject({
  theme: z.string().optional(),
  pageColour: z.string().optional(),
  toggle: z.strictObject({ light: z.string().optional(), dark: z.string().optional() }).optional(),
  density: z.string().optional(),
  startPage: z.string().nullable().optional(),
  sidebar: z.strictObject({ collapsed: z.boolean().optional(), hidden: z.array(z.string()).optional() }).optional(),
  hourFormat: z.string().optional(),
  firstDayOfWeek: z.string().optional(),
  dateFormat: z.string().optional(),
  ownColours: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const PreferencesViewSchema = z.looseObject({
  appearance: z.looseObject({ effective: z.looseObject({}) }),
  personalisation: z.strictObject({ allowed: z.boolean(), locked: z.boolean(), ownColoursAvailable: z.boolean() }),
  startPage: z.looseObject({ key: z.string().nullable(), unavailable: z.boolean(), options: z.array(z.looseObject({})) }),
  sidebar: z.strictObject({ collapsed: z.boolean(), hidden: z.array(z.string()) }),
  regional: z.looseObject({}),
  deviceOnly: z.looseObject({}),
  catalogue: z.looseObject({}),
  undoAvailable: z.boolean(),
});

export const UpdatePreferencesResponseSchema = PreferencesViewSchema.extend({ ignored: z.array(z.string()) });

export const ResetPreferencesResponseSchema = z.strictObject({
  preferences: PreferencesViewSchema,
  undo: z.strictObject({ token: z.string(), expiresAt: isoDateTime, expiresInSeconds: z.number() }),
});

export const UndoResetBodySchema = z.strictObject({ token: z.string() });

export const NotificationPreferencesViewSchema = z.strictObject({
  preset: z.enum(["EVERYTHING", "IMPORTANT_ONLY", "OFF", "CUSTOM"]),
  presets: z.array(z.strictObject({ key: z.string(), label: z.string(), description: z.string() })),
  types: z.array(
    z.strictObject({
      type: z.string(),
      label: z.string(),
      description: z.string(),
      important: z.boolean(),
      alwaysOn: z.boolean(),
      channels: z.strictObject({
        inApp: z.strictObject({ enabled: z.boolean(), locked: z.boolean() }),
        email: z.strictObject({ enabled: z.boolean(), locked: z.boolean() }),
        push: z.strictObject({ enabled: z.literal(false), available: z.literal(false), note: z.string() }),
      }),
    }),
  ),
  quietHours: z.strictObject({ enabled: z.boolean(), start: z.string(), end: z.string(), timeZone: z.string() }),
  dailyEmailCap: z.number().int(),
  dailyEmailCapRange: z.strictObject({ min: z.number(), max: z.number(), default: z.number() }),
  emailsToday: z.number().int(),
  heldForDigest: z.number().int(),
});

export const UpdateNotificationPreferencesBodySchema = z.strictObject({
  preset: z.enum(["EVERYTHING", "IMPORTANT_ONLY", "OFF"]).optional(),
  types: z
    .record(z.string(), z.strictObject({ inApp: z.boolean().optional(), email: z.boolean().optional(), push: z.boolean().optional() }))
    .optional(),
  quietHours: z
    .strictObject({ enabled: z.boolean().optional(), start: z.string().optional(), end: z.string().optional() })
    .optional(),
  dailyEmailCap: z.number().int().optional(),
});

export const SessionSummarySchema = z.strictObject({
  id: z.string(),
  signedInAt: isoDateTime,
  lastActiveAt: isoDateTime,
  expiresAt: isoDateTime,
  absoluteExpiresAt: isoDateTime,
  secondsLeft: z.number().int(),
  warnAt: isoDateTime,
  warnInSeconds: z.number().int(),
  warn: z.boolean(),
  lifetimeHours: z.number().int(),
  canExtend: z.boolean(),
  deviceLabel: z.string().nullable(),
  ipAddress: z.string().nullable(),
  place: z.string().nullable(),
  current: z.boolean(),
});

export const MySessionsResponseSchema = z.strictObject({ items: z.array(SessionSummarySchema) });
export const ExtendSessionResponseSchema = z.strictObject({ extended: z.boolean(), session: SessionSummarySchema });
