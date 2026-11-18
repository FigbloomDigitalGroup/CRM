import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `email_templates` (FIG-797). Every call runs inside the organisation's RLS context. */

export function listEmailTemplates(organizationId: string, includeInactive: boolean) {
  return withOrgContext(organizationId, (tx) =>
    tx.emailTemplate.findMany({
      where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: "asc" },
    }),
  );
}

export function getEmailTemplate(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.emailTemplate.findFirst({ where: { id, organizationId } }));
}

export function findEmailTemplateByName(organizationId: string, name: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.emailTemplate.findFirst({ where: { organizationId, name: { equals: name, mode: "insensitive" } } }),
  );
}

export function createEmailTemplate(input: { organizationId: string; name: string; subject: string; body: string; createdByMembershipId?: string }) {
  return withOrgContext(input.organizationId, (tx) => tx.emailTemplate.create({ data: input }));
}

export function updateEmailTemplate(organizationId: string, id: string, data: { name?: string; subject?: string; body?: string; isActive?: boolean }) {
  return withOrgContext(organizationId, (tx) => tx.emailTemplate.update({ where: { id, organizationId }, data }));
}

export function deleteEmailTemplate(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.emailTemplate.delete({ where: { id, organizationId } }));
}
