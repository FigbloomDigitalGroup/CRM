/**
 * Global role/permission catalog for CRM V1.
 *
 * The five roles and the permission list/role mapping are a reasonable
 * starting point, not a signed-off matrix -- flag anything that looks
 * wrong to Michael/the project lead and it's a one-line change. See
 * IMPLEMENTATION_NOTES.md.
 *
 * One reconciliation worth knowing about: stakeholder answers say Sales
 * can't see cost/margin figures, but deal values are Management + Finance
 * only elsewhere. There's no separate margin/cost field in this model, so
 * the resolution taken is that Sales can view/edit the *value* field on
 * deals they own (deals.view.own / deals.edit.own -- they're the ones
 * quoting it), but doesn't get deals.view.value, which is org-wide value
 * visibility used for aggregate reporting.
 */

export const ROLES = [
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
] as const;

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
  ];

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
    "leads.export",
    "leads.import",
    "contacts.view",
    "contacts.create",
    "contacts.edit",
    "contacts.export",
    "contacts.import",
    "companies.view",
    "companies.create",
    "companies.edit",
    "companies.export",
    "companies.import",
    "company_services.view",
    "company_services.manage",
    "deals.view.all",
    "deals.create",
    "deals.edit.all",
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
    "reporting.view.all",
    "configuration.manage",
    "audit.view",
    "export.bulk",
  ],
  SALES: [
    "leads.view.own",
    "leads.create",
    "leads.edit.own",
    "leads.convert",
    "contacts.view",
    "contacts.create",
    "contacts.edit",
    "companies.view",
    "companies.create",
    "companies.edit",
    "company_services.view",
    "company_services.manage",
    "deals.view.own",
    "deals.create",
    "deals.edit.own",
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
  ],
  DELIVERY: [
    "contacts.view",
    "companies.view",
    "company_services.view",
    "deals.view.all",
    "activities.create",
    "activities.view",
    "tasks.create",
    "tasks.assign.own",
    "tasks.view.own",
    "communications.view",
    "communications.create",
    "reporting.view.own",
  ],
  FINANCE: [
    "contacts.view",
    "companies.view",
    "company_services.view",
    "deals.view.all",
    "deals.view.value",
    "finance.view.payments",
    "finance.manage.payments",
    "reporting.view.own",
  ],
  RESTRICTED_TECHNICAL: [
    "tasks.view.own",
    "tasks.create",
    "tasks.assign.own",
    "activities.view",
    "communications.view",
  ],
};
