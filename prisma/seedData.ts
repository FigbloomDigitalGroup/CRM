/**
 * Global role/permission catalog for CRM V1.
 *
 * Five fixed roles plus the proposed sixth, Customer Support (flag-gated,
 * see `requiredFeature`). The matrix was signed on 22 Oct 2026
 * (docs/DECISIONS.md section 1) and extended by B1.01 (FIG-1017) with the
 * keys from the approved design. The seeded rows below already include the
 * five signed departures; `src/auth/permissions.ts` removes them again, per
 * organization, when a departure flag is switched off (B1.03).
 *
 * One reconciliation worth knowing about: stakeholder answers say Sales
 * can't see cost/margin figures, but deal values are Management + Finance
 * only elsewhere. There's no separate margin/cost field in this model, so
 * the resolution taken is that Sales can view/edit the *value* field on
 * deals they own (deals.view.own / deals.edit.own -- they're the ones
 * quoting it), but doesn't get deals.view.value, which is org-wide value
 * visibility used for aggregate reporting.
 */

export interface RoleDef {
  key: string;
  name: string;
  description: string;
  /** Feature toggle that must be on for the role to be assignable and carry permissions (B1.01). */
  requiredFeature?: string;
}

export const ROLES: readonly RoleDef[] = [
  {
    key: "MANAGEMENT",
    name: "Management",
    description: "Oversight, reporting, and team supervision.",
  },
  {
    key: "SALES",
    name: "Sales",
    description:
      "Lead, contact, company, deal, activity, and follow-up management.",
  },
  {
    key: "DELIVERY",
    name: "Delivery",
    description:
      "Sales-to-delivery visibility and customer/project handoff context.",
  },
  {
    key: "FINANCE",
    name: "Finance",
    description:
      "Financially relevant customer/deal information and finance workflows.",
  },
  {
    key: "RESTRICTED_TECHNICAL",
    name: "Restricted Technical",
    description:
      "Least-privilege technical support and troubleshooting access.",
  },
  {
    key: "CUSTOMER_SUPPORT",
    name: "Customer Support",
    description:
      "Customer questions, tickets and satisfaction follow-up. Proposed role, off until the organisation switches it on.",
    requiredFeature: "customer_support.role",
  },
];

export const PERMISSIONS: { key: string; area: string; description: string }[] =
  [
    {
      key: "organization.view",
      area: "Organization",
      description: "View the active organization's context/profile.",
    },
    {
      key: "organization.manage_settings",
      area: "Organization",
      description: "Manage organization CRM configuration.",
    },
    {
      key: "membership.view",
      area: "Membership",
      description: "View organization memberships.",
    },
    {
      key: "membership.manage",
      area: "Membership",
      description: "Add or deactivate organization memberships.",
    },
    {
      key: "role.assign",
      area: "Roles",
      description: "Assign or change a membership's role.",
    },

    {
      key: "leads.view.own",
      area: "Leads",
      description: "View leads the user owns.",
    },
    {
      key: "leads.view.all",
      area: "Leads",
      description: "View all organization leads.",
    },
    { key: "leads.create", area: "Leads", description: "Create leads." },
    {
      key: "leads.edit.own",
      area: "Leads",
      description: "Edit leads the user owns.",
    },
    {
      key: "leads.edit.all",
      area: "Leads",
      description: "Edit any lead in the organization.",
    },
    {
      key: "leads.assign",
      area: "Leads",
      description: "Reassign lead ownership.",
    },
    {
      key: "leads.convert",
      area: "Leads",
      description: "Convert a lead into a deal.",
    },
    {
      key: "leads.archive.own",
      area: "Leads",
      description: "Archive (and restore) leads the user owns.",
    },
    {
      key: "leads.archive.all",
      area: "Leads",
      description: "Archive (and restore) any lead in the organization.",
    },
    { key: "leads.export", area: "Leads", description: "Export lead records." },
    {
      key: "leads.import",
      area: "Leads",
      description: "Bulk-import lead records from CSV.",
    },

    {
      key: "contacts.view",
      area: "Contacts & Companies",
      description: "View contacts.",
    },
    {
      key: "contacts.create",
      area: "Contacts & Companies",
      description: "Create contacts.",
    },
    {
      key: "contacts.edit",
      area: "Contacts & Companies",
      description: "Edit contacts.",
    },
    {
      key: "contacts.archive",
      area: "Contacts & Companies",
      description: "Archive (and restore) contacts.",
    },
    {
      key: "contacts.merge",
      area: "Contacts & Companies",
      description: "Merge a duplicate contact into another, reassigning its history.",
    },
    {
      key: "contacts.export",
      area: "Contacts & Companies",
      description: "Export contact records.",
    },
    {
      key: "contacts.import",
      area: "Contacts & Companies",
      description: "Bulk-import contact records from CSV.",
    },
    {
      key: "companies.view",
      area: "Contacts & Companies",
      description: "View companies.",
    },
    {
      key: "companies.create",
      area: "Contacts & Companies",
      description: "Create companies.",
    },
    {
      key: "companies.edit",
      area: "Contacts & Companies",
      description: "Edit companies.",
    },
    {
      key: "companies.archive",
      area: "Contacts & Companies",
      description: "Archive (and restore) companies.",
    },
    {
      key: "companies.merge",
      area: "Contacts & Companies",
      description: "Merge a duplicate company into another, reassigning its history.",
    },
    {
      key: "companies.export",
      area: "Contacts & Companies",
      description: "Export company records.",
    },
    {
      key: "companies.import",
      area: "Contacts & Companies",
      description: "Bulk-import company records from CSV.",
    },
    {
      key: "company_services.view",
      area: "Contacts & Companies",
      description: "View which services a company holds.",
    },
    {
      key: "company_services.manage",
      area: "Contacts & Companies",
      description: "Add, update, or end a company's service record.",
    },

    {
      key: "deals.view.own",
      area: "Deals",
      description: "View deals the user owns.",
    },
    {
      key: "deals.view.all",
      area: "Deals",
      description: "View all organization deals (read-only).",
    },
    { key: "deals.create", area: "Deals", description: "Create deals." },
    {
      key: "deals.edit.own",
      area: "Deals",
      description: "Edit deals the user owns.",
    },
    {
      key: "deals.edit.all",
      area: "Deals",
      description: "Edit any deal in the organization.",
    },
    {
      key: "deals.archive.own",
      area: "Deals",
      description: "Archive (and restore) deals the user owns.",
    },
    {
      key: "deals.archive.all",
      area: "Deals",
      description: "Archive (and restore) any deal in the organization.",
    },
    {
      key: "deals.view.value",
      area: "Deals",
      description:
        "View deal value figures organization-wide (aggregate/reporting use).",
    },
    { key: "deals.export", area: "Deals", description: "Export deal records." },

    {
      key: "activities.create",
      area: "Activities & Tasks",
      description: "Log an activity.",
    },
    {
      key: "activities.view",
      area: "Activities & Tasks",
      description: "View activity history.",
    },
    {
      key: "tasks.create",
      area: "Activities & Tasks",
      description: "Create a task.",
    },
    {
      key: "tasks.assign.own",
      area: "Activities & Tasks",
      description: "Assign a task to self or an owned record.",
    },
    {
      key: "tasks.assign.any",
      area: "Activities & Tasks",
      description: "Assign a task to any organization member.",
    },
    {
      key: "tasks.view.own",
      area: "Activities & Tasks",
      description: "View own tasks.",
    },
    {
      key: "tasks.view.all",
      area: "Activities & Tasks",
      description: "View all organization tasks.",
    },

    {
      key: "communications.view",
      area: "Communications",
      description: "View communication records.",
    },
    {
      key: "communications.create",
      area: "Communications",
      description: "Log a communication.",
    },

    {
      key: "proposals.view",
      area: "Proposals",
      description: "View proposal references.",
    },
    {
      key: "proposals.manage",
      area: "Proposals",
      description: "Create/update proposal references.",
    },

    {
      key: "finance.view.payments",
      area: "Finance",
      description: "View payment/invoice-related information.",
    },
    {
      key: "finance.manage.payments",
      area: "Finance",
      description: "Manage payment/invoice-related information.",
    },

    {
      key: "reporting.view.own",
      area: "Reporting",
      description: "View reports scoped to the user's own records.",
    },
    {
      key: "reporting.view.all",
      area: "Reporting",
      description: "View organization-wide reports.",
    },

    {
      key: "configuration.manage",
      area: "Configuration",
      description:
        "Manage controlled reference data (lead sources, pipeline stages, etc.).",
    },

    { key: "audit.view", area: "Audit", description: "View audit history." },
    {
      key: "export.bulk",
      area: "Export",
      description: "Perform bulk/organization-wide exports.",
    },

    // --- B1.01 (FIG-1017): keys from the approved design. Keys for V1.1 and
    // V2 features exist now but stay inert until the organisation's release
    // reaches them (PERMISSION_MIN_RELEASE below).
    {
      key: "attachments.manage",
      area: "Records",
      description: "Upload and delete attachments on records the user can edit.",
    },
    {
      key: "templates.manage",
      area: "Configuration",
      description: "Create and edit message templates.",
    },
    {
      key: "tags.manage",
      area: "Configuration",
      description: "Create, rename and hide tags.",
    },
    {
      key: "customfields.manage",
      area: "Configuration",
      description: "Define custom fields and who can see them.",
    },
    {
      key: "views.share",
      area: "Records",
      description: "Share a saved view with the team.",
    },
    {
      key: "quotes.create",
      area: "Quotes",
      description: "Build and send quotes.",
    },
    {
      key: "quotes.approve",
      area: "Quotes",
      description: "Approve quotes and discounts.",
    },
    {
      key: "catalogue.manage",
      area: "Quotes",
      description: "Manage the product and service catalogue and prices.",
    },
    {
      key: "forecast.view.all",
      area: "Insights",
      description: "See the organisation forecast and targets.",
    },
    {
      key: "targets.manage",
      area: "Insights",
      description: "Set sales targets.",
    },
    {
      key: "cadences.manage",
      area: "Automation",
      description: "Create and edit follow-up sequences.",
    },
    { key: "ai.use", area: "Assistant", description: "Use the Ask Figbloom assistant." },
    {
      key: "ai.configure",
      area: "Assistant",
      description: "Switch the assistant on and set its limits.",
    },
    {
      key: "api_tokens.manage",
      area: "Developers",
      description: "Create and revoke API tokens.",
    },
    {
      key: "webhooks.manage",
      area: "Developers",
      description: "Create and manage webhooks.",
    },
    {
      key: "security.manage",
      area: "Security",
      description:
        "Manage session policy, lockout, sign-in events and member access.",
    },
    {
      key: "deals.margin",
      area: "Deals",
      description: "See cost and margin figures.",
    },
    {
      key: "payments.manage",
      area: "Finance",
      description: "Record payment status and notes on won deals.",
    },
    {
      key: "tickets.manage",
      area: "Support",
      description: "Work customer support tickets.",
    },

    // --- Signed departures from the seeded matrix (docs/DECISIONS.md 1.2 to
    // 1.6). Switched off per organisation with the `departure.*` toggles.
    {
      key: "deals.view.won",
      area: "Deals",
      description:
        "View won deals only (read-only). Replaces deals.view.all for Delivery and Finance.",
    },
    {
      key: "leads.view.shared",
      area: "Leads",
      description: "View the shared pool of unassigned leads.",
    },
    {
      key: "leads.claim",
      area: "Leads",
      description: "Ask to take, or take, a lead from the shared pool.",
    },
    {
      key: "mywork.view",
      area: "My work",
      description:
        "See assigned tasks together with the client requirements attached to them.",
    },
    {
      key: "finance.followup.note",
      area: "Finance",
      description: "Add a follow-up note on a won deal or payment.",
    },
    {
      key: "deals.handoff",
      area: "Deals",
      description:
        "Start a handoff to Delivery on a won deal. Does not allow moving a stage on someone else's deal.",
    },
    {
      key: "handoff.manage",
      area: "Handoff",
      description:
        "Receive a handoff: take ownership, update status and deliverables, mark Delivered.",
    },
  ];

/**
 * First release in which a permission carries any weight. Before that the
 * key exists in the catalogue but is stripped from every member's effective
 * permissions (`src/auth/permissions.ts`). Anything not listed is V1.
 */
export const PERMISSION_MIN_RELEASE: Record<string, "v1" | "v1.1" | "v2"> = {
  "views.share": "v1.1",
  "quotes.create": "v1.1",
  "quotes.approve": "v1.1",
  "catalogue.manage": "v1.1",
  "forecast.view.all": "v1.1",
  "targets.manage": "v1.1",
  "cadences.manage": "v1.1",
  "ai.use": "v1.1",
  "ai.configure": "v1.1",
  "deals.margin": "v1.1",
  "api_tokens.manage": "v2",
  "webhooks.manage": "v2",
  "tickets.manage": "v2",
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  MANAGEMENT: [
    "organization.view",
    "organization.manage_settings",
    "membership.view",
    "membership.manage",
    "role.assign",
    "leads.view.all",
    "leads.create",
    "leads.edit.all",
    "leads.assign",
    "leads.convert",
    "leads.archive.all",
    "leads.export",
    "leads.import",
    "contacts.view",
    "contacts.create",
    "contacts.edit",
    "contacts.archive",
    "contacts.merge",
    "contacts.export",
    "contacts.import",
    "companies.view",
    "companies.create",
    "companies.edit",
    "companies.archive",
    "companies.merge",
    "companies.export",
    "companies.import",
    "company_services.view",
    "company_services.manage",
    "deals.view.all",
    "deals.create",
    "deals.edit.all",
    "deals.archive.all",
    "deals.view.value",
    "deals.export",
    "activities.create",
    "activities.view",
    "tasks.create",
    "tasks.assign.any",
    "tasks.view.all",
    "communications.view",
    "communications.create",
    "proposals.view",
    "proposals.manage",
    "finance.view.payments",
    "finance.manage.payments",
    "reporting.view.all",
    "configuration.manage",
    "audit.view",
    "export.bulk",
    "attachments.manage",
    "templates.manage",
    "tags.manage",
    "customfields.manage",
    "views.share",
    "quotes.create",
    "quotes.approve",
    "catalogue.manage",
    "forecast.view.all",
    "targets.manage",
    "cadences.manage",
    "ai.use",
    "ai.configure",
    "api_tokens.manage",
    "webhooks.manage",
    "security.manage",
    "deals.margin",
    "tickets.manage",
    "deals.handoff",
    "handoff.manage",
  ],
  SALES: [
    "leads.view.own",
    "leads.create",
    "leads.edit.own",
    "leads.convert",
    "leads.archive.own",
    "contacts.view",
    "contacts.create",
    "contacts.edit",
    "contacts.archive",
    "contacts.merge",
    "companies.view",
    "companies.create",
    "companies.edit",
    "companies.archive",
    "companies.merge",
    "company_services.view",
    "company_services.manage",
    "deals.view.own",
    "deals.create",
    "deals.edit.own",
    "deals.archive.own",
    "activities.create",
    "activities.view",
    "tasks.create",
    "tasks.assign.own",
    "tasks.view.own",
    "communications.view",
    "communications.create",
    "proposals.view",
    "proposals.manage",
    "reporting.view.own",
    "attachments.manage",
    "views.share",
    "quotes.create",
    "ai.use",
    "leads.view.shared",
    "leads.claim",
    "deals.handoff",
  ],
  DELIVERY: [
    "contacts.view",
    "companies.view",
    "company_services.view",
    "deals.view.won",
    "activities.create",
    "activities.view",
    "tasks.create",
    "tasks.assign.own",
    "tasks.view.own",
    "communications.view",
    "communications.create",
    "reporting.view.own",
    "attachments.manage",
    "ai.use",
    "handoff.manage",
  ],
  FINANCE: [
    "contacts.view",
    "companies.view",
    "company_services.view",
    "deals.view.won",
    "deals.view.value",
    "finance.view.payments",
    "finance.manage.payments",
    "reporting.view.own",
    "ai.use",
    "payments.manage",
    "finance.followup.note",
  ],
  RESTRICTED_TECHNICAL: [
    "tasks.view.own",
    "tasks.create",
    "tasks.assign.own",
    "activities.view",
    "communications.view",
    "mywork.view",
  ],
  // Proposed sixth role (docs/DECISIONS.md 2.4): behind `customer_support.role`.
  CUSTOMER_SUPPORT: [
    "contacts.view",
    "companies.view",
    "company_services.view",
    "activities.view",
    "activities.create",
    "communications.view",
    "communications.create",
    "tasks.view.own",
    "tasks.create",
    "tasks.assign.own",
    "reporting.view.own",
    "attachments.manage",
    "ai.use",
    "tickets.manage",
  ],
};
