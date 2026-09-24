/**
 * Manual dev helper (not part of any npm script): adds a second SALES-role
 * dev user to the seeded FigBloom organization. `prisma/seed.ts` only
 * creates one user per V1 role, which is fine for exercising each role's
 * permissions individually but not for manually verifying *ownership*
 * boundaries between two peers with the same role (e.g. "Sales A cannot
 * see Sales B's leads") through the running app in a browser/curl. Run
 * with: `npx tsx scripts/manual-add-second-sales-user.ts`.
 */
import "dotenv/config";
import { adminDb } from "../src/db/adminClient";

async function main() {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { slug: "figbloom" },
  });
  const role = await adminDb.role.findUniqueOrThrow({
    where: { key: "SALES" },
  });

  const user = await adminDb.user.upsert({
    where: { email: "dev.sales2@figbloom.local" },
    update: {},
    create: { email: "dev.sales2@figbloom.local", name: "Dev Sales Two" },
  });

  await adminDb.membership.upsert({
    where: {
      organizationId_userId: { organizationId: org.id, userId: user.id },
    },
    update: {},
    create: {
      organizationId: org.id,
      userId: user.id,
      roleId: role.id,
      joinedAt: new Date(),
    },
  });

  console.log("OK", user.email);
}

main().finally(() => adminDb.$disconnect());
