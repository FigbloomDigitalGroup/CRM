import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewDealDrawer } from "../../../../src/ui/screens/deals/NewDealDrawer";
import { STAGES, page, renderScreen, stubClient } from "./harness";

const REFERENCE = { stages: STAGES, services: [] };

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/deals",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const COMPANIES = [
  { id: "co-1", name: "Acacia Foods" },
  { id: "co-2", name: "Savannah Hotels" },
];

describe("New deal: company picker", () => {
  it("searches companies on the server a small page at a time and creates the deal with the chosen one", async () => {
    const stub = stubClient({
      getCompanies: (a) => page(a.query?.q ? COMPANIES.filter((c) => c.name.toLowerCase().includes(String(a.query!.q).toLowerCase())) : COMPANIES),
      postDeals: () => ({ id: "d-new" }),
    });
    renderScreen(<NewDealDrawer ref_={REFERENCE as never} onClose={() => {}} />, stub.client, { permissionKeys: ["deals.create", "companies.view"] });

    const box = await screen.findByRole("combobox", { name: /Company/ });
    await waitFor(() => expect(stub.calls.some((c) => c.id === "getCompanies")).toBe(true));
    // Never the whole directory: a small page, from the first request on.
    expect(stub.calls.find((c) => c.id === "getCompanies")!.args.query).toMatchObject({ pageSize: "20" });

    await userEvent.click(box);
    await userEvent.type(box, "sav");
    await waitFor(() => expect(stub.calls.some((c) => c.id === "getCompanies" && c.args.query?.q === "sav")).toBe(true));
    await userEvent.click(await screen.findByRole("option", { name: "Savannah Hotels" }));
    expect(box).toHaveValue("Savannah Hotels");

    await userEvent.click(screen.getByRole("button", { name: "Create deal" }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "postDeals")?.args.body).toMatchObject({ companyId: "co-2" }));
  });

  it("cannot create a deal until a company is chosen", async () => {
    const stub = stubClient({ getCompanies: () => page(COMPANIES) });
    renderScreen(<NewDealDrawer ref_={REFERENCE as never} onClose={() => {}} />, stub.client, { permissionKeys: ["deals.create"] });
    await screen.findByRole("combobox", { name: /Company/ });
    expect(screen.getByRole("button", { name: "Create deal" })).toBeDisabled();
  });
});
