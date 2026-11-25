import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RolesAccess } from "../../../../src/ui/screens/roles/RolesAccess";
import { SalesAccess } from "../../../../src/ui/screens/roles/SalesAccess";
import { OrgStructure } from "../../../../src/ui/screens/roles/OrgStructure";
import { capabilityMatrix, groupPermissions, keysFromStartingPoint, keysFromTemplate, ROLE_TEMPLATES, validateRoleDraft, whoCan, type RoleCatalog, type RoleView } from "../../../../src/ui/screens/roles/model";
import { lockedReason, previewNav, setSwitch, homeTiles } from "../../../../src/ui/screens/roles/salesAccessModel";
import { apiError, renderScreen, stubClient, violations } from "../deals/harness";

const catalog: RoleCatalog = {
  permissions: [
    { key: "leads.view.all", area: "Leads", description: "See every lead", grantable: true, reason: null, release: "v1" },
    { key: "leads.create", area: "Leads", description: "Add leads", grantable: true, reason: null, release: "v1" },
    { key: "contacts.view", area: "Contacts & Companies", description: "See contacts", grantable: true, reason: null, release: "v1" },
    { key: "audit.view", area: "Audit", description: "Read the audit log", grantable: false, reason: "Runs the organisation.", release: "v1" },
  ],
  fields: [{ id: "deal.value", label: "Deal value", governedBy: "deals.view.value", editable: true, options: ["all", "own", "hidden"], help: "Who sees deal value." }],
  startingPoints: [{ key: "SALES", name: "Sales", description: "Sales" }],
  limits: { maxCustomRoles: 25, nameLength: { min: 2, max: 60 }, descriptionMax: 300 },
};
const sales: RoleView = { id: "r-sales", key: "SALES", name: "Sales", description: "Lead and deal work", kind: "platform", basedOnRoleKey: null, editable: false, permissionKeys: ["leads.view.all", "leads.create", "audit.view"], fieldRules: {}, memberCount: 4, archivedAt: null, updatedAt: "2026-11-01T00:00:00Z" };
const custom: RoleView = { id: "r-c1", key: "acme-analyst", name: "Analyst", description: null, kind: "custom", basedOnRoleKey: "SALES", editable: true, permissionKeys: ["leads.view.all"], fieldRules: {}, memberCount: 0, archivedAt: null, updatedAt: "2026-11-02T00:00:00Z" };

const preview = { valid: true, gained: [], lost: [], permissionKeys: ["leads.view.all"], scopes: [{ resource: "leads", action: "view", scope: "organisation", reason: null, changed: null }], fields: [{ id: "deal.value", label: "Deal value", access: "own", was: null }], people: { count: 0, names: [] }, warnings: [] };
const MANAGER = ["configuration.manage", "roles.manage"];

describe("roles model", () => {
  it("groups permissions by area and filters by text", () => {
    expect(groupPermissions(catalog.permissions).map((g) => g.area)).toEqual(["Audit", "Contacts & Companies", "Leads"]);
    expect(groupPermissions(catalog.permissions, "lead").map((g) => g.area)).toEqual(["Leads"]);
  });
  it("a starting point and a template drop keys an organisation may not grant", () => {
    expect(keysFromStartingPoint(sales, catalog)).toEqual(["leads.view.all", "leads.create"]);
    expect(keysFromTemplate(ROLE_TEMPLATES[0]!, catalog)).toEqual(["leads.view.all", "leads.create", "contacts.view"]);
  });
  it("validates the name length and counts who can do a thing", () => {
    expect(validateRoleDraft("x", "", catalog)).toHaveLength(1);
    expect(validateRoleDraft("Analyst", "", catalog)).toEqual([]);
    expect(whoCan([sales, custom], "leads.create")).toMatchObject({ people: 4 });
    expect(whoCan([sales, custom], "contacts.view").people).toBe(0);
    expect(capabilityMatrix([sales], catalog).find((r) => r.area === "Leads")!.held["r-sales"]).toBe(2);
  });
});

describe("Roles & access (real roles API)", () => {
  const handlers = () => ({
    listRoles: () => ({ roles: [sales, custom], limits: { maxCustomRoles: 25, customRoles: 1 } }),
    getRoleCatalog: () => catalog,
    previewRole: () => preview,
  });

  it("lists the standard roles and your own roles with their people, and opens the first role read-only", async () => {
    const { client } = stubClient(handlers());
    const { container } = renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    expect(await screen.findByRole("heading", { name: "Roles & access" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Roles" });
    expect(within(rail).getByText("Standard roles")).toBeInTheDocument();
    expect(within(rail).getByText("Your roles")).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Sales/ })).toHaveAttribute("aria-current", "true");
    expect(within(rail).getByLabelText("4 people")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("readonly");
    expect(screen.getByRole("table", { name: /Permissions held per role/ })).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("explains that the feature is not available when the organisation is not on the release", async () => {
    const { client } = stubClient({
      listRoles: () => apiError(403, "Not on this release", { code: "FEATURE_NOT_AVAILABLE" }),
      getRoleCatalog: () => apiError(403, "Not on this release", { code: "FEATURE_NOT_AVAILABLE" }),
    });
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    await waitFor(() => expect(screen.queryByText(/Loading roles/)).not.toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: "Roles" })).not.toBeInTheDocument();
  });

  it("New role with Copy from Sales creates a custom role with the copied keys and shows the live preview", async () => {
    const created: unknown[] = [];
    const { client, calls } = stubClient({ ...handlers(), createRole: (a) => (created.push(a.body), { ...custom, id: "r-new", name: "Junior sales" }) });
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "+ New role" }));
    await user.type(screen.getByLabelText("Name"), "Junior sales");
    await user.selectOptions(screen.getByLabelText("Copy from"), "r-sales");
    // The reserved key stays off and explains why; the copied ones are on.
    expect(screen.getByRole("checkbox", { name: "audit.view" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "audit.view" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "leads.create" })).toBeChecked();
    expect(screen.getByText("2 / 2 Active")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.id === "previewRole")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Add role" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: "Junior sales", basedOnRoleKey: "SALES", permissionKeys: ["leads.view.all", "leads.create"] });
  });

  it("Grant all switches on every grantable permission and Revoke all clears them", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Analyst/ }));
    await user.click(screen.getByRole("button", { name: "Grant all" }));
    expect(screen.getByRole("checkbox", { name: "contacts.view" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "leads.create" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "audit.view" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Revoke all" }));
    expect(screen.getByRole("checkbox", { name: "leads.view.all" })).not.toBeChecked();
    expect(screen.getByText("0 / 2 Active")).toBeInTheDocument();
  });

  it("the category filter narrows the permission cards and the search finds one", async () => {
    const { client } = stubClient(handlers());
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Roles & access" });
    await user.selectOptions(screen.getByLabelText("Category"), "Contacts & Companies");
    expect(screen.queryByRole("checkbox", { name: "leads.create" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "contacts.view" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Category"), "");
    await user.type(screen.getByLabelText("Search permissions"), "audit");
    expect(screen.getByRole("checkbox", { name: "audit.view" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "leads.create" })).not.toBeInTheDocument();
  });

  it("a standard role is read-only, and a role in use cannot be archived", async () => {
    const used = { ...custom, id: "r-used", name: "Used", memberCount: 2 };
    const { client } = stubClient({ ...handlers(), listRoles: () => ({ roles: [sales, used], limits: { maxCustomRoles: 25, customRoles: 1 } }) });
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    expect(await screen.findByText(/cannot be changed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Grant all" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "leads.create" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Used/ }));
    expect(screen.getByRole("button", { name: "Archive role" })).toHaveAttribute("aria-disabled", "true");
  });

  it("Save changes sends the edited role's new keys", async () => {
    const saved: unknown[] = [];
    const { client } = stubClient({ ...handlers(), updateRole: (a) => (saved.push(a.body), custom) });
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Analyst/ }));
    await user.click(screen.getByRole("checkbox", { name: "contacts.view" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ name: "Analyst", permissionKeys: ["leads.view.all", "contacts.view"] });
  });

  it("shows the API's refusal in the preview when a proposal is not allowed", async () => {
    const { client } = stubClient({ ...handlers(), previewRole: () => apiError(400, "leads.create needs the right to see leads", { code: "VALIDATION" }) });
    renderScreen(<RolesAccess />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "+ New role" }));
    await user.click(screen.getByText("Preview as this role"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("Sales access (demo)", () => {
  it("dependent switches lock and turning one off turns its dependents off", () => {
    expect(lockedReason(12, [])).toMatch(/stage management/);
    expect(setSwitch([6, 7, 11, 12], 7, false)).toEqual([6]);
    expect(setSwitch([], 9, true)).toEqual([]);
  });
  it("hides money in the home tiles without financial visibility, and the sidebar follows the real navigation keys", () => {
    expect(homeTiles([6, 7]).map((t) => t.label)).not.toContain("My pipeline value");
    expect(homeTiles([6, 7, 13]).map((t) => t.label)).toContain("My pipeline value");
    expect(previewNav([]).flatMap((s) => s.items)).not.toContain("Deals");
    expect(previewNav([6, 7]).flatMap((s) => s.items)).toContain("Deals");
    expect(previewNav([6, 7, 10]).flatMap((s) => s.items)).toContain("Quotes");
  });
  it("renders 13 switches and updates the preview live", async () => {
    const { client } = stubClient({});
    const { container } = renderScreen(<SalesAccess />, client, { permissionKeys: MANAGER });
    expect(screen.getAllByRole("switch")).toHaveLength(13);
    expect(screen.getByLabelText(/Preview as Marketing/)).toBeInTheDocument();
    const quotes = screen.getByRole("switch", { name: /Quotation creation/ });
    expect(quotes).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("switch", { name: /Deal creation/ }));
    expect(screen.getByLabelText(/Preview as Marketing/)).toHaveTextContent("Open a deal");
    expect(await violations(container)).toEqual([]);
  });
});

describe("Organisation structure (demo)", () => {
  it("adds a department, refuses a duplicate name and archives one", async () => {
    const { client } = stubClient({});
    renderScreen(<OrgStructure />, client, { permissionKeys: MANAGER });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New department"), "marketing");
    expect(screen.getAllByText("A department with that name exists.").length).toBeGreaterThan(0);
    await user.clear(screen.getByLabelText("New department"));
    await user.type(screen.getByLabelText("New department"), "Operations");
    await user.click(screen.getByRole("button", { name: "Add department" }));
    expect(screen.getByRole("region", { name: "Operations" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Operations" })).getByRole("button", { name: "Archive" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Operations" })).not.toBeInTheDocument());
  });
});
