import { withOrgContext } from "../db/orgScopedClient";

export interface CreateCompanyServiceLinkInput {
  organizationId: string;
  companyId: string;
  serviceId: string;
  status?: "ACTIVE" | "COMPLETED" | "CANCELLED";
  startDate?: Date;
  endDate?: Date;
  notes?: string;
}

export async function createCompanyServiceLink(input: CreateCompanyServiceLinkInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.companyService.create({
      data: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        serviceId: input.serviceId,
        status: input.status,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes,
      },
      include: { service: true },
    }),
  );
}

/** companyId/serviceId are immutable once linked -- re-pointing a service record at a different company/service is "end this one, create another," not an edit. */
export interface UpdateCompanyServiceLinkInput {
  status?: "ACTIVE" | "COMPLETED" | "CANCELLED";
  startDate?: Date | null;
  endDate?: Date | null;
  notes?: string | null;
}

export async function updateCompanyServiceLink(
  organizationId: string,
  companyServiceId: string,
  input: UpdateCompanyServiceLinkInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.companyService.update({
      where: { id: companyServiceId, organizationId },
      data: input,
      include: { service: true },
    }),
  );
}

export async function getCompanyServiceLinkById(
  organizationId: string,
  companyServiceId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.companyService.findFirst({
      where: { id: companyServiceId, organizationId },
    }),
  );
}

export async function listCompanyServiceLinks(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.companyService.findMany({
      where: { organizationId, companyId },
      include: { service: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
  );
}
