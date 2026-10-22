import { adminDb } from "../db/adminClient";
import { DEV_EMAIL_SUFFIX } from "./devAccounts";

/**
 * Production guard (3) for FIG-1196 / CLAUDE.md rule 10: the server must not
 * boot in production while any dev account exists. (The other two guards:
 * the dev seed refuses to run in production, and every dev sign-in route and
 * page is closed unless `devAccountsAllowed()`.)
 *
 * A dev account is a tenant user whose email ends `@figbloom.local`, or a
 * platform identity flagged `isDev`.
 */
type Env = Record<string, string | undefined>;

export interface DevAccountCount {
  users: number;
  platformIdentities: number;
}

export async function countDevAccounts(): Promise<DevAccountCount> {
  const [users, platformIdentities] = await Promise.all([
    adminDb.user.count({ where: { email: { endsWith: DEV_EMAIL_SUFFIX } } }),
    adminDb.platformIdentity.count({ where: { isDev: true } }),
  ]);
  return { users, platformIdentities };
}

export function devAccountsPresentMessage(found: DevAccountCount) {
  return (
    `Refusing to start in production: ${found.users} dev user(s) ` +
    `(*${DEV_EMAIL_SUFFIX}) and ${found.platformIdentities} dev platform identity(ies) exist in this database. ` +
    "Dev accounts must never exist in production. Remove them (delete the users whose email ends " +
    `${DEV_EMAIL_SUFFIX} and the platform identities with is_dev = true), or point the app at the right database.`
  );
}

/**
 * Throws, with a clear message, when `NODE_ENV=production` and a dev account
 * exists; does nothing outside production. If the database cannot be asked it
 * also refuses (fail closed): a guard that passes when it cannot check is not
 * a guard.
 *
 * The one override is for the end-to-end suite, which drives the production
 * build against a seeded development database: it needs BOTH
 * `E2E_ALLOW_DEV_ACCOUNTS=true` and `ALLOW_DEV_ACCOUNTS=true`
 * (`playwright.config.ts` sets the first for its own server only). Nothing
 * else sets it.
 */
export async function assertNoDevAccountsInProduction(
  options: { env?: Env; count?: () => Promise<DevAccountCount> } = {},
) {
  const env = options.env ?? process.env;
  if (env.NODE_ENV !== "production") return;
  if (env.E2E_ALLOW_DEV_ACCOUNTS === "true" && env.ALLOW_DEV_ACCOUNTS === "true") {
    return;
  }

  let found: DevAccountCount;
  try {
    found = await (options.count ?? countDevAccounts)();
  } catch (err) {
    throw new Error(
      "Refusing to start in production: could not check whether dev accounts exist " +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (found.users > 0 || found.platformIdentities > 0) {
    throw new Error(devAccountsPresentMessage(found));
  }
}

/**
 * The boot-time entry point (`src/instrumentation.ts`): runs the check and, if
 * it fails, logs the reason and exits the process. A throw alone would leave
 * `next start` listening and answering every request with a 500; exiting makes
 * an orchestrator see a crash instead of a server that is merely unhealthy.
 * Kept here, not in instrumentation.ts, so the Node-only `process.exit` stays
 * out of that file's edge-compatible analysis.
 */
export async function enforceNoDevAccountsInProduction(
  options: Parameters<typeof assertNoDevAccountsInProduction>[0] & {
    exit?: (code: number) => void;
  } = {},
) {
  try {
    await assertNoDevAccountsInProduction(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    (options.exit ?? process.exit)(1);
  }
}
