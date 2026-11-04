/**
 * Creates the first platform admin invitation (FIG-1140, B6.08), or a recovery link when no platform admin can
 * sign in. Platform admins are never created by a migration or a seed: this is the only way in from nothing.
 *
 *   tsx scripts/platform-bootstrap-admin.ts <email> <name>
 *
 * Needs PLATFORM_DATABASE_URL (the figbloom_platform role). Prints a single-use link valid for seven days and
 * writes an entry to the platform audit log. The person opens it, chooses a password, signs in, and sets up
 * two-step; no session exists before that. Treat the printed link as a secret.
 */
import "dotenv/config";
import { issueOperatorLink } from "../src/services/platformAdminService";
import { getPlatformDb } from "../src/db/platformClient";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!email || !name) {
    console.error("Usage: tsx scripts/platform-bootstrap-admin.ts <email> <name>");
    process.exit(1);
  }
  const link = await issueOperatorLink(email, name);
  console.log(`${link.kind === "INVITE" ? "Invitation" : "Recovery link"} for ${link.email} (valid until ${link.expiresAt}):`);
  console.log(link.inviteUrl);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => getPlatformDb().$disconnect());
