/**
 * Staging seed (FIG-1123, P1.01). Full runbook: docs/STAGING.md.
 *
 *   STAGING_UAT_PASSWORD=<from the secret store> tsx scripts/staging-seed.ts
 *
 * What staging has that development does not, and why (CLAUDE.md rule 10):
 *   - NO dev accounts, NO Dev Super Admin, NO dev sign-in chips. Staging runs the production image with NODE_ENV=production,
 *     where the boot guard refuses to start if a `@figbloom.local` user or a dev platform identity exists. So `npm run seed:dev`
 *     is never run on staging, and this script refuses when ALLOW_DEV_ACCOUNTS=true.
 *   - Instead, a small fixed set of UAT sign-ins, one per role, on the ordinary password login. Their password comes from
 *     `STAGING_UAT_PASSWORD` (a secret held by Given, never in git). They are ordinary users with ordinary memberships.
 *
 * Order on a staging database: migrate and grant, `npm run seed` (role catalogue), data (refresh, then
 * `staging-refresh.ts anonymise`), then this script. Idempotent: running it again resets the UAT password and nothing else.
 * If the organisation does not exist yet (an empty staging database) it is created with the default catalogues.
 */
import "dotenv/config";
import { hashPassword } from "../src/auth/password";
import { adminDb } from "../src/db/adminClient";
import { seedOrganizationDefaults } from "../src/services/organizationDefaults";
import { assertStagingEnvironment, UAT_ROLES, uatEmail } from "./stagingGuard";

async function main() {
  assertStagingEnvironment();
  const password = process.env.STAGING_UAT_PASSWORD;
  if (!password || password.length < 14) {
    throw new Error("Set STAGING_UAT_PASSWORD (at least 14 characters, from the secret store; never commit it).");
  }
  const slug = process.env.STAGING_ORG_SLUG ?? "figbloom";
  const passwordHash = await hashPassword(password);

  let org = await adminDb.organization.findUnique({ where: { slug } });
  if (!org) {
    org = await adminDb.organization.create({ data: { name: process.env.STAGING_ORG_NAME ?? "Figbloom Staging", slug } });
    await seedOrganizationDefaults(org.id);
    console.log(`Created organisation "${slug}" with the default catalogues.`);
  }

  for (const roleKey of UAT_ROLES) {
    const role = await adminDb.role.findFirst({ where: { key: roleKey } });
    if (!role) throw new Error(`Role ${roleKey} not found. Run "npm run seed" first.`);
    const email = uatEmail(roleKey);
    const user = await adminDb.user.upsert({
      where: { email },
      update: { passwordHash, status: "ACTIVE", failedSignInCount: 0, lockedUntil: null },
      create: { email, name: `UAT ${roleKey.replace(/_/g, " ").toLowerCase()}`, passwordHash },
    });
    await adminDb.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { roleId: role.id, status: "ACTIVE" },
      create: { organizationId: org.id, userId: user.id, roleId: role.id, status: "ACTIVE", joinedAt: new Date() },
    });
    console.log(`UAT sign-in ready: ${email} (${roleKey})`);
  }
}

if (process.argv[1] && /staging-seed/.test(process.argv[1])) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : "staging seed failed");
      process.exit(1);
    })
    .finally(() => adminDb.$disconnect());
}
