import type { Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";

/**
 * Data access for `web_forms` and `web_form_submissions` (FIG-1151). The builder goes through the organisation's RLS context.
 * The public endpoint has no session yet, so it finds the form by its public key with the schema-owner client (the same
 * documented exception as `resolveWebsitePublicContext`) and then works inside the form's own organisation.
 */

export function listFormRows(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.webForm.findMany({ where: { organizationId }, orderBy: { name: "asc" } }));
}

export function getFormRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.webForm.findFirst({ where: { id, organizationId } }));
}

export function findFormByName(organizationId: string, name: string) {
  return withOrgContext(organizationId, (tx) => tx.webForm.findFirst({ where: { organizationId, name: { equals: name, mode: "insensitive" } } }));
}

export function createFormRow(data: Prisma.WebFormUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.webForm.create({ data }));
}

export function updateFormRow(organizationId: string, id: string, data: Prisma.WebFormUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.webForm.update({ where: { id, organizationId }, data }));
}

export function deleteFormRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.webForm.delete({ where: { id, organizationId } }));
}

export function leadSourceExists(organizationId: string, key: string) {
  return withOrgContext(organizationId, async (tx) => (await tx.leadSource.count({ where: { organizationId, key, isActive: true } })) > 0);
}

export function submissionCounts(organizationId: string, webFormId: string, since: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const [accepted, rejected] = await Promise.all([
      tx.webFormSubmission.count({ where: { organizationId, webFormId, outcome: "ACCEPTED", createdAt: { gte: since } } }),
      tx.webFormSubmission.count({ where: { organizationId, webFormId, outcome: { not: "ACCEPTED" }, createdAt: { gte: since } } }),
    ]);
    return { accepted, rejected };
  });
}

export function listSubmissionRows(organizationId: string, webFormId: string, filter: { outcome?: string; accepted?: boolean; skip: number; take: number }) {
  const where: Prisma.WebFormSubmissionWhereInput = {
    organizationId,
    webFormId,
    ...(filter.outcome ? { outcome: filter.outcome } : filter.accepted === true ? { outcome: "ACCEPTED" } : filter.accepted === false ? { outcome: { not: "ACCEPTED" } } : {}),
  };
  return withOrgContext(organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.webFormSubmission.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.skip, take: filter.take }),
      tx.webFormSubmission.count({ where }),
    ]);
    return { rows, total };
  });
}

/** The form a public key and organisation slug name, with its organisation's state; null when there is no such pair. */
export async function findPublicForm(orgSlug: string, publicKey: string) {
  const form = await adminDb.webForm.findUnique({ where: { publicKey } });
  if (!form) return null;
  // The organisation named in the address must be the form's own: a key never works under another organisation's slug.
  const org = await adminDb.organization.findUnique({ where: { id: form.organizationId }, select: { slug: true } });
  return org?.slug === orgSlug ? form : null;
}

export async function isOrganizationActive(organizationId: string) {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  return org?.status === "ACTIVE";
}

export interface SubmissionLogInput {
  organizationId: string;
  webFormId: string;
  formName: string;
  outcome: string;
  reason?: string | null;
  ipAddress?: string | null;
  origin?: string | null;
  leadId?: string | null;
  duplicateContact?: boolean;
  duplicateCompany?: boolean;
}

export function recordSubmission(input: SubmissionLogInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.webFormSubmission.create({
      data: {
        organizationId: input.organizationId,
        webFormId: input.webFormId,
        formName: input.formName,
        outcome: input.outcome,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        origin: input.origin ?? null,
        leadId: input.leadId ?? null,
        duplicateContact: input.duplicateContact ?? false,
        duplicateCompany: input.duplicateCompany ?? false,
      },
    }),
  );
}
