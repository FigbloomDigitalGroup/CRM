import { countDevAccounts } from "../auth/devAccountGuard";
import { ValidationError } from "../auth/errors";
import { getPlatformDb } from "../db/platformClient";
import { issueOperatorLink } from "./platformAdminService";

/**
 * MVP-10: the one-time way into an EMPTY production database (docs/PLATFORM_BOOTSTRAP.md).
 *
 * It creates no account. It issues the first platform admin invitation (a single-use link, seven days); the identity exists
 * only once the person opens the link and chooses a password, and two-step enrolment follows at first sign-in. It never
 * runs the dev seed, never creates a dev account, and refuses when:
 *  - a platform admin already exists (unless `force`, which issues an additional invitation or a recovery link), or
 *  - production already holds a dev account (the server would refuse to boot anyway), or
 *  - production has no `APP_BASE_URL` (the link would point at localhost).
 */
export interface BootstrapOptions {
  email: string;
  name: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
}

export async function bootstrapFirstPlatformAdmin(options: BootstrapOptions) {
  const env = options.env ?? process.env;
  const email = options.email.trim().toLowerCase();
  const name = options.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  if (!name) throw new ValidationError("A name is required.");

  if (env.NODE_ENV === "production") {
    if (!env.APP_BASE_URL?.trim()) {
      throw new ValidationError("APP_BASE_URL is not set: the set-up link would point at localhost. Set it to the public https address first.");
    }
    const dev = await countDevAccounts();
    if (dev.users + dev.platformIdentities > 0) {
      throw new ValidationError("This production database holds dev accounts. Remove them first (see docs/PLATFORM_BOOTSTRAP.md); the server would refuse to start.");
    }
  }

  const existing = await getPlatformDb().platformIdentity.count({ where: { isDev: false } });
  if (existing > 0 && !options.force) {
    throw new ValidationError(
      `${existing} platform admin(s) already exist: bootstrap is a one-time step. Sign in to the console to invite more admins, or re-run with --force to issue a recovery link.`,
    );
  }
  return issueOperatorLink(email, name);
}
