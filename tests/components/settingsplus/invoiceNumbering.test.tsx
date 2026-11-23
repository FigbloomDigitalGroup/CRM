import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InvoiceNumberingEditor } from "../../../src/ui/screens/settingsplus/InvoiceNumbering";
import { apiError, renderScreen, stubClient } from "../screens/deals/harness";
import type { Handler } from "../screens/deals/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/settings", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const SETTINGS = { requireForProposalSent: false, validityDays: 30, defaultTerms: "Terms", invoiceNumbering: { auto: false, prefix: "INV-" } };

function handlers(over: Record<string, Handler> = {}): Record<string, Handler> {
  return { getQuoteSettings: () => SETTINGS, patchQuoteSettings: () => SETTINGS, ...over };
}

describe("Invoice numbering settings (UC-R8)", () => {
  it("saves auto-numbering and the prefix through the quote settings route, and says existing invoices keep their numbers", async () => {
    const bodies: unknown[] = [];
    const { client } = stubClient(handlers({ patchQuoteSettings: ({ body }) => (bodies.push(body), SETTINGS) }));
    renderScreen(<InvoiceNumberingEditor />, client, { permissionKeys: ["configuration.manage"], roleName: "Management" });
    await userEvent.click(await screen.findByRole("switch", { name: "Number new invoices automatically" }));
    const prefix = screen.getByLabelText("Invoice number prefix");
    await userEvent.clear(prefix);
    await userEvent.type(prefix, "FB-");
    expect(screen.getByText(/Invoices that already exist keep their numbers/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    // The change is confirmed in a dialog that lists its effect.
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toEqual([{ invoiceNumbering: { auto: true, prefix: "FB-" } }]));
  });

  it("does not offer a save for an unusable prefix", async () => {
    const { client, calls } = stubClient(handlers());
    renderScreen(<InvoiceNumberingEditor />, client, { permissionKeys: ["configuration.manage"], roleName: "Management" });
    const prefix = await screen.findByLabelText("Invoice number prefix");
    await userEvent.clear(prefix);
    await userEvent.type(prefix, "a b");
    expect(screen.getByText(/letters, digits and - _ \. \/ only/)).toBeInTheDocument();
    expect(calls.some((c) => c.id === "patchQuoteSettings")).toBe(false);
  });

  it("is read-only without configuration.manage", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<InvoiceNumberingEditor />, client, { permissionKeys: [], roleName: "Finance" });
    expect(await screen.findByLabelText("Invoice number prefix")).toHaveAttribute("readonly");
    expect(screen.getByText("Only Management changes invoice numbering")).toBeInTheDocument();
  });

  it("shows the failure state when the settings cannot be read", async () => {
    const { client } = stubClient(handlers({ getQuoteSettings: () => apiError(500, "Broken") }));
    renderScreen(<InvoiceNumberingEditor />, client, { permissionKeys: ["configuration.manage"] });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
