import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { seedRolesAndPermissions } from "./seedReference";

/**
 * The production-safe seed (FIG-1016, B0.08): reference data only -- the
 * role and permission catalogue. It creates no organization, no user and no
 * sample data, so it is the same command in every environment. Per-
 * organization catalogues (stages, statuses, sources, lost reasons,
 * services, lifecycle states) are created with each organization.
 *
 * Local development and demos use `npm run seed:dev` (`prisma/seedDev.ts`),
 * which adds the dev organizations, the dev accounts and the sample data
 * and refuses to run in production.
 */
async function main() {
  await seedRolesAndPermissions();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await adminDb.$disconnect();
  });
