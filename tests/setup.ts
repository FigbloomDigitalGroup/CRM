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
