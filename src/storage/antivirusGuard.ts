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
  "Set CLAMD_HOST (and CLAMD_PORT) to the production ClamAV daemon, or accept the risk in writing and set ANTIVIRUS_MODE=builtin-only. See docs/STORAGE.md.";

/**
 * The explicit, written-risk-acceptance opt-out (MVP on Vercel, docs/DECISIONS.md section 7): `ANTIVIRUS_MODE=builtin-only`
 * lets a production deployment boot without a ClamAV host, so uploads get only the built-in file-type checks and the
 * EICAR test detector. Any other value (or none) keeps the default: production refuses to boot without CLAMD_HOST.
 */
export const ANTIVIRUS_OPT_OUT_MODE = "builtin-only";

export const ANTIVIRUS_OPT_OUT_WARNING =
  "WARNING: ANTIVIRUS_MODE=builtin-only is active in production. Uploaded files are NOT scanned for malware; only built-in file-type " +
  "checks and the EICAR test detector run. This is an accepted, time-limited risk (docs/DECISIONS.md section 7). Set CLAMD_HOST and remove ANTIVIRUS_MODE as soon as a ClamAV host exists.";

function optedOut(env: Env) {
  return env.ANTIVIRUS_MODE?.trim().toLowerCase() === ANTIVIRUS_OPT_OUT_MODE;
}

/** Throws when this is a production deployment without a ClamAV host (and without the explicit opt-out); does nothing anywhere else. */
export function assertAntivirusConfigured(env: Env = process.env) {
  if (env.NODE_ENV !== "production" || env.FIGBLOOM_ENVIRONMENT !== "production") return;
  if (env.CLAMD_HOST?.trim()) return;
  if (optedOut(env)) return;
  throw new Error(ANTIVIRUS_MISSING_MESSAGE);
}

/**
 * The boot-time entry point (`src/instrumentation.ts`): logs the reason and exits, so an orchestrator sees a crash
 * rather than a server that answers every request with a 500 (same reasoning as `enforceNoDevAccountsInProduction`).
 */
export function enforceAntivirusInProduction(options: { env?: Env; exit?: (code: number) => void } = {}) {
  const env = options.env ?? process.env;
  try {
    assertAntivirusConfigured(env);
    if (env.NODE_ENV === "production" && env.FIGBLOOM_ENVIRONMENT === "production" && !env.CLAMD_HOST?.trim() && optedOut(env)) {
      console.warn(ANTIVIRUS_OPT_OUT_WARNING);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    (options.exit ?? process.exit)(1);
  }
}
