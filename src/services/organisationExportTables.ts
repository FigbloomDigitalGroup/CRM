/**
 * What an organisation export contains, as two explicit lists (FIG-1141 hardening). Every table that has an `organization_id`
 * column must be in exactly one of them; `tests/organisationExportTables.test.ts` fails when a new table is in neither, so a
 * table added later is never exported by default. The export is handed to the organisation's Management, so the default is "no".
 *
 * Column-level redaction (hashes, tokens, secrets) still applies to exported tables; see EXPORT_REDACTED_COLUMN in
 * platformDataRequestService.ts.
 */

/** Exported as stored (minus redacted columns). Chat tables are exported only for PUBLIC channels, see EXPORT_TABLE_FILTERS. */
export const EXPORTED_TABLES: readonly string[] = [
  "memberships", "organization_settings", "website_lead_request_log", "website_lead_assignment_rules", "page_views", "deal_handoffs",
  "files", "notifications", "notification_preferences", "user_preferences", "notification_settings", "lead_sources", "lead_statuses",
  "pipeline_stages", "customer_lifecycle_states", "lost_reasons", "services", "companies", "contacts", "leads", "deals", "activities",
  "tasks", "communications", "proposal_references", "company_services", "audit_events", "merge_records", "custom_field_definitions",
  "tags", "tag_links", "attachments", "email_templates", "lead_pool_requests", "deal_moves", "comments", "comment_mentions",
  "record_follows", "data_runs", "signal_snapshots", "invoices", "payment_records", "deal_payment_notes", "recurring_services",
  "lifecycle_events", "automation_rules", "automation_runs", "import_sessions", "import_mapping_presets", "import_session_issues",
  "import_session_changes", "data_subject_requests", "export_approvals", "sales_targets", "catalogue_items", "saved_views",
  "saved_view_pins", "quotes", "quote_versions", "quote_lines", "calendar_event_links", "quote_shares", "quote_events", "web_forms",
  "web_form_submissions", "approval_requests", "follow_up_sequences", "follow_up_steps", "follow_up_enrollments", "follow_up_runs",
  "pipelines", "pipeline_services", "stage_rules",
  // Chat: only channels that are public to the whole organisation, and what belongs to them.
  "chat_channels", "chat_channel_members", "chat_messages", "chat_message_mentions", "chat_message_attachments", "chat_reactions",
];

/** Never exported, each with the reason. */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  sessions: "sign-in material",
  organization_usage_counters: "platform usage counts (API calls per month), not the organisation's records",
  announcement_dismissals: "per-person interface state for platform banners",
  support_access_grants: "platform support records, kept by the platform and shown to Management in Settings",
  support_access_page_views: "the support page-view log, kept by the platform and shown to Management in Settings",
  sign_in_events: "per-person security history (addresses, devices)",
  push_subscriptions: "device push endpoints and keys",
  website_api_keys: "credentials",
  inbound_email_keys: "credentials",
  oauth_connections: "connection tokens of mailboxes and calendars",
  oauth_states: "short-lived sign-in state for connections",
  background_jobs: "internal job queue",
  idempotency_keys: "internal request de-duplication",
  sync_mutations: "internal mobile sync queue",
  search_recents: "each person's private search history",
  mail_drafts: "private drafts, outbox and scheduled mail of individual members",
  assistant_requests: "private assistant conversations of individual members",
  assistant_proposals: "private assistant output of individual members",
  card_captures: "private business-card captures (images and extracted personal data) of individual members",
  roles: "custom role definitions (FIG-1188); their permission rows have no organisation column and cannot be exported alone, and Management reads them in Settings, Roles",
  role_field_rules: "field-visibility rules of custom roles; exported with the role definitions or not at all",
  churn_hints: "assistant hints derived from the exported records (FIG-1190), with individuals' feedback; regenerated nightly",
  api_tokens: "credential records (hashes) of individual members; never exported (FIG-805)",
  webhook_endpoints: "integration configuration with encrypted signing secrets; never exported (FIG-804)",
  webhook_deliveries: "delivery log and plumbing of outbound webhooks (FIG-804)",
  quote_signatures: "sealed signature records with signer IP and device; kept as legal evidence with the signed quote (FIG-1186)",
  notification_deliveries: "delivery plumbing (addresses, provider ids)",
  chat_read_markers: "per-person read state",
  chat_presence: "per-person presence",
  organization_lifecycle_events: "platform record about the organisation, not organisation data",
  platform_audit_events: "the platform team's own audit log, not organisation data",
  platform_data_requests: "platform record about the organisation, not organisation data",
  platform_deletion_certificates: "platform record about the organisation, not organisation data",
};

/**
 * Extra row filters (SQL, `$1` is the organisation id, the table is aliased `t`). Chat: private channels and direct messages
 * belong to their members, so an organisation-wide export carries public channels only.
 */
const PUBLIC_CHANNELS = `SELECT id FROM chat_channels WHERE organization_id = $1 AND kind = 'PUBLIC'`;
const PUBLIC_MESSAGES = `SELECT id FROM chat_messages WHERE organization_id = $1 AND channel_id IN (${PUBLIC_CHANNELS})`;
export const EXPORT_TABLE_FILTERS: Readonly<Record<string, string>> = {
  chat_channels: `t.kind = 'PUBLIC'`,
  chat_channel_members: `t.channel_id IN (${PUBLIC_CHANNELS})`,
  chat_messages: `t.channel_id IN (${PUBLIC_CHANNELS})`,
  chat_message_mentions: `t.message_id IN (${PUBLIC_MESSAGES})`,
  chat_message_attachments: `t.message_id IN (${PUBLIC_MESSAGES})`,
  chat_reactions: `t.message_id IN (${PUBLIC_MESSAGES})`,
};
