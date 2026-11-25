/**
 * Roles & access (UC-C5, UC-C6): pure helpers for the roles editor. No React and no network, so the rules are unit tests.
 * The response shapes are declared here from `roleEditorService.ts` (the frozen contract types these routes as `unknown`).
 */

export interface CatalogPermission {
  key: string;
  area: string;
  description: string;
  grantable: boolean;
  reason: string | null;
  release: string;
}

export interface CatalogField {
  id: string;
  label: string;
  governedBy: string;
  editable: boolean;
  options: string[];
  help: string;
}

export interface RoleCatalog {
  permissions: CatalogPermission[];
  fields: CatalogField[];
  startingPoints: { key: string; name: string; description: string }[];
  limits: { maxCustomRoles: number; nameLength: { min: number; max: number }; descriptionMax: number };
}

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: "platform" | "custom";
  basedOnRoleKey: string | null;
  editable: boolean;
  permissionKeys: string[];
  fieldRules: Record<string, string>;
  memberCount: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface RoleList {
  roles: RoleView[];
  limits: { maxCustomRoles: number; customRoles: number };
}

export interface RolePreview {
  valid: true;
  gained: string[];
  lost: string[];
  permissionKeys: string[];
  scopes: { resource: string; action: string; scope: string; reason: string | null; changed: boolean | null }[];
  fields: { id: string; label: string; access: string; was: string | null }[];
  people: { count: number; names: string[] };
  warnings: string[];
}

export interface PermissionGroup {
  area: string;
  permissions: CatalogPermission[];
}

/** Permissions grouped by their area, areas in alphabetical order, keys in catalogue order. */
export function groupPermissions(permissions: readonly CatalogPermission[], filter = ""): PermissionGroup[] {
  const q = filter.trim().toLowerCase();
  const byArea = new Map<string, CatalogPermission[]>();
  for (const p of permissions) {
    if (q && !`${p.key} ${p.description} ${p.area}`.toLowerCase().includes(q)) continue;
    byArea.set(p.area, [...(byArea.get(p.area) ?? []), p]);
  }
  return [...byArea.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, perms]) => ({ area, permissions: perms }));
}

/** The keys a new custom role gets from a platform role: only keys an organisation may grant (reserved ones are dropped, as the API does). */
export function keysFromStartingPoint(role: RoleView | undefined, catalog: RoleCatalog | undefined): string[] {
  if (!role || !catalog) return [];
  const grantable = new Set(catalog.permissions.filter((p) => p.grantable).map((p) => p.key));
  return role.permissionKeys.filter((k) => grantable.has(k));
}

/**
 * Starter templates (docs/UNIVERSAL_CRM_ARCHITECTURE.md 6.5). A template is a named list of EXISTING permission keys; it is filtered to what the
 * catalogue lets an organisation grant, and the API validates the result again on save. It never includes deal value, margin or payment keys.
 */
export interface RoleTemplate {
  id: string;
  name: string;
  description: string;
  keys: string[];
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "marketing-lead",
    name: "Marketing lead (starter)",
    description: "Sees all leads, contacts and companies, adds leads, reads own reports. No deals, quotes or money.",
    keys: ["leads.view.all", "leads.create", "leads.edit.own", "contacts.view", "contacts.create", "companies.view", "tasks.view.own", "tasks.create", "reporting.view.own", "mywork.view"],
  },
  {
    id: "read-only-analyst",
    name: "Read-only analyst (starter)",
    description: "Looks at leads, companies, contacts and reports. Changes nothing.",
    keys: ["leads.view.all", "contacts.view", "companies.view", "reporting.view.all"],
  },
];

export function keysFromTemplate(template: RoleTemplate, catalog: RoleCatalog | undefined): string[] {
  if (!catalog) return [];
  const grantable = new Set(catalog.permissions.filter((p) => p.grantable).map((p) => p.key));
  return template.keys.filter((k) => grantable.has(k));
}

export function validateRoleDraft(name: string, description: string, catalog: RoleCatalog | undefined): string[] {
  const out: string[] = [];
  const { min, max } = catalog?.limits.nameLength ?? { min: 2, max: 60 };
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length < min || n.length > max) out.push(`A role name is ${min} to ${max} characters.`);
  const dMax = catalog?.limits.descriptionMax ?? 300;
  if (description.trim().length > dMax) out.push(`The description is at most ${dMax} characters.`);
  return out;
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

export interface CapabilityRow {
  area: string;
  total: number;
  /** Per role id: how many of this area's permissions the role holds. */
  held: Record<string, number>;
}

/** The "members by capability" table: for each permission area, how many keys each role holds. People = the role's member count. */
export function capabilityMatrix(roles: readonly RoleView[], catalog: RoleCatalog): CapabilityRow[] {
  return groupPermissions(catalog.permissions).map(({ area, permissions }) => {
    const keys = new Set(permissions.map((p) => p.key));
    const held: Record<string, number> = {};
    for (const r of roles) held[r.id] = r.permissionKeys.filter((k) => keys.has(k)).length;
    return { area, total: permissions.length, held };
  });
}

/** Which roles hold one permission, and how many people that reaches. */
export function whoCan(roles: readonly RoleView[], key: string): { roles: RoleView[]; people: number } {
  const holders = roles.filter((r) => r.permissionKeys.includes(key));
  return { roles: holders, people: holders.reduce((n, r) => n + r.memberCount, 0) };
}

/** "n / m Active": how many of a group's permissions the draft has switched on. */
export function activeCount(permissions: readonly CatalogPermission[], keys: readonly string[]): number {
  return permissions.filter((p) => keys.includes(p.key)).length;
}

/** The category names for the filter, alphabetical. */
export function areaNames(permissions: readonly CatalogPermission[]): string[] {
  return groupPermissions(permissions).map((g) => g.area);
}

/** Grant all: every permission an organisation may grant, plus any key the role already holds (so nothing is silently dropped). */
export function grantAllKeys(catalog: RoleCatalog, current: readonly string[]): string[] {
  return [...new Set([...current, ...catalog.permissions.filter((p) => p.grantable).map((p) => p.key)])];
}
