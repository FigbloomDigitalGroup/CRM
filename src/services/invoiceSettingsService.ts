import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { withOrgContext } from "../db/orgScopedClient";
import {
  DEFAULT_INVOICE_NUMBERING,
  INVOICE_NUMBERING_KEY,
  INVOICE_PREFIX_MAX,
  cleanInvoicePrefix,
  parseStoredInvoiceNumbering,
  type InvoiceNumbering,
} from "../lib/invoiceNumbering";
import { SALES_DRAFT_KEY, parseStoredSalesDraft } from "../lib/invoiceSalesDraft";
import { recordAuditEvent } from "../repositories/auditEvents";

/**
 * The organisation's invoice numbering setting (UC-R8, FIG-1779), kept as an organisation setting row like the quote settings. It is read through
 * `GET /quote-settings` and written through `PATCH /quote-settings` (`invoiceNumbering`), so no new route is needed. Management only
 * (`configuration.manage`). Off by default: an organisation that never opens it keeps typing its numbers by hand.
 */

/** The stored setting, or null when the organisation never set it. */
export async function loadInvoiceNumbering(organizationId: string): Promise<InvoiceNumbering | null> {
  const row = await withOrgContext(organizationId, (tx) => tx.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: INVOICE_NUMBERING_KEY } } }));
  return row ? parseStoredInvoiceNumbering(row.value) : null;
}

/** What the create-invoice rule uses: the stored setting, or auto-numbering off. */
export async function effectiveInvoiceNumbering(organizationId: string): Promise<InvoiceNumbering> {
  return (await loadInvoiceNumbering(organizationId)) ?? DEFAULT_INVOICE_NUMBERING;
}

export async function updateInvoiceNumbering(ctx: AuthContext, patch: { auto?: unknown; prefix?: unknown }): Promise<InvoiceNumbering> {
  requirePermission(ctx, "configuration.manage");
  const before = await effectiveInvoiceNumbering(ctx.organizationId);
  const issues: { path: string; message: string; code?: string }[] = [];
  if (patch.auto !== undefined && typeof patch.auto !== "boolean") issues.push({ path: "invoiceNumbering.auto", message: "Use true or false." });
  let prefix = before.prefix;
  if (patch.prefix !== undefined) {
    const cleaned = cleanInvoicePrefix(patch.prefix);
    if (cleaned === null) {
      issues.push({ path: "invoiceNumbering.prefix", message: `The prefix is 1 to ${INVOICE_PREFIX_MAX} characters: letters, digits and - _ . / only.`, code: "INVALID_INVOICE_PREFIX" });
    } else prefix = cleaned;
  }
  if (issues.length > 0) throw new ValidationError("The invoice numbering setting is not valid.", issues);
  const next: InvoiceNumbering = { auto: typeof patch.auto === "boolean" ? patch.auto : before.auto, prefix };
  await withOrgContext(ctx.organizationId, (tx) =>
    tx.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: ctx.organizationId, key: INVOICE_NUMBERING_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { organizationId: ctx.organizationId, key: INVOICE_NUMBERING_KEY, value: next as unknown as Prisma.InputJsonValue },
    }),
  );
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoice_numbering.updated",
    entityType: "Organization",
    entityId: ctx.organizationId,
    previousValue: before as unknown as Prisma.InputJsonValue,
    newValue: next as unknown as Prisma.InputJsonValue,
  });
  return next;
}

/** UC-R10: whether Sales may create and read draft invoices. Off unless Management switched it on. */
export async function salesDraftInvoicesEnabled(organizationId: string): Promise<boolean> {
  const row = await withOrgContext(organizationId, (tx) => tx.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: SALES_DRAFT_KEY } } }));
  return row ? parseStoredSalesDraft(row.value) : false;
}

export async function updateSalesDraftInvoices(ctx: AuthContext, enabled: unknown): Promise<boolean> {
  requirePermission(ctx, "configuration.manage");
  if (typeof enabled !== "boolean") throw new ValidationError("The Sales draft invoice setting is not valid.", [{ path: "salesDraftInvoices", message: "Use true or false." }]);
  const before = await salesDraftInvoicesEnabled(ctx.organizationId);
  const value = { enabled } as unknown as Prisma.InputJsonValue;
  await withOrgContext(ctx.organizationId, (tx) =>
    tx.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: ctx.organizationId, key: SALES_DRAFT_KEY } },
      update: { value },
      create: { organizationId: ctx.organizationId, key: SALES_DRAFT_KEY, value },
    }),
  );
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "invoice_sales_draft.updated",
    entityType: "Organization",
    entityId: ctx.organizationId,
    previousValue: { enabled: before } as unknown as Prisma.InputJsonValue,
    newValue: { enabled } as unknown as Prisma.InputJsonValue,
  });
  return enabled;
}
