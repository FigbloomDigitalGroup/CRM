/**
 * Release flags and organisation toggles, the pure part (FIG-1015, B0.07).
 * Nothing here touches the database; `src/services/featureService.ts` loads
 * an organization's saved values and calls into this.
 *
 * Two layers decide whether a feature is on for an organization:
 *
 *  1. Release flags `release.v1`, `release.v11`, `release.v2`. The active
 *     release comes from the `ACTIVE_RELEASE` environment variable (`v1`,
 *     `v1.1` or `v2`; default `v1`) and a flag is on when the active release
 *     is at least that one. An organization can be moved to a different
 *     release (a pilot customer ahead of the rest) by a platform operator.
 *  2. Organisation toggles (`TOGGLES`): named on/off switches with a default.
 *     A toggle only counts once the active release has reached the toggle's
 *     `minRelease`, so a V1.1 feature stays off in V1 whatever its toggle says.
 */
export const RELEASES = ["v1", "v1.1", "v2"] as const;
export type Release = (typeof RELEASES)[number];

export const RELEASE_LABEL: Record<Release, string> = {
  v1: "V1",
  "v1.1": "V1.1",
  v2: "V2",
};

export const RELEASE_FLAG_KEYS = {
  "release.v1": "v1",
  "release.v11": "v1.1",
  "release.v2": "v2",
} as const satisfies Record<string, Release>;
export type ReleaseFlagKey = keyof typeof RELEASE_FLAG_KEYS;

export interface ToggleDef {
  key: string;
  description: string;
  /** Used until the organization saves its own value. */
  defaultValue: boolean;
  /** The first release in which this toggle can be on at all. */
  minRelease: Release;
}

/** Every organisation-level toggle. Add a toggle here, then gate with `requireFeature`. */
export const TOGGLES: readonly ToggleDef[] = [
  {
    key: "integrations.enabled",
    description: "Integrations (click-to-chat, website capture) can be configured.",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "personalisation.allowed",
    description: "Members may choose their own theme and page colours.",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "permissions.provisional_departures",
    description:
      "The five signed departures from the permission matrix (won-only Delivery and Finance, Sales shared pool, Technical My work, Finance follow-up note, delivery handoff). Switch off to fall back to the seeded matrix.",
    defaultValue: true,
    minRelease: "v1",
  },
  // The five departures, one switch each (B1.03). Each is only effective
  // while the umbrella toggle above is also on.
  {
    key: "departure.won_only",
    description: "Delivery and Finance see won deals only (decision 1.2).",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "departure.shared_pool",
    description: "Sales sees a shared pool of unassigned leads and can claim from it (decision 1.3).",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "departure.technical_my_work",
    description: "Restricted Technical gets My work: tasks plus their client requirements (decision 1.4).",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "departure.finance_followup",
    description: "Finance adds a follow-up note on won deals instead of tasks (decision 1.5).",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "departure.handoff_permission",
    description: "The delivery-handoff permission: Sales and Management start, Delivery receives (decision 1.6).",
    defaultValue: true,
    minRelease: "v1",
  },
  {
    key: "assistant.enabled",
    description: "The Ask Figbloom assistant.",
    defaultValue: false,
    minRelease: "v1.1",
  },
  {
    key: "preferences.own_colours",
    description: "Members may set their own sidebar, accent, highlight and page colours (each checked for readability).",
    defaultValue: true,
    minRelease: "v1.1",
  },
  {
    key: "organisation.switcher",
    description: "The multi-organisation switcher.",
    defaultValue: true,
    minRelease: "v1.1",
  },
  {
    key: "quotes.enabled",
    description: "Quotes, approvals and forecast.",
    defaultValue: true,
    minRelease: "v1.1",
  },
  {
    key: "customer_support.role",
    description: "The Customer Support role (decision-gated).",
    defaultValue: false,
    minRelease: "v1.1",
  },
];

const TOGGLE_BY_KEY = new Map(TOGGLES.map((t) => [t.key, t]));

export function findToggle(key: string): ToggleDef | undefined {
  return TOGGLE_BY_KEY.get(key);
}

export function isKnownFeature(key: string): boolean {
  return key in RELEASE_FLAG_KEYS || TOGGLE_BY_KEY.has(key);
}

export function parseRelease(raw: string | null | undefined): Release | undefined {
  const value = raw?.trim().toLowerCase();
  return (RELEASES as readonly string[]).includes(value ?? "")
    ? (value as Release)
    : undefined;
}

/** The release this deployment is running; unset or unreadable means V1. */
export function globalRelease(env: NodeJS.ProcessEnv = process.env): Release {
  return parseRelease(env.ACTIVE_RELEASE) ?? "v1";
}

export function releaseAtLeast(active: Release, minimum: Release): boolean {
  return RELEASES.indexOf(active) >= RELEASES.indexOf(minimum);
}

export interface FeatureConfig {
  /** The organization's effective release (its override, else the deployment's). */
  release: Release;
  /** The organization's saved toggle values. */
  toggles: Record<string, boolean>;
}

export type FeatureReason = "release" | "toggle";

export interface FeatureResolution {
  enabled: boolean;
  /** Why it is off: the release has not reached it, or the organization switched it off. */
  reason?: FeatureReason;
  /** The release a feature that is off for `reason: "release"` arrives in. */
  availableIn?: Release;
}

export function resolveFeature(key: string, config: FeatureConfig): FeatureResolution {
  const releaseFlag = (RELEASE_FLAG_KEYS as Record<string, Release>)[key];
  if (releaseFlag) {
    return releaseAtLeast(config.release, releaseFlag)
      ? { enabled: true }
      : { enabled: false, reason: "release", availableIn: releaseFlag };
  }
  const toggle = TOGGLE_BY_KEY.get(key);
  if (!toggle) {
    // An unknown key is a coding error; fail closed.
    return { enabled: false, reason: "toggle" };
  }
  if (!releaseAtLeast(config.release, toggle.minRelease)) {
    return { enabled: false, reason: "release", availableIn: toggle.minRelease };
  }
  const value = config.toggles[key] ?? toggle.defaultValue;
  return value ? { enabled: true } : { enabled: false, reason: "toggle" };
}

/** Thrown by `requireFeature`; the route wrapper turns it into the explained "not available" response. */
export class FeatureUnavailableError extends Error {
  constructor(
    readonly feature: string,
    readonly reason: FeatureReason,
    readonly availableIn: Release | null,
  ) {
    super(
      reason === "release"
        ? `This feature is not available yet. It is planned for ${RELEASE_LABEL[availableIn ?? "v1.1"]}.`
        : "This feature is switched off for your organisation.",
    );
    this.name = "FeatureUnavailableError";
  }
}
