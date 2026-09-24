import "dotenv/config";
import { adminDb } from "../src/db/adminClient";
import { seedOrganizationDefaults } from "../src/services/organizationDefaults";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "./seedData";

/**
 * FIG-438 deterministic V1 seed. Every write is an upsert keyed on a stable
 * natural key, so this script is safe to run repeatedly (section 15).
 */
async function seedRolesAndPermissions() {
  for (const role of ROLES) {
    await adminDb.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  for (const permission of PERMISSIONS) {
    await adminDb.permission.upsert({
      where: { key: permission.key },
      update: { area: permission.area, description: permission.description },
      create: permission,
    });
  }

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await adminDb.role.findUniqueOrThrow({
      where: { key: roleKey },
    });
    for (const permissionKey of permissionKeys) {
      const permission = await adminDb.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await adminDb.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  console.log(
    `Seeded ${ROLES.length} roles, ${PERMISSIONS.length} permissions.`,
  );
}

/**
 * Creates FigBloom's own internal organization for local development, plus
 * one membership per V1 role for exercising the app locally. These are
 * clearly-synthetic internal *user* fixtures (dev.sales@figbloom.local,
 * etc.) -- not fabricated customer/business data, which this seed
 * deliberately does not create (section 15: "Do not create fake business
 * data that could be mistaken for real customer data").
 */
async function seedDevFigBloomOrganization() {
  const organization = await adminDb.organization.upsert({
    where: { slug: "figbloom" },
    update: {},
    create: { name: "FigBloom Digital Group", slug: "figbloom" },
  });

  await seedOrganizationDefaults(organization.id);

  const devUsers: { email: string; name: string; roleKey: string }[] = [
    {
      email: "dev.management@figbloom.local",
      name: "Dev Management",
      roleKey: "MANAGEMENT",
    },
    { email: "dev.sales@figbloom.local", name: "Dev Sales", roleKey: "SALES" },
    {
      email: "dev.delivery@figbloom.local",
      name: "Dev Delivery",
      roleKey: "DELIVERY",
    },
    {
      email: "dev.finance@figbloom.local",
      name: "Dev Finance",
      roleKey: "FINANCE",
    },
    {
      email: "dev.tech@figbloom.local",
      name: "Dev Restricted Technical",
      roleKey: "RESTRICTED_TECHNICAL",
    },
  ];

  for (const devUser of devUsers) {
    const user = await adminDb.user.upsert({
      where: { email: devUser.email },
      update: { name: devUser.name },
      create: { email: devUser.email, name: devUser.name },
    });

    const role = await adminDb.role.findUniqueOrThrow({
      where: { key: devUser.roleKey },
    });

    await adminDb.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: { roleId: role.id },
      create: {
        organizationId: organization.id,
        userId: user.id,
        roleId: role.id,
        joinedAt: new Date(),
      },
    });
  }

  console.log(
    `Seeded development organization "${organization.slug}" with ${devUsers.length} member fixtures.`,
  );
}

async function main() {
  await seedRolesAndPermissions();
  await seedDevFigBloomOrganization();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await adminDb.$disconnect();
  });
