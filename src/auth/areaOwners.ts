import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "../../prisma/seedData";
import type { FeatureConfig } from "../lib/featureFlags";
import { roleIsAvailable } from "./permissions";

/**
 * Which roles own a feature area (FIG-1018, moved server side from the old
 * client-only PAGE_OWNER map). A role OWNS an area when it can do more than
 * look at it: it holds at least one permission in that area that is not a
 * plain `.view` key. "Leads" is therefore owned by Management and Sales;
 * Delivery, which can only look at won deals, does not own "Deals".
 *
 * Derived from the catalogue, so it can never drift from what the roles are
 * actually granted. A role whose feature flag is off in the organisation is
 * left out (Customer Support, until it is switched on).
 */
const AREA_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p.area]));

const isViewKey = (key: string) => /(^|\.)view(\.|$)/.test(key);

export function areaOfKey(key: string): string | undefined {
  return AREA_BY_KEY.get(key);
}

export function ownerRoleKeysForArea(area: string): string[] {
  const owners: string[] = [];
  const viewers: string[] = [];
  for (const role of ROLES) {
    const keys = ROLE_PERMISSIONS[role.key] ?? [];
    const inArea = keys.filter((k) => AREA_BY_KEY.get(k) === area);
    if (inArea.some((k) => !isViewKey(k))) owners.push(role.key);
    // For an area that is only ever looked at (Reporting, Audit), whoever sees
    // the whole organisation's view of it owns it; "own" views do not.
    else if (inArea.some((k) => !k.endsWith(".own"))) viewers.push(role.key);
  }
  return owners.length > 0 ? owners : viewers;
}

/** Role display names that own the areas the denied permission keys belong to. */
export function ownerRoleNamesForKeys(
  keys: readonly string[],
  config: FeatureConfig,
): string[] {
  const areas = new Set(
    keys.map((k) => AREA_BY_KEY.get(k)).filter((a): a is string => !!a),
  );
  const names = new Set<string>();
  for (const area of areas) {
    for (const roleKey of ownerRoleKeysForArea(area)) {
      if (!roleIsAvailable(roleKey, config)) continue;
      names.add(ROLES.find((r) => r.key === roleKey)!.name);
    }
  }
  return [...names].sort();
}
