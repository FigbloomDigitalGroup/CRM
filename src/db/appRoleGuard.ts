/**
 * Production guard for the application database role (rollback dry run, 4 Nov 2026): the app must run as the
 * least-privilege `figbloom_app` role, the one row-level security restricts. When `APP_DATABASE_URL` is missing Prisma
 * silently falls back to the owner login (`DATABASE_URL`), so a deployment that says it is staging or production must
 * not boot without it.
 *
 * "Deployment" here is `NODE_ENV=production` AND `FIGBLOOM_ENVIRONMENT` of `staging` or `production`
 * (docs/STAGING.md), so local production-mode runs (the preview build, the CI Docker check, the end-to-end suite)
 * are not affected.
 */
type Env = Record<string, string | undefined>;

export const APP_ROLE_URL_MISSING_MESSAGE =
  "Refusing to start: APP_DATABASE_URL is not set, so the app would connect as the database owner instead of the " +
  "least-privilege application role (figbloom_app). Set APP_DATABASE_URL. See docs/DEPLOYMENT.md.";

/** Throws when this is a staging or production deployment without `APP_DATABASE_URL`; does nothing anywhere else. */
export function assertAppDatabaseUrlConfigured(env: Env = process.env) {
  if (env.NODE_ENV !== "production") return;
  if (env.FIGBLOOM_ENVIRONMENT !== "production" && env.FIGBLOOM_ENVIRONMENT !== "staging") return;
  if (!env.APP_DATABASE_URL?.trim()) throw new Error(APP_ROLE_URL_MISSING_MESSAGE);
}

/** Boot-time entry point (`src/instrumentation.ts`): logs the reason and exits, like the other production guards. */
export function enforceAppDatabaseUrl(options: { env?: Env; exit?: (code: number) => void } = {}) {
  try {
    assertAppDatabaseUrlConfigured(options.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    (options.exit ?? process.exit)(1);
  }
}
