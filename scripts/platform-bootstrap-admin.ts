/**
 * One-time bootstrap of the first platform admin (FIG-1140, B6.08; MVP-10). Platform admins are never created by a
 * migration or a seed: this is the only way in from an empty database. See docs/PLATFORM_BOOTSTRAP.md.
 *
 *   tsx scripts/platform-bootstrap-admin.ts <email> <name> [--force]
 *
 * Needs PLATFORM_DATABASE_URL (the figbloom_platform role) and DATABASE_URL (to check for dev accounts). It creates no
 * account and sets no password: it prints a single-use link valid for seven days and writes an entry to the platform audit
 * log. The person opens it, chooses a password, signs in, and enrols two-step; no session exists before that. Treat the
 * printed link as a secret: it is shown once, only here, and never logged by the app.
 *
 * Refuses when a platform admin already exists. `--force` then issues a recovery link (existing email) or an extra
 * invitation (new email); use it only if every admin is locked out.
 */
import "dotenv/config";
import { bootstrapFirstPlatformAdmin } from "../src/services/platformBootstrapService";
import { getPlatformDb } from "../src/db/platformClient";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const [email, ...nameParts] = args.filter((a) => a !== "--force");
  const name = nameParts.join(" ").trim();
  if (!email || !name) {
    console.error("Usage: tsx scripts/platform-bootstrap-admin.ts <email> <name> [--force]");
    process.exit(1);
  }
  const link = await bootstrapFirstPlatformAdmin({ email, name, force });
  console.log(`${link.kind === "INVITE" ? "Invitation" : "Recovery link"} for ${link.email} (valid until ${link.expiresAt}):`);
  console.log(link.inviteUrl);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPlatformDb().$disconnect());
