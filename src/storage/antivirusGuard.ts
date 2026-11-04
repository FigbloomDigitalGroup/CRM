/**
 * Production guard for the antivirus (FIG-1257, open item in docs/SECURITY_REVIEW_V1.md and finding S-01 in
 * docs/SECURITY_SIGNOFF_V1.md): without `CLAMD_HOST` only the built-in test-file detector runs, so real malware
 * would be called clean. A deployment that says it is production must therefore not boot without it.
 *
 * "Production" here is `NODE_ENV=production` AND `FIGBLOOM_ENVIRONMENT=production` (docs/STAGING.md: staging
 * sets "staging", production sets "production"). Requiring the second marker keeps local production-mode runs
 * (the preview build, the CI Docker check, the end-to-end suite) from needing a ClamAV daemon.
 */
type Env = Record<string, string | undefined>;

export const ANTIVIRUS_MISSING_MESSAGE =
  "Refusing to start in production: CLAMD_HOST is not set, so uploaded files would only be checked by the built-in test-file detector. " +
  "Set CLAMD_HOST (and CLAMD_PORT) to the production ClamAV daemon. See docs/STORAGE.md.";

/** Throws when this is a production deployment without a ClamAV host; does nothing anywhere else. */
export function assertAntivirusConfigured(env: Env = process.env) {
  if (env.NODE_ENV !== "production" || env.FIGBLOOM_ENVIRONMENT !== "production") return;
  if (!env.CLAMD_HOST?.trim()) throw new Error(ANTIVIRUS_MISSING_MESSAGE);
}

/**
 * The boot-time entry point (`src/instrumentation.ts`): logs the reason and exits, so an orchestrator sees a crash
 * rather than a server that answers every request with a 500 (same reasoning as `enforceNoDevAccountsInProduction`).
 */
export function enforceAntivirusInProduction(options: { env?: Env; exit?: (code: number) => void } = {}) {
  try {
    assertAntivirusConfigured(options.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    (options.exit ?? process.exit)(1);
  }
}
