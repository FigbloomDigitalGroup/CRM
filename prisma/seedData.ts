/**
 * Global role/permission catalog for CRM V1.
 *
 * Five fixed roles. (A proposed sixth role, Customer Support, was dropped on 5 Nov 2026: support tickets are
 * raised by email to Figbloom, see docs/SUPPORT_BY_EMAIL.md.) The matrix was signed on 22 Oct 2026
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
  // UC-C7 (FIG-1791): the sixth platform role. Sourcing leads, customer context, communications, tasks, calendar and the Social workspace.
  // No deal values, no payments, no invoices (rule 7).
  {
    key: "MARKETING",
    name: "Marketing",
    description:
      "Lead sourcing, campaigns and the Social workspace. No deal values, payments or invoices.",
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
      key: "chat.view",
      area: "Communication",
      description: "Open Chat and read the channels you are in (and public channels).",
    },
    {
      key: "chat.post",
      area: "Communication",
      description: "Post, react and start direct messages and channels in Chat.",
    },
    {
      key: "chat.channels.manage",
      area: "Communication",
      description: "Rename, archive and manage the members of any channel you can see.",
    },
    {
      key: "mail.use",
      area: "Communication",
      description: "Use Mail: read the logged inbox and send from a record.",
    },
    {
      key: "meetings.schedule",
      area: "Communication",
      description: "Start or schedule a meeting from a record.",
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
    // UC-R1 (FIG-1775): the quote and invoice distinctions the Quotes and Invoices pages need. A role that holds quotes.create,
    // quotes.approve, finance.view.payments or finance.manage.payments already carries the matching keys below through
    // PERMISSION_IMPLICATIONS, so no role's effective access changes. Nothing enforces these keys yet (UC-R2 onward).
    {
      key: "quotes.view",
      area: "Quotes",
      description: "See the quotes list and open a quote.",
    },
    {
      key: "quotes.edit",
      area: "Quotes",
      description: "Edit a quote that has not been sent.",
    },
    {
      key: "quotes.send",
      area: "Quotes",
      description: "Send a quote to the customer by email or share link.",
    },
    {
      key: "invoices.view",
      area: "Finance",
      description: "See the invoices list and open an invoice.",
    },
    {
      key: "invoices.create",
      area: "Finance",
      description: "Create an invoice.",
    },
    {
      key: "invoices.edit",
      area: "Finance",
      description: "Edit or void an invoice.",
    },
    {
      key: "invoices.send",
      area: "Finance",
      description: "Send an invoice to the customer.",
    },
    {
      key: "payments.record",
      area: "Finance",
      description: "Record or reverse a payment against an invoice. Nothing is processed.",
    },
    {
      key: "finance.reports.view",
      area: "Finance",
      description: "See the finance reports.",
    },
    {
      key: "finance.export",
      area: "Finance",
      description: "Export invoices and payments. More than 500 rows still needs export.bulk.",
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
      key: "roles.manage",
      area: "Roles",
      description: "Create custom roles and edit their permissions and field access (FIG-1188).",
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
    // UC-C7 (FIG-1791): the Social workspace.
    {
      key: "social.view",
      area: "Social",
      description: "See the Social workspace: overview, inbox, campaigns and analytics.",
    },
    {
      key: "social.publish",
      area: "Social",
      description: "Compose, schedule and publish social posts.",
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
  // UC-R1: the quote distinctions follow quotes.create (V1.1); the invoice and finance keys follow the V1 payment keys.
  "quotes.view": "v1.1",
  "quotes.edit": "v1.1",
  "quotes.send": "v1.1",
  "catalogue.manage": "v1.1",
  "forecast.view.all": "v1.1",
  "targets.manage": "v1.1",
  "cadences.manage": "v1.1",
  "ai.use": "v1.1",
  "ai.configure": "v1.1",
  "deals.margin": "v1.1",
  "chat.view": "v1.1",
  "chat.post": "v1.1",
  "chat.channels.manage": "v1.1",
  "mail.use": "v1.1",
  "meetings.schedule": "v1.1",
  "api_tokens.manage": "v2",
  "webhooks.manage": "v2",
  "roles.manage": "v2",
};

/**
 * UC-R1 (FIG-1775), the compatibility rule: a role that holds the key on the left also carries the keys on the right, in the
 * effective permission set (`effectivePermissionKeys`), for platform roles AND custom roles. This is how every role keeps exactly
 * the access it has today when a coarse key is split into finer ones: nothing is rewritten in any organisation's data, a custom
 * role keeps its stored keys, and the finer keys are derived at read time. One level only (a key listed on the right does not
 * itself imply anything).
 *
 *  - quotes.create implies view, edit and send (it built and sent quotes).
 *  - quotes.approve implies quotes.view: today the quote read routes accept quotes.create OR quotes.approve (`READ_KEYS` in
 *    quoteService), so an approver who cannot build quotes must still be able to read them when quotes.view is enforced.
 *  - finance.manage.payments implies invoices create, edit and send, payments.record and finance.export.
 *  - finance.view.payments implies invoices.view and finance.reports.view.
 *
 * Payments stay visible to Finance and Management only (CLAUDE.md rule 7): the payment keys are reserved from custom roles
 * (`SENSITIVE_RESERVED_KEYS`), so nothing implied by them reaches a custom role through this table.
 */
export const PERMISSION_IMPLICATIONS: Record<string, readonly string[]> = {
  "quotes.create": ["quotes.view", "quotes.edit", "quotes.send"],
  "quotes.approve": ["quotes.view"],
  "finance.manage.payments": ["invoices.create", "invoices.edit", "invoices.send", "payments.record", "finance.export"],
  "finance.view.payments": ["invoices.view", "finance.reports.view"],
};

/** The ten keys UC-R1 adds to the catalogue. */
export const UC_R1_NEW_KEYS: readonly string[] = [
  "quotes.view",
  "quotes.edit",
  "quotes.send",
  "invoices.view",
  "invoices.create",
  "invoices.edit",
  "invoices.send",
  "payments.record",
  "finance.reports.view",
  "finance.export",
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
    "quotes.view",
    "quotes.edit",
    "quotes.send",
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.send",
    "payments.record",
    "finance.reports.view",
    "finance.export",
    "catalogue.manage",
    "forecast.view.all",
    "targets.manage",
    "cadences.manage",
    "ai.use",
    "ai.configure",
    "api_tokens.manage",
    "webhooks.manage",
    "roles.manage",
    "security.manage",
    "deals.margin",
    "deals.handoff",
    "handoff.manage",
    "chat.view",
    "chat.post",
    "chat.channels.manage",
    "mail.use",
    "meetings.schedule",
    "social.view",
    "social.publish",
  ],
  SALES: [
    "leads.view.own",
    "leads.create",
    "leads.edit.own",
    "leads.convert",
    "leads.export",
    "leads.import",
    "leads.archive.own",
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
    "quotes.view",
    "quotes.edit",
    "quotes.send",
    // UC-R10 / UC-C7: Sales prepares draft invoices of its own won deals (the Invoices page). The keys open the page and the create button; what
    // Sales actually reads is decided by the sales-draft rules in paymentService (own deals, DRAFT only, whitelisted fields, no payments).
    "invoices.view",
    "invoices.create",
    "ai.use",
    "leads.view.shared",
    "leads.claim",
    "deals.handoff",
    "deals.export",
    "chat.view",
    "chat.post",
    "mail.use",
    "meetings.schedule",
  ],
  DELIVERY: [
    "contacts.export",
    "companies.export",
    "deals.export",
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
    "chat.view",
    "chat.post",
    "mail.use",
    "meetings.schedule",
  ],
  FINANCE: [
    "contacts.export",
    "companies.export",
    "deals.export",
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
    // UC-R1: the invoice and finance keys mirror what finance.view.payments and finance.manage.payments already allowed, and
    // Finance also gets quotes.view (it cannot read quotes today; an intended addition, enforced from UC-R2).
    "invoices.view",
    "invoices.create",
    "invoices.edit",
    "invoices.send",
    "payments.record",
    "finance.reports.view",
    "finance.export",
    "quotes.view",
    "chat.view",
    "chat.post",
  ],
  RESTRICTED_TECHNICAL: [
    "tasks.view.own",
    "tasks.create",
    "tasks.assign.own",
    "activities.view",
    "communications.view",
    "mywork.view",
    "chat.view",
    "chat.post",
  ],
  // UC-C7 (FIG-1791): sources leads of its own, sees customers, communicates, works tasks and the calendar, and runs the Social workspace.
  MARKETING: [
    "leads.view.own",
    "leads.create",
    "leads.edit.own",
    "contacts.view",
    "companies.view",
    "activities.create",
    "activities.view",
    "communications.view",
    "communications.create",
    "tasks.create",
    "tasks.assign.own",
    "tasks.view.own",
    "reporting.view.own",
    "meetings.schedule",
    "chat.view",
    "chat.post",
    "social.view",
    "social.publish",
  ],
};
