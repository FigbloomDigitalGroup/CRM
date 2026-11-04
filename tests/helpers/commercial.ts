import { adminDb } from "../../src/db/adminClient";
import { createTestOrganization } from "./fixtures";

/** A test organisation moved to release V1.1, so the quote, catalogue and approval permissions carry weight (PERMISSION_MIN_RELEASE). */
export async function createV11Organization(prefix = "Commercial Org") {
  const org = await createTestOrganization(prefix);
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: org.id, key: "release_override" } },
    update: { value: { release: "v1.1" } },
    create: { organizationId: org.id, key: "release_override", value: { release: "v1.1" } },
  });
  return org;
}
