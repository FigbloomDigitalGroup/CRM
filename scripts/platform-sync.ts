/**
 * Sends what's still waiting for the Figbloom platform (ERP/CRM_PLATFORM_CONTRACT.md): organisations whose
 * registration failed earlier are retried with backoff. Run every 15 minutes with the notifications sweep (Figbloom's
 * AWS schedule). Does nothing while PLATFORM_LINK_ENABLED is off.
 *
 *   npm run platform:sync
 */
import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { runPlatformSync } from "../src/services/platformLinkService";

runPlatformSync()
  .then((r) => {
    console.log(r.skipped ? "Platform sync: off, or another run is going." : `Platform sync: ${r.sent} sent, ${r.failed} still waiting.`);
    process.exitCode = r.failed ? 1 : 0;
  })
  .catch((err) => {
    console.error("Platform sync failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => adminDb.$disconnect());
