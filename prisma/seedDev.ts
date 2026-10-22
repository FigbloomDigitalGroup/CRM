import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { runDevSeed } from "./devSeed";

/**
 * `npm run seed:dev` (FIG-1016, B0.08): the development and demo seed. See
 * `prisma/devSeed.ts` for what it creates and why it refuses to run in
 * production.
 */
runDevSeed()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await adminDb.$disconnect();
  });
