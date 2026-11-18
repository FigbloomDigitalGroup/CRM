import { execSync } from "node:child_process";
import "dotenv/config";
import { usePerfDatabase } from "../../scripts/perfDatabase";

/** Points the whole perf run at the scale database and makes sure it is migrated (a no-op once it is). */
export default async function perfSetup(): Promise<void> {
  usePerfDatabase();
  const env = { ...process.env };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx scripts/db-admin.ts grant-role", { stdio: "inherit", env });
}
