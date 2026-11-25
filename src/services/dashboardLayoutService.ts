import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { withOrgContext } from "../db/orgScopedClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { availableSections } from "./dashboardService";
import { HOME_KINDS, defaultLayout, homeKindFrom, layoutProblems, resolveLayout, type HomeKind, type LayoutEntry } from "../ui/screens/home/catalogue";

/**
 * Which widgets each role's home shows, and in what order (UC-W1, FIG-1802). Kept as one organisation setting row (`dashboard.layouts`), so it needs
 * no table of its own. Management (`configuration.manage`) writes it; every member reads their own role's layout. The layout can only hide or
 * reorder: `resolveLayout` drops any widget the reader's permission keys do not grant, so a stored layout never reveals anything (rule 7).
 */

export const DASHBOARD_LAYOUTS_KEY = "dashboard.layouts";

type Stored = Partial<Record<HomeKind, LayoutEntry[]>>;

function parseStored(value: unknown): Stored {
  const out: Stored = {};
  if (!value || typeof value !== "object") return out;
  for (const kind of HOME_KINDS) {
    const list = (value as Record<string, unknown>)[kind];
    if (Array.isArray(list)) out[kind] = list.filter((e): e is LayoutEntry => !!e && typeof (e as LayoutEntry).id === "string").map((e) => ({ id: e.id, visible: e.visible !== false }));
  }
  return out;
}

async function loadStored(organizationId: string): Promise<Stored> {
  const row = await withOrgContext(organizationId, (tx) => tx.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: DASHBOARD_LAYOUTS_KEY } } }));
  return row ? parseStored(row.value) : {};
}

export interface DashboardLayoutView {
  kind: HomeKind;
  widgets: LayoutEntry[];
  /** True when Management never saved a layout for this home. */
  isDefault: boolean;
}

/** The caller's own home kind, decided the same way the Home screen decides it. */
export function ownHomeKind(ctx: AuthContext): HomeKind | null {
  const keys = new Set(availableSections(ctx).map((s) => s.key as string));
  return homeKindFrom((k) => keys.has(k), (k) => hasPermission(ctx, k));
}

/**
 * Any member: their own home's layout, filtered by their own keys. Management may ask for another role's home with `kind`; that answer is the
 * configuration (no data), so it is not filtered by the asker's keys.
 */
export async function getDashboardLayout(ctx: AuthContext, requestedKind?: string | null): Promise<DashboardLayoutView> {
  const own = ownHomeKind(ctx);
  let kind: HomeKind;
  let editor = false;
  if (requestedKind && requestedKind !== own) {
    requirePermission(ctx, "configuration.manage");
    const problems = layoutProblems(requestedKind, []);
    if (problems.length > 0) throw new ValidationError("That dashboard does not exist.", [{ path: "kind", message: problems[0]! }]);
    kind = requestedKind as HomeKind;
    editor = true;
  } else if (own) kind = own;
  else throw new ValidationError("There is no dashboard for your role.", [{ path: "kind", message: "No dashboard." }]);
  const stored = (await loadStored(ctx.organizationId))[kind];
  const can = editor ? () => true : (k: string) => hasPermission(ctx, k);
  return { kind, widgets: resolveLayout(kind, stored, can), isDefault: !stored };
}

export async function saveDashboardLayout(ctx: AuthContext, input: { kind: string; widgets: LayoutEntry[] | null }): Promise<DashboardLayoutView> {
  requirePermission(ctx, "configuration.manage");
  const problems = layoutProblems(input.kind, input.widgets ?? []);
  if (problems.length > 0) throw new ValidationError("The dashboard layout is not valid.", problems.map((message) => ({ path: "widgets", message })));
  const kind = input.kind as HomeKind;
  const before = await loadStored(ctx.organizationId);
  const next: Stored = { ...before };
  // null resets the home to the catalogue default (nothing stored, so later catalogue changes reach it).
  if (input.widgets === null) delete next[kind];
  else next[kind] = resolveLayout(kind, input.widgets, () => true);
  if (JSON.stringify(before[kind] ?? null) !== JSON.stringify(next[kind] ?? null)) {
    await withOrgContext(ctx.organizationId, (tx) =>
      tx.organizationSetting.upsert({
        where: { organizationId_key: { organizationId: ctx.organizationId, key: DASHBOARD_LAYOUTS_KEY } },
        update: { value: next as unknown as Prisma.InputJsonValue },
        create: { organizationId: ctx.organizationId, key: DASHBOARD_LAYOUTS_KEY, value: next as unknown as Prisma.InputJsonValue },
      }),
    );
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "dashboard_layout.updated",
      entityType: "Organization",
      entityId: ctx.organizationId,
      previousValue: { kind, widgets: before[kind] ?? defaultLayout(kind) } as unknown as Prisma.InputJsonValue,
      newValue: { kind, widgets: next[kind] ?? defaultLayout(kind) } as unknown as Prisma.InputJsonValue,
    });
  }
  return { kind, widgets: resolveLayout(kind, next[kind], () => true), isDefault: !next[kind] };
}
