import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemberAccessDrawer, overridesFrom, statesFrom } from "../../../../src/ui/screens/settings/MemberAccess";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";

const catalog = {
  permissions: [
    { key: "invoices.create", area: "Invoices", description: "Draft invoices", grantable: true, reason: null, release: "v1" },
    { key: "social.view", area: "Social", description: "See Social", grantable: true, reason: null, release: "v1" },
    { key: "roles.manage", area: "Roles", description: "Edit roles", grantable: false, reason: "Running the organisation stays with the Management role.", release: "v1" },
  ],
  fields: [],
  startingPoints: [],
  limits: { maxCustomRoles: 25, nameLength: { min: 2, max: 60 }, descriptionMax: 300 },
};
const access = { membershipId: "m-2", roleKey: "SALES", roleKeys: ["invoices.create"], grant: [], deny: [], effectiveKeys: ["invoices.create"] };
const KEYS = ["role.assign", "roles.manage"];

describe("member access overrides", () => {
  it("maps overrides to per-key states and back", () => {
    expect(statesFrom({ grant: ["a"], deny: ["b"] })).toEqual({ a: "add", b: "remove" });
    expect(overridesFrom({ a: "add", b: "remove", c: "inherit" })).toEqual({ grant: ["a"], deny: ["b"] });
  });

  it("Add and Remove are saved together, with a summary; keys that cannot be added are disabled with the reason", async () => {
    const saved: unknown[] = [];
    const { client } = stubClient({ getMemberAccess: () => access, getRoleCatalog: () => catalog, setMemberAccess: (a) => (saved.push(a.body), access) });
    const { container } = renderScreen(<MemberAccessDrawer membershipId="m-2" userName="Mark Mutesa" roleName="Sales" onClose={() => undefined} />, client, { permissionKeys: KEYS });
    const user = userEvent.setup();
    const social = await screen.findByLabelText("Access to social.view");
    await user.selectOptions(social, "add");
    await user.selectOptions(screen.getByLabelText("Access to invoices.create"), "remove");
    expect(screen.getByText("Adds 1, removes 1.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Summary of changes")).getByText("social.view")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Access to roles.manage")).getByRole("option", { name: "Add" })).toBeDisabled();
    expect(await violations(container.ownerDocument.body)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toEqual([{ grant: ["social.view"], deny: ["invoices.create"] }]));
  });

  it("Reset clears the choices and the API's refusal is shown in words", async () => {
    const { client } = stubClient({
      getMemberAccess: () => ({ ...access, grant: ["social.view"] }),
      getRoleCatalog: () => catalog,
      setMemberAccess: () => apiError(400, "This access change is not allowed.", { code: "VALIDATION", fieldErrors: [{ path: "deny", message: "That key is protected." }] }),
    });
    renderScreen(<MemberAccessDrawer membershipId="m-2" userName="Mark Mutesa" roleName="Sales" onClose={() => undefined} />, client, { permissionKeys: KEYS });
    const user = userEvent.setup();
    expect(await screen.findByText("Adds 1, removes 0.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText(/No changes/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Access to invoices.create"), "remove");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That key is protected.")).toBeInTheDocument();
  });
});
