import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SalesDraftInvoicesEditor } from "../../../src/ui/screens/settingsplus/SalesDraftInvoices";
import { renderScreen, stubClient } from "../screens/deals/harness";
import type { Handler } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const SETTINGS = { requireForProposalSent: false, validityDays: 30, defaultTerms: "Terms", salesDraftInvoices: false };
const handlers = (over: Record<string, Handler> = {}): Record<string, Handler> => ({ getQuoteSettings: () => SETTINGS, patchQuoteSettings: () => SETTINGS, ...over });

describe("Sales draft invoices setting (UC-R10)", () => {
  it("is off by default and saves the switch through the quote settings route", async () => {
    const bodies: unknown[] = [];
    const { client } = stubClient(handlers({ patchQuoteSettings: ({ body }) => (bodies.push(body), SETTINGS) }));
    renderScreen(<SalesDraftInvoicesEditor />, client, { permissionKeys: ["configuration.manage"], roleName: "Management" });
    const sw = await screen.findByRole("switch", { name: "Let Sales create draft invoices" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(screen.getByText(/never sees payments, balances or overdue state, and cannot send/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toEqual([{ salesDraftInvoices: true }]));
  });

  it("is read-only without configuration.manage", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<SalesDraftInvoicesEditor />, client, { permissionKeys: [], roleName: "Finance" });
    expect(await screen.findByRole("switch", { name: "Let Sales create draft invoices" })).toBeDisabled();
    expect(screen.getByText("Only Management changes this setting")).toBeInTheDocument();
  });
});
