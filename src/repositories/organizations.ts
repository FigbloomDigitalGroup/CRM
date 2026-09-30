import { adminDb } from "../db/adminClient";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

/**
 * Provisioning is a platform/admin operation, not something an ordinary
 * member does, so it uses the admin client -- there's no org context yet
 * for `withOrgContext` to run against.
 */
export async function createOrganization(input: CreateOrganizationInput) {
  return adminDb.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
    },
  });
}

export async function getOrganizationBySlug(slug: string) {
  return adminDb.organization.findUnique({ where: { slug } });
}
