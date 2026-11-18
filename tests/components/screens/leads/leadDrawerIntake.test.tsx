import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LeadDrawer } from "../../../../src/ui/screens/leads/LeadDrawer";
import { SALES_KEYS, apiError, axeViolations, page, renderScreen } from "./harness";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/o/figbloom/leads" }));

/** FIG-1675 (P2-21): email, company and the person's role on the new-lead form. */

const handlers = { getCompanies: page([]), listLeads: page([]), getContacts: page([]) };
const created = { createLead: { lead: { id: "lead-new" }, duplicates: [], possibleDuplicates: [], hiddenDuplicates: 0 }, patchLeadsByLeadId: {} };

describe("new lead: email, company and role", () => {
  it("shows Email and Company, and shows Role only once a company or email is entered", async () => {
    const user = userEvent.setup();
    renderScreen(<LeadDrawer onClose={() => undefined} />, { keys: SALES_KEYS, handlers });
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Company(?! or)/ })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Role in the company/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: /^Company(?! or)/ }), "Sarova Hotels");
    expect(screen.getByRole("combobox", { name: /Role in the company/ })).toBeInTheDocument();
  });

  it("sends the new company and the person, with the role, in one create call", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const { calls } = renderScreen(<LeadDrawer onClose={() => undefined} onSaved={onSaved} />, { keys: SALES_KEYS, handlers: { ...handlers, ...created } });
    await user.type(screen.getByRole("combobox", { name: /Company or person/ }), "Amara Osei");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "Amara@Sarova.com");
    await user.type(screen.getByRole("combobox", { name: /^Company(?! or)/ }), "Sarova Hotels");
    await user.type(screen.getByRole("combobox", { name: /Role in the company/ }), "Procurement manager");
    await user.click(screen.getByRole("button", { name: /Create lead/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("lead-new"));
    expect(calls.find((c) => c.id === "postCompanies")).toBeUndefined();
    expect(calls.find((c) => c.id === "createLead")?.args).toMatchObject({
      body: { newCompanyName: "Sarova Hotels", contact: { name: "Amara Osei", email: "amara@sarova.com", role: "Procurement manager" } },
    });
  });

  it("shows an inline error for an invalid email and saves nothing", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(<LeadDrawer onClose={() => undefined} />, { keys: SALES_KEYS, handlers: { ...handlers, ...created } });
    await user.type(screen.getByRole("combobox", { name: /Company or person/ }), "Amara Osei");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.click(screen.getByRole("button", { name: /Create lead/ }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(calls.find((c) => c.id === "createLead")).toBeUndefined();
  });

  it("explains a refusal from the server and keeps the form", async () => {
    const user = userEvent.setup();
    renderScreen(<LeadDrawer onClose={() => undefined} />, {
      keys: SALES_KEYS,
      handlers: { ...handlers, createLead: apiError(403, { code: "FORBIDDEN", message: "Your role cannot create contacts." }) },
    });
    await user.type(screen.getByRole("combobox", { name: /Company or person/ }), "Amara Osei");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "amara@x.com");
    await user.click(screen.getByRole("button", { name: /Create lead/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument(); // the explained no-access message
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("amara@x.com"); // the form is kept
  });

  it("has no accessibility violations with the new fields", async () => {
    const user = userEvent.setup();
    renderScreen(<LeadDrawer onClose={() => undefined} />, { keys: SALES_KEYS, handlers });
    await user.type(screen.getByRole("combobox", { name: /^Company(?! or)/ }), "X");
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });
});
