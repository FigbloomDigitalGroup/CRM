import { adminDb } from "../db/adminClient";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

/**
 * Organization provisioning is a controlled platform/administrative
 * operation (FIG-437 section 13), not something an ordinary organization
 * member does — so this intentionally uses the admin client rather than
 * `withOrgContext` (there is no organization context yet).
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
