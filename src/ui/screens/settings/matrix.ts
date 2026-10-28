import { PERMISSIONS, PERMISSION_MIN_RELEASE, ROLES, ROLE_PERMISSIONS } from "../../../../prisma/seedData";

/** One row of the read-only role matrix: a permission and which roles hold it. */
export interface MatrixRow {
  key: string;
  description: string;
  roles: Record<string, boolean>;
}
export interface MatrixData {
  roles: { key: string; name: string }[];
  areas: { area: string; rows: MatrixRow[] }[];
}

/**
 * The approved permission matrix (docs/DECISIONS.md section 1) as the seed carries it: every V1 permission, grouped by area, against the roles
 * Management can hand out. Built on the server and passed to the screen, so the page shows exactly what the seed (and so every new organisation) has.
 * Customer Support is proposed and behind a flag, so it is not a column in V1.
 */
export function buildRoleMatrix(): MatrixData {
  const roles = ROLES.filter((r) => r.key !== "CUSTOMER_SUPPORT").map((r) => ({ key: r.key, name: r.name }));
  const byArea = new Map<string, MatrixRow[]>();
  for (const p of PERMISSIONS) {
    if ((PERMISSION_MIN_RELEASE[p.key] ?? "v1") !== "v1") continue;
    const row: MatrixRow = { key: p.key, description: p.description, roles: Object.fromEntries(roles.map((r) => [r.key, (ROLE_PERMISSIONS[r.key] ?? []).includes(p.key)])) };
    byArea.set(p.area, [...(byArea.get(p.area) ?? []), row]);
  }
  return { roles, areas: [...byArea.entries()].map(([area, rows]) => ({ area, rows })) };
}
