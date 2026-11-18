import { PERMISSIONS } from "../../prisma/seedData";

/**
 * What an organisation may and may not do when it edits roles (FIG-1188, B7.06). Pure: no database access. The platform
 * fixes these limits; an organisation edits inside them. The service layer (`roleEditorService.ts`) enforces them and the
 * tests (`tests/roleEditor.test.ts`) prove them against the live catalogue.
 */

/** Keys that run the organisation itself. Only the platform Management role carries them, so a custom role can never replace Management. */
export const ADMIN_RESERVED_KEYS: readonly string[] = [
  "organization.manage_settings",
  "membership.manage",
  "role.assign",
  "roles.manage",
  "configuration.manage",
  "security.manage",
  "audit.view",
  "export.bulk",
  "api_tokens.manage",
  "webhooks.manage",
  "ai.configure",
];

/** Payments are visible only to Finance and Management (hard rule 7), and margin only to Management: never granted to a custom role. */
export const SENSITIVE_RESERVED_KEYS: readonly string[] = [
  "finance.view.payments",
  "finance.manage.payments",
  "payments.manage",
  "deals.margin",
];

export const RESERVED_KEYS: ReadonlySet<string> = new Set([...ADMIN_RESERVED_KEYS, ...SENSITIVE_RESERVED_KEYS]);

export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/** The keys an organisation may put on a custom role: the whole catalogue except the reserved keys. */
export function grantableKeys(): string[] {
  return PERMISSIONS.map((p) => p.key).filter((k) => !RESERVED_KEYS.has(k));
}

/** Why a key cannot be granted, in words the editor can show next to the switch. */
export function reservedReason(key: string): string | null {
  if (SENSITIVE_RESERVED_KEYS.includes(key)) {
    return key === "deals.margin"
      ? "Margin is visible to Management only."
      : "Payments are visible to Finance and Management only.";
  }
  if (ADMIN_RESERVED_KEYS.includes(key)) return "Running the organisation stays with the Management role.";
  return null;
}

/**
 * A change right needs the matching view right (you cannot edit what you cannot open). Each entry: the keys that need a view
 * key, and the keys of which at least one must be present. Written for the resources the scope resolver knows.
 */
const NEEDS_VIEW: Array<{ needs: string[]; oneOf: string[]; label: string }> = [
  { needs: ["leads.create", "leads.edit.own", "leads.edit.all", "leads.assign", "leads.convert", "leads.archive.own", "leads.archive.all", "leads.claim"], oneOf: ["leads.view.own", "leads.view.all", "leads.view.shared"], label: "leads" },
  { needs: ["deals.create", "deals.edit.own", "deals.edit.all", "deals.archive.own", "deals.archive.all", "deals.handoff", "deals.view.value"], oneOf: ["deals.view.own", "deals.view.all", "deals.view.won"], label: "deals" },
  { needs: ["contacts.create", "contacts.edit", "contacts.archive", "contacts.merge", "contacts.export", "contacts.import"], oneOf: ["contacts.view"], label: "contacts" },
  { needs: ["companies.create", "companies.edit", "companies.archive", "companies.merge", "companies.export", "companies.import"], oneOf: ["companies.view"], label: "companies" },
  { needs: ["company_services.manage"], oneOf: ["company_services.view"], label: "recurring services" },
  { needs: ["tasks.create", "tasks.assign.own", "tasks.assign.any"], oneOf: ["tasks.view.own", "tasks.view.all"], label: "tasks" },
  { needs: ["communications.create"], oneOf: ["communications.view"], label: "communications" },
  { needs: ["activities.create"], oneOf: ["activities.view"], label: "activities" },
  { needs: ["proposals.manage"], oneOf: ["proposals.view"], label: "proposals" },
  { needs: ["chat.post", "chat.channels.manage"], oneOf: ["chat.view"], label: "chat" },
];

export interface RoleIssue {
  path: string;
  message: string;
  code: string;
}

/** Every reason a proposed set of keys is not allowed on a custom role (empty when it is). */
export function validatePermissionKeys(keys: readonly string[]): RoleIssue[] {
  const issues: RoleIssue[] = [];
  const known = new Set(PERMISSIONS.map((p) => p.key));
  const set = new Set(keys);
  for (const key of set) {
    if (!known.has(key)) {
      issues.push({ path: "permissionKeys", message: `"${key}" is not a permission.`, code: "UNKNOWN_PERMISSION" });
    } else if (RESERVED_KEYS.has(key)) {
      issues.push({ path: "permissionKeys", message: `"${key}" cannot be given to a custom role. ${reservedReason(key)}`, code: "RESERVED_PERMISSION" });
    }
  }
  for (const rule of NEEDS_VIEW) {
    const used = rule.needs.filter((k) => set.has(k));
    if (used.length > 0 && !rule.oneOf.some((k) => set.has(k))) {
      issues.push({
        path: "permissionKeys",
        message: `${used.join(", ")} needs the right to see ${rule.label}: add one of ${rule.oneOf.join(", ")}.`,
        code: "MISSING_VIEW_PERMISSION",
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Field access
// ---------------------------------------------------------------------------

export type FieldAccess = "all" | "own" | "hidden";

export interface FieldDef {
  id: string;
  label: string;
  /** The permission key the masking layer reads for this field. */
  governedBy: string;
  /** Whether an organisation may change it on a custom role (false: the platform fixes it to "hidden"). */
  editable: boolean;
  options: FieldAccess[];
  help: string;
}

/**
 * The fields whose visibility the masking layer (`src/auth/masking.ts`, docs/MASKING.md) decides. `deal.value` is the one an
 * organisation may tune: everyone (`all`, with deals.view.value), only the deal's owner (`own`, the default for Sales) or
 * nobody (`hidden`, not even the owner). Margin and payments are fixed to hidden for custom roles.
 */
export const FIELD_CATALOGUE: readonly FieldDef[] = [
  {
    id: "deal.value",
    label: "Deal value",
    governedBy: "deals.view.value",
    editable: true,
    options: ["all", "own", "hidden"],
    help: "All: every deal's value and totals. Own: only the value of deals the person owns. Hidden: never, not even for the owner.",
  },
  {
    id: "deal.margin",
    label: "Deal margin and cost",
    governedBy: "deals.margin",
    editable: false,
    options: ["hidden"],
    help: "Margin and cost are visible to Management only.",
  },
  {
    id: "payments",
    label: "Invoices and payments",
    governedBy: "finance.view.payments",
    editable: false,
    options: ["hidden"],
    help: "Payments are visible to Finance and Management only.",
  },
];

export const EDITABLE_FIELD_IDS: readonly string[] = FIELD_CATALOGUE.filter((f) => f.editable).map((f) => f.id);

export type FieldRules = Record<string, FieldAccess>;

export function validateFieldRules(rules: Record<string, string>): RoleIssue[] {
  const issues: RoleIssue[] = [];
  for (const [field, access] of Object.entries(rules)) {
    const def = FIELD_CATALOGUE.find((f) => f.id === field);
    if (!def) issues.push({ path: `fieldRules.${field}`, message: `"${field}" is not a field the platform lets you control.`, code: "UNKNOWN_FIELD" });
    else if (!def.editable) issues.push({ path: `fieldRules.${field}`, message: def.help, code: "FIELD_FIXED" });
    else if (!(def.options as string[]).includes(access)) issues.push({ path: `fieldRules.${field}`, message: `Choose one of: ${def.options.join(", ")}.`, code: "BAD_ACCESS" });
  }
  return issues;
}

/**
 * Makes the keys and the field rules agree. The field rule is the authority for the keys it governs: `all` adds the governing
 * key, `own` and `hidden` remove it. A rule that is not given is read from the keys (key present: `all`, absent: `own`).
 */
export function reconcileFieldRules(keys: readonly string[], rules: Record<string, string>): { keys: string[]; rules: FieldRules } {
  const next = new Set(keys);
  const out: FieldRules = {};
  for (const def of FIELD_CATALOGUE.filter((f) => f.editable)) {
    const given = rules[def.id] as FieldAccess | undefined;
    const access: FieldAccess = given ?? (next.has(def.governedBy) ? "all" : "own");
    if (access === "all") next.add(def.governedBy);
    else next.delete(def.governedBy);
    out[def.id] = access;
  }
  return { keys: [...next].sort(), rules: out };
}

/** The field ids a role hides from the people who would otherwise see them through ownership (carried on the request context). */
export function hiddenFieldsOf(rules: Record<string, string>): string[] {
  return Object.entries(rules)
    .filter(([, access]) => access === "hidden")
    .map(([field]) => field)
    .sort();
}
