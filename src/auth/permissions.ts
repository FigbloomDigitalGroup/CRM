import {
  PERMISSIONS,
  PERMISSION_MIN_RELEASE,
  ROLES,
} from "../../prisma/seedData";
import {
  releaseAtLeast,
  resolveFeature,
  type FeatureConfig,
  type Release,
} from "../lib/featureFlags";

/**
 * Permission model v2 (FIG-1017, B1.01, and the departure flags of FIG-1019,
 * B1.03). Everything here is pure: no database access. The membership
 * lookup (`resolveActiveMembership`) loads the role's catalogue keys and the
 * organization's feature configuration and passes both to
 * `effectivePermissionKeys`, so the keys a request carries already reflect
 * the organization's release, its departure flags and the Customer Support
 * flag. Nothing downstream checks a role name; every check is a permission
 * key.
 */

// ---------------------------------------------------------------------------
// Departures from the seeded matrix (docs/DECISIONS.md section 1)
// ---------------------------------------------------------------------------

export interface DepartureDef {
  /** Stable id used in API payloads (`provisional` banners). */
  id: string;
  /** The organisation toggle that switches this departure (src/lib/featureFlags.ts). */
  toggle: string;
  label: string;
  /** docs/DECISIONS.md row that signed it. */
  decision: string;
  /** Screen Checklist ids where the UI shows the "Provisional" banner. */
  screens: string[];
  /** Permission keys this departure introduces; they are removed when it is off. */
  grants: Record<string, string[]>;
  /**
   * What the seeded matrix gave these roles before the departure; restored
   * when the departure is off, so "off" really means the old behaviour.
   */
  restores: Record<string, string[]>;
}

export const DEPARTURES: readonly DepartureDef[] = [
  {
    id: "won_only",
    toggle: "departure.won_only",
    label: "Delivery and Finance see won deals only",
    decision: "1.2",
    screens: ["P1", "P4", "F1"],
    grants: { DELIVERY: ["deals.view.won"], FINANCE: ["deals.view.won"] },
    restores: { DELIVERY: ["deals.view.all"], FINANCE: ["deals.view.all"] },
  },
  {
    id: "shared_pool",
    toggle: "departure.shared_pool",
    label: "Sales shared pool of unassigned leads",
    decision: "1.3",
    screens: ["L1"],
    grants: { SALES: ["leads.view.shared", "leads.claim"] },
    restores: {},
  },
  {
    id: "technical_my_work",
    toggle: "departure.technical_my_work",
    label: "Restricted Technical My work",
    decision: "1.4",
    screens: ["T1"],
    grants: { RESTRICTED_TECHNICAL: ["mywork.view"] },
    restores: {},
  },
  {
    id: "finance_followup",
    toggle: "departure.finance_followup",
    label: "Finance follow-up note instead of tasks",
    decision: "1.5",
    screens: ["F1", "D3"],
    grants: { FINANCE: ["finance.followup.note"] },
    restores: {},
  },
  {
    id: "handoff_permission",
    toggle: "departure.handoff_permission",
    label: "Delivery handoff permission",
    decision: "1.6",
    screens: ["P3", "P4"],
    grants: {
      MANAGEMENT: ["deals.handoff", "handoff.manage"],
      SALES: ["deals.handoff"],
      DELIVERY: ["handoff.manage"],
    },
    restores: {},
  },
];

/** The umbrella toggle from B0.07: off switches every departure off at once. */
export const DEPARTURES_MASTER_TOGGLE = "permissions.provisional_departures";

/** The departure that introduced a permission key, if any (drives `provisional: true`). */
const DEPARTURE_BY_KEY = new Map<string, DepartureDef>();
for (const d of DEPARTURES) {
  for (const keys of Object.values(d.grants)) {
    for (const key of keys) DEPARTURE_BY_KEY.set(key, d);
  }
}

export function departureForPermission(key: string): DepartureDef | undefined {
  return DEPARTURE_BY_KEY.get(key);
}

export function isDepartureActive(def: DepartureDef, config: FeatureConfig): boolean {
  return (
    resolveFeature(DEPARTURES_MASTER_TOGGLE, config).enabled &&
    resolveFeature(def.toggle, config).enabled
  );
}

// ---------------------------------------------------------------------------
// Effective permission keys
// ---------------------------------------------------------------------------

const REQUIRED_FEATURE_BY_ROLE = new Map(
  ROLES.filter((r) => r.requiredFeature).map((r) => [r.key, r.requiredFeature as string]),
);

export function requiredFeatureForRole(roleKey: string): string | undefined {
  return REQUIRED_FEATURE_BY_ROLE.get(roleKey);
}

/** Whether a member holding this role carries any permissions in an organization with this configuration. */
export function roleIsAvailable(roleKey: string, config: FeatureConfig): boolean {
  const feature = REQUIRED_FEATURE_BY_ROLE.get(roleKey);
  return !feature || resolveFeature(feature, config).enabled;
}

/**
 * The permission keys a member actually carries: the role's catalogue keys,
 * adjusted for the organization.
 *
 *  1. A flag-gated role (Customer Support) with its flag off carries nothing.
 *  2. A departure that is off removes the keys it introduced and gives back
 *     the keys the seeded matrix had.
 *  3. Keys for a release the organization has not reached are dropped.
 */
export function effectivePermissionKeys(input: {
  roleKey: string;
  catalogueKeys: readonly string[];
  config: FeatureConfig;
}): string[] {
  const { roleKey, catalogueKeys, config } = input;
  if (!roleIsAvailable(roleKey, config)) return [];

  const keys = new Set(catalogueKeys);
  for (const departure of DEPARTURES) {
    if (isDepartureActive(departure, config)) continue;
    for (const key of departure.grants[roleKey] ?? []) keys.delete(key);
    for (const key of departure.restores[roleKey] ?? []) keys.add(key);
  }
  for (const key of [...keys]) {
    const min = PERMISSION_MIN_RELEASE[key];
    if (min && !releaseAtLeast(config.release, min)) keys.delete(key);
  }
  return [...keys].sort();
}

export function permissionMinRelease(key: string): Release {
  return PERMISSION_MIN_RELEASE[key] ?? "v1";
}

export function knownPermissionKeys(): string[] {
  return PERMISSIONS.map((p) => p.key);
}

// ---------------------------------------------------------------------------
// Scope resolver
// ---------------------------------------------------------------------------

/**
 * What the design shows as the scope pill on every screen: `own` (My ...),
 * `organisation` (all organisation records), `read-only`, or `none`.
 */
export type ScopeLevel = "own" | "organisation" | "read-only" | "none";

export interface ScopeResolution {
  scope: ScopeLevel;
  /** Plain-language reason, safe to show next to a disabled control. */
  reason: string;
  /** True when the access exists only because of a departure from the seeded matrix. */
  provisional: boolean;
  /** Id of that departure, for the banner copy. */
  departure: string | null;
}

export type ScopedResource =
  | "leads"
  | "deals"
  | "tasks"
  | "companies"
  | "contacts"
  | "communications"
  | "activities"
  | "proposals";
export type ScopedAction = "view" | "edit" | "archive";

export interface ScopedRecord {
  ownerMembershipId?: string | null;
  /** Deals: the outcome decides whether a won-only viewer may open it. */
  outcome?: "OPEN" | "WON" | "LOST" | null;
}

interface Rule {
  /** Permission that covers every record of the organisation. */
  all?: string;
  /** Permission that covers only records the caller owns. */
  own?: string;
  /** Permission that covers unassigned (shared pool) records, read-only. */
  shared?: string;
  /** Permission that covers won deals, read-only. */
  won?: string;
  /** Permission that covers every record with no ownership notion. */
  flat?: string;
}

const RULES: Record<ScopedResource, Partial<Record<ScopedAction, Rule>>> = {
  leads: {
    view: { all: "leads.view.all", own: "leads.view.own", shared: "leads.view.shared" },
    edit: { all: "leads.edit.all", own: "leads.edit.own" },
    archive: { all: "leads.archive.all", own: "leads.archive.own" },
  },
  deals: {
    view: { all: "deals.view.all", own: "deals.view.own", won: "deals.view.won" },
    edit: { all: "deals.edit.all", own: "deals.edit.own" },
    archive: { all: "deals.archive.all", own: "deals.archive.own" },
  },
  tasks: {
    view: { all: "tasks.view.all", own: "tasks.view.own" },
    edit: { all: "tasks.assign.any", own: "tasks.assign.own" },
  },
  companies: {
    view: { flat: "companies.view" },
    edit: { flat: "companies.edit" },
    archive: { flat: "companies.archive" },
  },
  contacts: {
    view: { flat: "contacts.view" },
    edit: { flat: "contacts.edit" },
    archive: { flat: "contacts.archive" },
  },
  communications: {
    view: { flat: "communications.view" },
    edit: { flat: "communications.create" },
  },
  activities: {
    view: { flat: "activities.view" },
    edit: { flat: "activities.create" },
  },
  proposals: {
    view: { flat: "proposals.view" },
    edit: { flat: "proposals.manage" },
  },
};

/** The permission keys that grant view access to a resource, for the explained denial. */
export function viewPermissionKeys(resource: ScopedResource): string[] {
  const rule = RULES[resource].view;
  if (!rule) return [];
  return [rule.all, rule.own, rule.shared, rule.won, rule.flat].filter(
    (k): k is string => k !== undefined,
  );
}

type KeyHolder = { permissionKeys: readonly string[]; membershipId: string };

const has = (ctx: KeyHolder, key: string | undefined) =>
  key !== undefined && ctx.permissionKeys.includes(key);

function grant(
  ctx: KeyHolder,
  rule: Rule | undefined,
  record: ScopedRecord | undefined,
): { scope: ScopeLevel; permission?: string } {
  if (!rule) return { scope: "none" };
  if (has(ctx, rule.all)) return { scope: "organisation", permission: rule.all };
  if (has(ctx, rule.flat)) return { scope: "organisation", permission: rule.flat };

  const owned =
    record === undefined
      ? true // no record: the list-level scope, "my records"
      : record.ownerMembershipId === ctx.membershipId;
  if (has(ctx, rule.own) && owned) return { scope: "own", permission: rule.own };

  const unassigned = record === undefined || !record.ownerMembershipId;
  if (has(ctx, rule.shared) && unassigned) {
    return { scope: "read-only", permission: rule.shared };
  }
  const won = record === undefined || record.outcome === "WON";
  if (has(ctx, rule.won) && won) return { scope: "read-only", permission: rule.won };

  return { scope: "none" };
}

/**
 * The one place that answers "what can this user do with this resource (or
 * this record)": `own`, `organisation`, `read-only` or `none`, with the
 * reason and whether the answer rests on a provisional departure.
 *
 * Without `record` it gives the list-level scope (what the pill on a list
 * shows). With a record it answers for that record: an owned lead is `own`,
 * somebody else's is `none` (the caller cannot see it), a won deal for a
 * won-only viewer is `read-only`, and so on. For `edit` and `archive`, a
 * caller who can view but not change gets `read-only`.
 */
export function resolveScope(
  ctx: KeyHolder,
  resource: ScopedResource,
  action: ScopedAction,
  record?: ScopedRecord,
): ScopeResolution {
  const rules = RULES[resource];
  const noun = resource === "communications" ? "communications" : resource;

  const view = grant(ctx, rules.view, record);
  if (action === "view") {
    return describe(view, `view ${noun}`, record === undefined);
  }

  if (view.scope === "none") {
    return {
      scope: "none",
      reason: `Your role cannot see this ${singular(noun)}.`,
      provisional: false,
      departure: null,
    };
  }
  const act = grant(ctx, rules[action], record);
  if (act.scope === "none") {
    const owned = has(ctx, rules[action]?.own);
    return {
      scope: "read-only",
      reason: owned
        ? `You can ${action} only the ${noun} you own.`
        : `Your role can view ${noun} but not ${action} them.`,
      provisional: view.permission ? departureForPermission(view.permission) !== undefined : false,
      departure: view.permission ? (departureForPermission(view.permission)?.id ?? null) : null,
    };
  }
  return describe(act, `${action} ${noun}`, record === undefined);
}

function singular(noun: string): string {
  return noun.endsWith("ies") ? noun.slice(0, -3) + "y" : noun.replace(/s$/, "");
}

function describe(
  result: { scope: ScopeLevel; permission?: string },
  what: string,
  listLevel: boolean,
): ScopeResolution {
  const departure = result.permission ? departureForPermission(result.permission) : undefined;
  const reasons: Record<ScopeLevel, string> = {
    organisation: `You can ${what} across the organisation.`,
    own: listLevel
      ? `You can ${what} that you own.`
      : `You can ${what}: it is yours.`,
    "read-only": `You can ${what} read-only.`,
    none: `Your role cannot ${what}.`,
  };
  return {
    scope: result.scope,
    reason: reasons[result.scope],
    provisional: departure !== undefined,
    departure: departure?.id ?? null,
  };
}

/** True when the caller may open the record at all (any scope except `none`). */
export function canView(
  ctx: KeyHolder,
  resource: ScopedResource,
  record?: ScopedRecord,
): boolean {
  return resolveScope(ctx, resource, "view", record).scope !== "none";
}

/** True when the role touches this resource at all, ignoring which records. */
export function canUseResource(ctx: KeyHolder, resource: ScopedResource): boolean {
  return canView(ctx, resource);
}

// ---------------------------------------------------------------------------
// Feature areas and their owners (S4 explained no-access)
// ---------------------------------------------------------------------------

/** Permission key -> catalogue area ("Leads", "Deals", ...). */
const AREA_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p.area]));

export function areaOfPermission(key: string): string | undefined {
  return AREA_BY_KEY.get(key);
}

/** Permission keys in an area, for "which roles own the page". */
export function permissionKeysInArea(area: string): string[] {
  return PERMISSIONS.filter((p) => p.area === area).map((p) => p.key);
}
