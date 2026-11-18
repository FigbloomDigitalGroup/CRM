import "dotenv/config";

// Safety net: globalSetup.ts already points DATABASE_URL/APP_DATABASE_URL at
// the test database before any worker starts, but every test file re-asserts
// it here too, before importing any Prisma client module, in case a future
// change reintroduces per-file env isolation.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (process.env.TEST_APP_DATABASE_URL) {
  process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL;
}

// FIG-1135: the platform role's connection, the same way (derived from the test
// database when TEST_PLATFORM_DATABASE_URL is not set; see tests/globalSetup.ts).
if (process.env.TEST_PLATFORM_DATABASE_URL) {
  process.env.PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
} else if (process.env.TEST_DATABASE_URL) {
  const platformUrl = new URL(process.env.TEST_DATABASE_URL);
  platformUrl.username = "figbloom_platform";
  platformUrl.password = process.env.PLATFORM_DB_PASSWORD ?? "figbloom_platform_local_dev_only";
  process.env.PLATFORM_DATABASE_URL = platformUrl.toString();
}
