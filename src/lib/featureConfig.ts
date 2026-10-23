import { adminDb } from "../db/adminClient";
import {
  globalRelease,
  parseRelease,
  type FeatureConfig,
} from "./featureFlags";

export const TOGGLES_KEY = "feature_toggles";
export const RELEASE_KEY = "release_override";

/**
 * The organization's effective release and saved toggle values. Lives apart
 * from `featureService` so the membership lookup (which every request goes
 * through) can read it without importing a service.
 */
export async function loadFeatureConfig(organizationId: string): Promise<FeatureConfig> {
  const rows = await adminDb.organizationSetting.findMany({
    where: { organizationId, key: { in: [TOGGLES_KEY, RELEASE_KEY] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const rawToggles = byKey.get(TOGGLES_KEY);
  const toggles: Record<string, boolean> = {};
  if (rawToggles && typeof rawToggles === "object" && !Array.isArray(rawToggles)) {
    for (const [key, value] of Object.entries(rawToggles)) {
      if (typeof value === "boolean") toggles[key] = value;
    }
  }
  const override = byKey.get(RELEASE_KEY) as { release?: string } | null | undefined;
  return {
    release: parseRelease(override?.release) ?? globalRelease(),
    toggles,
  };
}
