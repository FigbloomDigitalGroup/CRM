/**
 * Tells the Figbloom platform where to send the console's decisions for CRM organisations
 * (ERP/CRM_PLATFORM_CONTRACT.md): <APP_BASE_URL>/api/platform/decisions. Run once per environment, and again if the
 * address changes. `--off` stops decisions (they wait on the platform).
 *
 *   npx tsx scripts/register-platform-webhook.ts
 */
import "dotenv/config";
import { platformClient } from "../src/auth/figbloom/platformClient";

async function main() {
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new Error("APP_BASE_URL must be CRM's https address.");
  const url = process.argv.includes("--off") ? null : `${base}/api/platform/decisions`;
  await platformClient().putDecisionWebhook(url);
  console.log(url ? `Decisions for CRM go to ${url}` : "Decisions for CRM are stopped (they wait on the platform).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
