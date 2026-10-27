/**
 * The reviewed, human-written side of the permission matrix (G1.02): which areas each role may reach at all. The generated walk
 * (tests/apiWalk.test.ts) records what every route does; these lists say what it is allowed to do, so a route that opens an area to
 * the wrong role fails even if the generated matrix is regenerated to match it. They follow the signed permission model
 * (prisma/seedData.ts ROLE_PERMISSIONS, docs/DECISIONS.md): Management administers; Sales works its own leads and deals; Delivery
 * sees won deals and customer context; Finance sees payments; Restricted Technical sees its own tasks; Customer Support is off in V1.
 *
 * Patterns match the key "METHOD /api/orgs/{orgSlug}/path". `{x}` stands for any one path parameter.
 */

function key(path: string, methods = "[A-Z]+"): RegExp {
  const escaped = path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[A-Za-z0-9]+\}/g, "\\{[A-Za-z0-9]+\\}");
  return new RegExp(`^(${methods}) /api/orgs/\\{orgSlug\\}${escaped}$`);
}
/** `/prefix` and everything under it. */
function under(prefix: string, methods = "[A-Z]+"): RegExp {
  const escaped = prefix.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[A-Za-z0-9]+\}/g, "\\{[A-Za-z0-9]+\\}");
  return new RegExp(`^(${methods}) /api/orgs/\\{orgSlug\\}${escaped}(/.*)?$`);
}

/** Areas only Management may reach. */
export const MANAGEMENT_ONLY: RegExp[] = [
  under("/audit"),
  under("/automations"),
  under("/data-migration"),
  under("/integrations"),
  under("/jobs"),
  under("/memberships"),
  under("/security"),
  under("/settings"),
  key("/profile"),
  key("/reference-admin/{kind}"),
  under("/reference-admin/{kind}/{valueId}"),
  under("/reference-catalogs/{catalogKey}"),
  under("/reminder-settings"),
  under("/scoring"),
  under("/website-lead-assignment-rules"),
  under("/deal-rules"),
  under("/handoff-settings"),
  key("/reports/organization"),
  key("/reports/customers"),
  key("/reports/customers-export"),
  key("/reports/renewals"),
  key("/reports/settings"),
  key("/reports/export"),
  key("/reports/v2"),
  under("/reports/v2/{report}"),
  key("/exports"),
  key("/imports"),
  key("/leads/import"),
  key("/contacts/import"),
  key("/companies/import"),
  key("/leads/export"),
  key("/contacts/export"),
  key("/companies/export"),
  key("/deals/export"),
  key("/contacts/directory/export"),
  key("/companies/directory/export"),
  key("/leads/{leadId}/assign"),
  key("/deals/{dealId}/assign"),
  key("/custom-fields", "POST"),
  key("/custom-fields/{fieldId}", "PATCH"),
  key("/custom-fields/{fieldId}/usage"),
  key("/tags", "POST"),
  key("/tags/{tagId}", "PATCH|DELETE"),
  key("/tags/{tagId}/merge"),
  key("/email-templates", "POST"),
  key("/email-templates/{templateId}", "PATCH|DELETE"),
  key("/features", "PATCH"),
  key("/look", "PATCH"),
  key("/lead-pool/settings", "PATCH"),
  key("/lead-pool/requests/{requestId}/decide"),
  key("/renewal-settings", "PUT"),
  key("/dashboard/{section}"),
  // The privacy area is Management's, except a person seeing the export approvals they asked for.
  key("/privacy"),
  under("/privacy/requests"),
  under("/privacy/organisation-requests"),
  key("/privacy/export-rights"),
  key("/privacy/legal-hold"),
  key("/privacy/retention"),
  key("/privacy/export-approvals", "POST"),
  key("/privacy/export-approvals/{approvalId}/decision"),
];

/** Invoices, payments and the follow-up note on a deal: Finance and Management only (CLAUDE.md rule 7). */
export const PAYMENTS_ONLY: RegExp[] = [under("/invoices"), under("/payments"), key("/deals/{dealId}/payment-note")];

/** What every signed-in member does for themselves: preferences, notifications, search, their own tasks and files, their device. */
const SELF_SERVICE: RegExp[] = [
  under("/me"),
  key("/notification-preferences"),
  under("/notifications"),
  under("/search"),
  key("/signals"),
  under("/sync"),
  under("/push"),
  under("/pwa"),
  key("/features", "GET"),
  key("/look", "GET"),
  key("/dashboard"),
  under("/data-runs"),
  key("/lead-pool/settings", "GET"),
  key("/lead-pool/requests/{requestId}/cancel"),
  key("/reference-admin", "GET"),
  key("/reference-data"),
  key("/privacy/export-approvals", "GET"),
  key("/calendar"),
  under("/tasks"),
  key("/files"),
  under("/files/{fileId}"),
  key("/attachments/{attachmentId}/complete"),
  key("/merges/{mergeId}/undo"),
];

/** Customer context a role may read (companies and contacts, with their notes and files). */
const CUSTOMER_CONTEXT_READ: RegExp[] = [
  key("/companies", "GET"),
  key("/companies/directory", "GET"),
  under("/companies/{companyId}", "GET|POST|DELETE"),
  key("/contacts", "GET"),
  key("/contacts/directory", "GET"),
  under("/contacts/{contactId}", "GET|POST|DELETE"),
  key("/company-services", "GET"),
  key("/custom-fields", "GET"),
  key("/tags", "GET"),
  key("/renewal-settings", "GET"),
  key("/recurring-services", "GET"),
  key("/recurring-services/{serviceId}", "GET"),
  under("/reports/my-metrics"),
  key("/reports/my-work"),
  key("/reports/sales-by-salesperson"),
  under("/reports/v2/my-metrics"),
];

type Worker = Exclude<"SALES" | "DELIVERY" | "FINANCE" | "RESTRICTED_TECHNICAL" | "CUSTOMER_SUPPORT", "MANAGEMENT">;

export const ROLE_FAMILIES: Record<Worker, RegExp[]> = {
  SALES: [
    ...SELF_SERVICE,
    ...CUSTOMER_CONTEXT_READ,
    under("/activities"),
    under("/attachments/{attachmentId}"),
    under("/communications"),
    key("/companies", "POST"),
    key("/companies/check-duplicates"),
    under("/companies/{companyId}"),
    key("/company-services", "POST"),
    key("/company-services/{companyServiceId}"),
    key("/contacts", "POST"),
    under("/contacts/{contactId}"),
    under("/conversations"),
    key("/deal-moves/{moveId}/undo"),
    key("/deals"),
    key("/deals/board"),
    under("/deals/{dealId}"),
    key("/duplicates/check"),
    key("/email-templates", "GET"),
    key("/email-templates/{templateId}/render"),
    key("/handoffs", "GET"),
    key("/lead-pool/requests", "GET"),
    key("/leads"),
    key("/leads/check-duplicates"),
    key("/leads/pool"),
    under("/leads/{leadId}"),
    key("/quick-capture"),
    key("/quick-log"),
    key("/quick-log/prompt"),
    key("/recurring-services", "POST"),
    under("/recurring-services/{serviceId}"),
    key("/retention"),
  ],
  DELIVERY: [
    ...SELF_SERVICE,
    ...CUSTOMER_CONTEXT_READ,
    key("/attachments/{attachmentId}/complete"),
    key("/calendar"),
    under("/conversations"),
    key("/conversations", "POST"),
    // Delivery sees won deals; the rest of the deal routes answer "not found".
    key("/deals", "GET"),
    key("/deals/board", "GET"),
    under("/deals/{dealId}"),
    key("/deal-moves/{moveId}/undo"),
    key("/email-templates", "GET"),
    key("/email-templates/{templateId}/render"),
    key("/handoffs", "GET"),
    key("/quick-log"),
    key("/quick-log/prompt"),
  ],
  FINANCE: [
    ...SELF_SERVICE,
    ...CUSTOMER_CONTEXT_READ,
    key("/attachments/{attachmentId}/complete"),
    key("/deals", "GET"),
    key("/deals/board", "GET"),
    under("/deals/{dealId}"),
    key("/deal-moves/{moveId}/undo"),
    ...PAYMENTS_ONLY,
  ],
  RESTRICTED_TECHNICAL: [
    ...SELF_SERVICE,
    key("/conversations", "GET"),
    key("/conversations/needs-linking"),
    key("/conversations/{conversationId}"),
    key("/my-work"),
  ],
  // Off in V1 (customer_support.role): a person in this role keeps only what every member has.
  CUSTOMER_SUPPORT: [...SELF_SERVICE],
};

/** Routes Management is deliberately kept out of, with the reason. */
export const MANAGEMENT_EXCLUDED: Record<string, string> = {
  "GET /api/orgs/{orgSlug}/my-work": "the Restricted Technical role's own task home; Management uses the dashboard and reports",
};
