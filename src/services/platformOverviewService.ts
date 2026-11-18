import { getPlatformDb } from "../db/platformClient";

/**
 * Operational counts for the platform screens (FIG-1135, B6.03). Reads only the
 * `platform_organization_counts` view through the platform database role:
 * numbers per organisation, never a customer record, a deal value, a payment
 * or any free text. The view lists its columns one by one, so a new tenant
 * column cannot leak through it.
 */
export interface OrganizationCounts {
  organizationId: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
  memberCount: number;
  activeMemberCount: number;
  companyCount: number;
  contactCount: number;
  leadCount: number;
  dealCount: number;
}

interface Row {
  organization_id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  member_count: bigint;
  active_member_count: bigint;
  company_count: bigint;
  contact_count: bigint;
  lead_count: bigint;
  deal_count: bigint;
}

export async function listOrganizationCounts(): Promise<OrganizationCounts[]> {
  const rows = await getPlatformDb().$queryRaw<Row[]>`
    SELECT organization_id, slug, name, status, created_at, member_count, active_member_count,
           company_count, contact_count, lead_count, deal_count
    FROM platform_organization_counts
    ORDER BY created_at, slug`;
  return rows.map((r) => ({
    organizationId: r.organization_id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    activeMemberCount: Number(r.active_member_count),
    companyCount: Number(r.company_count),
    contactCount: Number(r.contact_count),
    leadCount: Number(r.lead_count),
    dealCount: Number(r.deal_count),
  }));
}
