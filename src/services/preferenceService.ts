import { invalidateMeContext } from "./meContextCache";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type UserPreference } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { ValidationError, type ValidationIssue } from "../auth/errors";
import { withOrgContext } from "../db/orgScopedClient";
import { loadFeatureConfig } from "../lib/featureConfig";
import { resolveFeature } from "../lib/featureFlags";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  BRAND_PAGE_COLOUR,
  BRAND_THEME,
  BRAND_TOGGLE_DARK,
  BRAND_TOGGLE_LIGHT,
  DATE_FORMATS,
  DENSITIES,
  FIRST_DAYS_OF_WEEK,
  HOUR_FORMATS,
  PAGE_COLOUR_KEYS,
  THEME_KEYS,
  checkOwnColours,
  findPageColour,
  lookColours,
  resolveBase,
  type OwnColours,
} from "../preferences/catalogue";
import { findStartPage, startPagesFor } from "../preferences/startPages";
import { diffAuditedFields } from "./auditDiff";
import { requireFeature } from "./featureService";
import { readOrganizationLook, type OrganizationLook } from "./organizationLookService";

/**
 * A member's own preferences (FIG-1024, B1.08).
 *
 * Stored per membership (so the same person can look different in two
 * organisations), in `user_preferences` under the organisation's RLS. A member
 * with no row at all simply follows the organisation's default look; a member
 * who only ever changed, say, the density still follows it for theme and page
 * colour (those columns are null until chosen).
 *
 * Some settings never reach the server: text size, bold text, higher contrast
 * and reduced motion are properties of a screen, not of a person, so they live
 * on the device. The API returns their defaults so clients have one place to
 * read the catalogue, and rejects an attempt to save them with the reason.
 */

/** Density is account-stored by default; flip to make it a device-only setting (FIG-1024). */
export const DENSITY_IS_DEVICE_ONLY = false;

export const DEFAULT_SIDEBAR = { collapsed: false, hidden: [] as string[] };
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export const DEVICE_ONLY_DEFAULTS = {
  textSize: "DEFAULT",
  bold: false,
  higherContrast: false,
  reduceMotion: false,
} as const;
export const TEXT_SIZES = ["SMALL", "DEFAULT", "LARGE", "EXTRA_LARGE"] as const;
const DEVICE_ONLY_LABEL: Record<string, string> = {
  textSize: "Text size",
  bold: "Bold text",
  higherContrast: "Higher contrast",
  reduceMotion: "Reduced motion",
};

const OWN_COLOURS_TOGGLE = "preferences.own_colours";

export interface SidebarPref {
  collapsed: boolean;
  hidden: string[];
}

export interface UpdatePreferencesInput {
  theme?: string;
  pageColour?: string;
  toggle?: { light?: string; dark?: string };
  density?: string;
  startPage?: string | null;
  sidebar?: { collapsed?: boolean; hidden?: string[] };
  hourFormat?: string;
  firstDayOfWeek?: string;
  dateFormat?: string;
  ownColours?: Record<string, unknown> | null;
  /** Device-only settings: accepted by the request shape so the refusal can explain itself. */
  textSize?: unknown;
  bold?: unknown;
  higherContrast?: unknown;
  reduceMotion?: unknown;
}

// ---------------------------------------------------------------------------
// Effective look
// ---------------------------------------------------------------------------

export interface EffectiveLook {
  /** Where the look comes from: the member's own choices, or the organisation's default. */
  source: "own" | "organisation";
  /** The organisation has switched personalisation off: theme and colours are read-only. */
  locked: boolean;
  theme: string;
  pageColour: string;
  toggle: { light: string; dark: string };
  ownColours: OwnColours | null;
  colours: {
    sidebar: string;
    accent: string;
    highlight: string;
    page: { key: string; label: string; hex: string | null; dark: boolean };
  };
}

function parseOwn(value: Prisma.JsonValue | null | undefined): OwnColours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: OwnColours = {};
  for (const f of ["sidebar", "accent", "highlight", "page"] as const) {
    const v = (value as Record<string, unknown>)[f];
    if (typeof v === "string") out[f] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseSidebar(value: Prisma.JsonValue | null | undefined): SidebarPref {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SIDEBAR, hidden: [] };
  const v = value as Record<string, unknown>;
  return {
    collapsed: v.collapsed === true,
    hidden: Array.isArray(v.hidden) ? v.hidden.filter((h): h is string => typeof h === "string") : [],
  };
}

async function loadRow(ctx: AuthContext): Promise<UserPreference | null> {
  return withOrgContext(ctx.organizationId, (tx) =>
    tx.userPreference.findFirst({
      where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId },
    }),
  );
}

async function ownColoursAvailable(organizationId: string): Promise<boolean> {
  return resolveFeature(OWN_COLOURS_TOGGLE, await loadFeatureConfig(organizationId)).enabled;
}

function buildEffectiveLook(
  org: OrganizationLook,
  row: UserPreference | null,
  ownAvailable: boolean,
): EffectiveLook {
  const locked = !org.allowPersonalisation;
  const chosenTheme = !locked ? row?.theme : null;
  const chosenPage = !locked ? row?.pageColour : null;
  const theme = chosenTheme ?? org.defaultTheme;
  const pageColour = chosenPage ?? org.defaultPageColour;
  const own = !locked && ownAvailable ? parseOwn(row?.ownColours) : null;
  const toggle = {
    light: row?.toggleLightPage ?? BRAND_TOGGLE_LIGHT,
    dark: row?.toggleDarkPage ?? BRAND_TOGGLE_DARK,
  };
  const base = lookColours(theme, pageColour);
  const pageHex = own?.page ?? base.page.hex;
  return {
    source: !locked && (chosenTheme || chosenPage || own) ? "own" : "organisation",
    locked,
    theme,
    pageColour,
    toggle,
    ownColours: own,
    colours: {
      sidebar: own?.sidebar ?? base.sidebar,
      accent: own?.accent ?? base.accent,
      highlight: own?.highlight ?? base.highlight,
      page: { ...base.page, hex: pageHex },
    },
  };
}

/** The look this member sees: their own choices where allowed, else the organisation's default. */
export async function resolveEffectiveLook(ctx: AuthContext, org?: OrganizationLook): Promise<EffectiveLook> {
  const [look, row, own] = await Promise.all([
    org ? Promise.resolve(org) : readOrganizationLook(ctx.organizationId),
    loadRow(ctx),
    ownColoursAvailable(ctx.organizationId),
  ]);
  return buildEffectiveLook(look, row, own);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function buildPreferencesView(ctx: AuthContext, row: UserPreference | null, org?: OrganizationLook) {
  const [look, own] = await Promise.all([
    org ? Promise.resolve(org) : readOrganizationLook(ctx.organizationId),
    ownColoursAvailable(ctx.organizationId),
  ]);
  const effective = buildEffectiveLook(look, row, own);
  const options = startPagesFor(ctx);
  const savedStart = row?.startPage ?? null;
  const startPage = savedStart ? options.find((p) => p.key === savedStart) : undefined;
  const sidebar = parseSidebar(row?.sidebar);
  const allowedKeys = new Set(options.map((o) => o.key));

  return {
    appearance: {
      theme: row?.theme ?? null,
      pageColour: row?.pageColour ?? null,
      toggle: effective.toggle,
      density: row?.density ?? "COMFORTABLE",
      densityStoredOn: DENSITY_IS_DEVICE_ONLY ? ("device" as const) : ("account" as const),
      ownColours: effective.ownColours,
      effective,
      organisationDefault: { theme: look.defaultTheme, pageColour: look.defaultPageColour },
    },
    personalisation: {
      allowed: look.allowPersonalisation,
      locked: effective.locked,
      ownColoursAvailable: own && look.allowPersonalisation,
    },
    startPage: {
      key: startPage?.key ?? null,
      /** True when a saved start page is no longer available to this role; the member lands on the dashboard. */
      unavailable: savedStart !== null && !startPage,
      options: options.map((p) => ({ key: p.key, label: p.label, path: p.path })),
    },
    sidebar: { collapsed: sidebar.collapsed, hidden: sidebar.hidden.filter((h) => allowedKeys.has(h) && h !== "dashboard") },
    regional: {
      hourFormat: row?.hourFormat ?? "H12",
      firstDayOfWeek: row?.firstDayOfWeek ?? "MON",
      dateFormat: row?.dateFormat ?? "DMY",
      /** Set on the profile, shown here for reference. */
      timeZoneSetOn: "profile" as const,
    },
    deviceOnly: { ...DEVICE_ONLY_DEFAULTS, storedOn: "device" as const, textSizes: [...TEXT_SIZES] },
    catalogue: {
      densities: [...DENSITIES],
      hourFormats: [...HOUR_FORMATS],
      firstDaysOfWeek: [...FIRST_DAYS_OF_WEEK],
      dateFormats: [...DATE_FORMATS],
    },
    undoAvailable: !!row?.undoTokenHash && !!row.undoExpiresAt && row.undoExpiresAt.getTime() > Date.now(),
  };
}

export type PreferencesView = Awaited<ReturnType<typeof buildPreferencesView>>;

export async function getMyPreferences(ctx: AuthContext): Promise<PreferencesView> {
  return buildPreferencesView(ctx, await loadRow(ctx));
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const LOOK_FIELDS = ["theme", "pageColour", "toggle", "ownColours"] as const;
const APPEARANCE_COLUMNS = ["theme", "pageColour", "toggleLightPage", "toggleDarkPage", "density", "ownColours"] as const;
const AUDITED_COLUMNS = [
  ...APPEARANCE_COLUMNS,
  "startPage",
  "sidebar",
  "hourFormat",
  "firstDayOfWeek",
  "dateFormat",
] as const;

function oneOf<T extends string>(path: string, value: unknown, allowed: readonly T[], what: string, issues: ValidationIssue[]): T | undefined {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  issues.push({ path, message: `"${String(value)}" is not a ${what}. Choose one of: ${allowed.join(", ")}.` });
  return undefined;
}

export async function updateMyPreferences(
  ctx: AuthContext,
  input: UpdatePreferencesInput,
): Promise<PreferencesView & { ignored: string[] }> {
  const issues: ValidationIssue[] = [];

  // Device-only settings are refused with the reason, never silently dropped.
  for (const key of Object.keys(DEVICE_ONLY_DEFAULTS)) {
    if ((input as Record<string, unknown>)[key] !== undefined) {
      issues.push({
        path: key,
        code: "DEVICE_ONLY_SETTING",
        message: `${DEVICE_ONLY_LABEL[key]} is saved on this device, not on your account, so it cannot be changed here. Change it in the app on the device you want it on.`,
      });
    }
  }
  if (DENSITY_IS_DEVICE_ONLY && input.density !== undefined) {
    issues.push({
      path: "density",
      code: "DEVICE_ONLY_SETTING",
      message: "Density is saved on this device, not on your account, so it cannot be changed here.",
    });
  }

  const [org, row] = await Promise.all([
    readOrganizationLook(ctx.organizationId),
    loadRow(ctx),
  ]);
  const locked = !org.allowPersonalisation;

  const data: Prisma.UserPreferenceUncheckedUpdateInput = {};
  const ignored: string[] = [];

  // ---- look: ignored (and reported) when the organisation has switched personalisation off
  const lookTouched = LOOK_FIELDS.filter((f) => input[f] !== undefined);
  if (locked) {
    ignored.push(...lookTouched);
  } else {
    if (input.theme !== undefined) {
      const v = oneOf("theme", input.theme, THEME_KEYS, "theme", issues);
      if (v) data.theme = v;
    }
    if (input.pageColour !== undefined) {
      const v = oneOf("pageColour", input.pageColour, PAGE_COLOUR_KEYS, "page colour", issues);
      if (v) data.pageColour = v;
    }
    if (input.toggle !== undefined) {
      if (input.toggle.light !== undefined) {
        const page = typeof input.toggle.light === "string" ? findPageColour(input.toggle.light) : undefined;
        if (!page || page.hex === null || page.dark) {
          issues.push({ path: "toggle.light", message: "The light side of the light/dark switch must be one of the light page colours." });
        } else data.toggleLightPage = page.key;
      }
      if (input.toggle.dark !== undefined) {
        const page = typeof input.toggle.dark === "string" ? findPageColour(input.toggle.dark) : undefined;
        if (!page || page.hex === null || !page.dark) {
          issues.push({ path: "toggle.dark", message: "The dark side of the light/dark switch must be one of the dark page colours." });
        } else data.toggleDarkPage = page.key;
      }
    }
  }

  // ---- account-stored basics
  if (input.density !== undefined && !DENSITY_IS_DEVICE_ONLY) {
    const v = oneOf("density", input.density, DENSITIES, "density", issues);
    if (v) data.density = v;
  }
  if (input.hourFormat !== undefined) {
    const v = oneOf("hourFormat", input.hourFormat, HOUR_FORMATS, "hour format", issues);
    if (v) data.hourFormat = v;
  }
  if (input.firstDayOfWeek !== undefined) {
    const v = oneOf("firstDayOfWeek", input.firstDayOfWeek, FIRST_DAYS_OF_WEEK, "first day of the week", issues);
    if (v) data.firstDayOfWeek = v;
  }
  if (input.dateFormat !== undefined) {
    const v = oneOf("dateFormat", input.dateFormat, DATE_FORMATS, "date format", issues);
    if (v) data.dateFormat = v;
  }

  // ---- start page: only pages this role can open
  if (input.startPage !== undefined) {
    if (input.startPage === null) data.startPage = null;
    else {
      const def = findStartPage(input.startPage);
      const allowed = startPagesFor(ctx);
      if (!def) {
        issues.push({ path: "startPage", message: `"${input.startPage}" is not a page. Choose one of: ${allowed.map((p) => p.key).join(", ")}.` });
      } else if (!allowed.some((p) => p.key === def.key)) {
        issues.push({
          path: "startPage",
          code: "START_PAGE_NOT_AVAILABLE",
          message: `${def.label} is not available to your role, so it cannot be your start page. Choose one of: ${allowed.map((p) => p.label).join(", ")}.`,
        });
      } else data.startPage = def.key;
    }
  }

  // ---- sidebar
  if (input.sidebar !== undefined) {
    const current = parseSidebar(row?.sidebar);
    const next: SidebarPref = { collapsed: current.collapsed, hidden: [...current.hidden] };
    if (input.sidebar.collapsed !== undefined) {
      if (typeof input.sidebar.collapsed !== "boolean") issues.push({ path: "sidebar.collapsed", message: "Collapsed must be true or false." });
      else next.collapsed = input.sidebar.collapsed;
    }
    if (input.sidebar.hidden !== undefined) {
      const allowedKeys = new Set(startPagesFor(ctx).map((p) => p.key));
      const hidden = [...new Set(input.sidebar.hidden)];
      const bad = hidden.filter((k) => !allowedKeys.has(k));
      if (hidden.includes("dashboard")) {
        issues.push({ path: "sidebar.hidden", message: "The dashboard cannot be hidden from the sidebar." });
      } else if (bad.length > 0) {
        issues.push({ path: "sidebar.hidden", message: `${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} not in your sidebar, so cannot be hidden.` });
      } else next.hidden = hidden;
    }
    data.sidebar = next as unknown as Prisma.InputJsonValue;
  }

  // ---- own colours (V1.1): gated, then checked for readability
  let ownWrite: OwnColours | null | undefined;
  if (!locked && input.ownColours !== undefined) {
    if (input.ownColours === null) ownWrite = null;
    else {
      await requireFeature(ctx.organizationId, OWN_COLOURS_TOGGLE);
      const theme = (data.theme as string | undefined) ?? row?.theme ?? org.defaultTheme;
      const page = (data.pageColour as string | undefined) ?? row?.pageColour ?? org.defaultPageColour;
      const light = findPageColour((data.toggleLightPage as string | undefined) ?? row?.toggleLightPage ?? BRAND_TOGGLE_LIGHT)?.hex ?? "#FAF9F7";
      const dark = findPageColour((data.toggleDarkPage as string | undefined) ?? row?.toggleDarkPage ?? BRAND_TOGGLE_DARK)?.hex ?? "#0F1512";
      const matchDevice = findPageColour(page)?.hex === null;
      // "Match my device" can land on either side of the switch, so both must stay readable.
      const bases = matchDevice && input.ownColours.page === undefined ? [light, dark] : [light];
      const seen = new Set<string>();
      let accepted: OwnColours = {};
      for (const pageHex of bases) {
        const base = { ...resolveBase(theme, page, light), page: findPageColour(page)?.hex ?? pageHex };
        if (matchDevice) base.page = pageHex;
        const { colours, problems } = checkOwnColours(input.ownColours, base);
        accepted = colours;
        for (const p of problems) {
          const k = `${p.field}:${p.code}`;
          if (seen.has(k)) continue;
          seen.add(k);
          issues.push({ path: `ownColours.${p.field}`, code: p.code, message: p.message });
        }
      }
      ownWrite = accepted;
    }
    if (ownWrite !== undefined) {
      data.ownColours = ownWrite === null || Object.keys(ownWrite).length === 0 ? Prisma.DbNull : (ownWrite as Prisma.InputJsonValue);
    }
  } else if (locked && input.ownColours !== undefined) {
    // already reported through `ignored`
  }

  if (issues.length > 0) {
    throw new ValidationError(
      issues.length === 1 ? issues[0]!.message : "Some of your preferences are not valid.",
      issues,
    );
  }

  const changedAppearance = APPEARANCE_COLUMNS.some((c) => c in data);
  if (changedAppearance) {
    // A later look change makes the one-step undo of an earlier reset stale.
    data.undoSnapshot = Prisma.DbNull;
    data.undoTokenHash = null;
    data.undoExpiresAt = null;
  }

  let saved = row;
  if (Object.keys(data).length > 0) {
    const before = row ?? defaultsRow();
    const auditPatch = Object.fromEntries(
      Object.entries(data).filter(([k]) => (AUDITED_COLUMNS as readonly string[]).includes(k)).map(([k, v]) => [k, v === Prisma.DbNull ? null : v]),
    );
    const diff = diffAuditedFields(before, auditPatch, AUDITED_COLUMNS);
    saved = await withOrgContext(ctx.organizationId, (tx) =>
      tx.userPreference.upsert({
        where: { organizationId_membershipId: { organizationId: ctx.organizationId, membershipId: ctx.membershipId } },
        update: data,
        create: {
          ...(data as Prisma.UserPreferenceUncheckedCreateInput),
          organizationId: ctx.organizationId,
          membershipId: ctx.membershipId,
        },
      }),
    );
    if (diff) {
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorMembershipId: ctx.membershipId,
        action: "preferences.updated",
        entityType: "Membership",
        entityId: ctx.membershipId,
        previousValue: diff.previousValue,
        newValue: diff.newValue,
      });
    }
  }
  invalidateMeContext({ userId: ctx.userId });
  return { ...(await buildPreferencesView(ctx, saved, org)), ignored };
}

/** What a member with no saved row has, for diffing the first save against. */
function defaultsRow() {
  return {
    theme: null,
    pageColour: null,
    toggleLightPage: BRAND_TOGGLE_LIGHT,
    toggleDarkPage: BRAND_TOGGLE_DARK,
    density: "COMFORTABLE",
    ownColours: null,
    startPage: null,
    sidebar: DEFAULT_SIDEBAR,
    hourFormat: "H12",
    firstDayOfWeek: "MON",
    dateFormat: "DMY",
  };
}

// ---------------------------------------------------------------------------
// Reset and undo
// ---------------------------------------------------------------------------

interface AppearanceSnapshot {
  theme: string | null;
  pageColour: string | null;
  toggleLightPage: string;
  toggleDarkPage: string;
  density: string;
  ownColours: Prisma.JsonValue | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Puts the look back to the brand defaults, Forest on White, with the light/dark
 * pair at White and Dark and comfortable density. Only the appearance resets;
 * start page, sidebar and date/time choices stay. Returns a one-time undo token
 * good for ten minutes. When the organisation has switched personalisation off,
 * theme and page colour are not the member's to set, so they stay following the
 * organisation's.
 */
export async function resetMyAppearance(ctx: AuthContext) {
  const [org, row] = await Promise.all([readOrganizationLook(ctx.organizationId), loadRow(ctx)]);
  const locked = !org.allowPersonalisation;
  const snapshot: AppearanceSnapshot = {
    theme: row?.theme ?? null,
    pageColour: row?.pageColour ?? null,
    toggleLightPage: row?.toggleLightPage ?? BRAND_TOGGLE_LIGHT,
    toggleDarkPage: row?.toggleDarkPage ?? BRAND_TOGGLE_DARK,
    density: row?.density ?? "COMFORTABLE",
    ownColours: row?.ownColours ?? null,
  };
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + UNDO_WINDOW_MS);
  const brand = {
    theme: locked ? null : BRAND_THEME,
    pageColour: locked ? null : BRAND_PAGE_COLOUR,
    toggleLightPage: BRAND_TOGGLE_LIGHT,
    toggleDarkPage: BRAND_TOGGLE_DARK,
    density: "COMFORTABLE",
    ownColours: Prisma.DbNull,
    undoSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    undoTokenHash: hashToken(token),
    undoExpiresAt: expiresAt,
  };
  const saved = await withOrgContext(ctx.organizationId, (tx) =>
    tx.userPreference.upsert({
      where: { organizationId_membershipId: { organizationId: ctx.organizationId, membershipId: ctx.membershipId } },
      update: brand,
      create: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, ...brand },
    }),
  );
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "preferences.reset",
    entityType: "Membership",
    entityId: ctx.membershipId,
    previousValue: snapshot as unknown as Prisma.InputJsonValue,
  });
  invalidateMeContext({ userId: ctx.userId });
  return {
    preferences: await buildPreferencesView(ctx, saved, org),
    undo: { token, expiresAt, expiresInSeconds: UNDO_WINDOW_MS / 1000 },
  };
}

/** Restores the look from before the last reset. One use, ten minutes, only for the member who reset. */
export async function undoMyReset(ctx: AuthContext, token: string) {
  const row = await loadRow(ctx);
  const expired = () =>
    new ValidationError("This undo has expired or was already used.", [
      { path: "token", code: "UNDO_EXPIRED", message: "This undo has expired or was already used." },
    ]);
  if (!row?.undoTokenHash || !row.undoExpiresAt || !row.undoSnapshot) throw expired();
  if (row.undoExpiresAt.getTime() <= Date.now()) throw expired();
  const given = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(row.undoTokenHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw expired();

  const snap = row.undoSnapshot as unknown as AppearanceSnapshot;
  const restore = {
    theme: snap.theme,
    pageColour: snap.pageColour,
    toggleLightPage: snap.toggleLightPage,
    toggleDarkPage: snap.toggleDarkPage,
    density: snap.density,
    ownColours: snap.ownColours === null ? Prisma.DbNull : (snap.ownColours as Prisma.InputJsonValue),
    undoSnapshot: Prisma.DbNull,
    undoTokenHash: null,
    undoExpiresAt: null,
  };
  // Claim the token in the same statement that spends it, so a double click restores once.
  const claimed = await withOrgContext(ctx.organizationId, (tx) =>
    tx.userPreference.updateMany({
      where: { id: row.id, organizationId: ctx.organizationId, undoTokenHash: row.undoTokenHash },
      data: restore,
    }),
  );
  if (claimed.count !== 1) throw expired();
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "preferences.reset_undone",
    entityType: "Membership",
    entityId: ctx.membershipId,
  });
  invalidateMeContext({ userId: ctx.userId });
  return getMyPreferences(ctx);
}
