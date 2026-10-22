import { z } from "zod";

const ReleaseSchema = z.enum(["v1", "v1.1", "v2"]);

/** What a client needs to show or hide a feature (B0.07). */
export const FeatureSnapshotSchema = z.strictObject({
  release: ReleaseSchema,
  /** Every release flag and toggle resolved to on/off for this organization. */
  flags: z.record(z.string(), z.boolean()),
  toggles: z.array(
    z.strictObject({
      key: z.string(),
      description: z.string(),
      defaultValue: z.boolean(),
      minRelease: ReleaseSchema,
      savedValue: z.boolean().nullable(),
      enabled: z.boolean(),
      available: z.boolean(),
    }),
  ),
});

export const UpdateFeaturesBodySchema = z.object({
  toggles: z.record(z.string(), z.boolean()),
});
