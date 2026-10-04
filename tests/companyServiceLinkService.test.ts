import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import { createCompany } from "../src/services/companyService";
import * as companyServiceLinkService from "../src/services/companyServiceLinkService";
import {
  createTestContext,
  createTestOrganization,
  getServiceId,
} from "./helpers/fixtures";

describe("companyServiceLinkService", () => {
  it("rejects adding a service for a role without company_services.manage", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });
    const serviceId = await getServiceId(org.id);
    const techCtx = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");

    await expect(
      companyServiceLinkService.addCompanyService(techCtx, { companyId: company.id, serviceId }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("adds a service, defaulting to ACTIVE, and lists it with the catalog name included", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });
    const serviceId = await getServiceId(org.id);

    await companyServiceLinkService.addCompanyService(ctx, {
      companyId: company.id,
      serviceId,
      startDate: "2026-01-15",
    });

    const list = await companyServiceLinkService.listCompanyServices(ctx, company.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("ACTIVE");
    expect(list[0]!.service.id).toBe(serviceId);
    expect(list[0]!.startDate?.toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("updates status/end date, and rejects an unknown id", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });
    const serviceId = await getServiceId(org.id);

    const created = await companyServiceLinkService.addCompanyService(ctx, {
      companyId: company.id,
      serviceId,
    });

    const updated = await companyServiceLinkService.updateCompanyService(ctx, created.id, {
      status: "COMPLETED",
      endDate: "2026-06-01",
    });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.endDate?.toISOString().slice(0, 10)).toBe("2026-06-01");

    await expect(
      companyServiceLinkService.updateCompanyService(
        ctx,
        "00000000-0000-0000-0000-000000000000",
        { status: "CANCELLED" },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("does not leak a company_services.view-only caller into managing (no company_services.manage)", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });
    const serviceId = await getServiceId(org.id);
    const financeCtx = await createTestContext(org.id, "FINANCE", "finance");

    // Finance has company_services.view but not .manage.
    const list = await companyServiceLinkService.listCompanyServices(financeCtx, company.id);
    expect(list).toEqual([]);

    await expect(
      companyServiceLinkService.addCompanyService(financeCtx, { companyId: company.id, serviceId }),
    ).rejects.toThrow(ForbiddenError);
  });
});
