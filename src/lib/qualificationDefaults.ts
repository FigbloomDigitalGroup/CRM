import type { CustomFieldType } from "@prisma/client";

/**
 * The starting qualification questions (FIG-1030, B2.01): a few for every
 * lead, and a handful for each of the 14 seeded services. They are copied into
 * each organisation's `custom_field_definitions` (section QUALIFICATION) when
 * it is set up, and from then on Management can change them (hide a question,
 * make one required before qualifying, add their own). Keys are unique per
 * organisation, so a service's keys carry a short prefix.
 *
 * `requiredOnQualify` is deliberately light: one or two answers that a salesperson
 * cannot honestly qualify the lead without. Management can make more required.
 */
export interface QualificationQuestion {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: { value: string; label: string }[];
  helpText?: string;
  requiredOnQualify?: boolean;
}

const opts = (...labels: string[]) => labels.map((label) => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label }));

/** Asked on every lead, whatever the service. */
export const GENERAL_QUESTIONS: QualificationQuestion[] = [
  { key: "budget_range", label: "Budget range", fieldType: "SELECT", options: opts("Under 100k", "100k to 500k", "500k to 2M", "Over 2M", "Not sure yet") },
  { key: "decision_maker", label: "Who decides?", fieldType: "TEXT", helpText: "The person who signs off, and whether we are speaking to them." },
  { key: "timeline", label: "When do they want it?", fieldType: "SELECT", options: opts("This month", "This quarter", "This year", "No fixed date") },
];

/** Keyed by the seeded service key. */
export const SERVICE_QUESTIONS: Record<string, QualificationQuestion[]> = {
  ACCOUNTING: [
    { key: "acct_users", label: "How many people will use it?", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "acct_current_tool", label: "What do they use today?", fieldType: "TEXT" },
    { key: "acct_vat", label: "VAT registered?", fieldType: "BOOLEAN" },
  ],
  HR: [
    { key: "hr_headcount", label: "Number of employees", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "hr_payroll", label: "Needs payroll?", fieldType: "BOOLEAN" },
  ],
  CRM: [
    { key: "crm_users", label: "Number of users", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "crm_current_tool", label: "Current tool", fieldType: "TEXT" },
  ],
  INVENTORY: [
    { key: "inv_locations", label: "Stores or warehouses", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "inv_items", label: "Approximate number of items", fieldType: "NUMBER" },
  ],
  PROPERTY_MANAGEMENT: [
    { key: "prop_units", label: "Number of units", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "prop_rent_collection", label: "Collects rent through the system?", fieldType: "BOOLEAN" },
  ],
  FLEET_GPS: [
    { key: "fleet_vehicles", label: "Number of vehicles", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "fleet_vehicle_types", label: "Vehicle types", fieldType: "MULTISELECT", options: opts("Cars", "Vans", "Trucks", "Motorbikes", "Heavy machinery") },
  ],
  CCTV: [
    { key: "cctv_cameras", label: "Number of cameras", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "cctv_site_type", label: "Site type", fieldType: "SELECT", options: opts("Home", "Shop", "Office", "Warehouse", "Estate") },
    { key: "cctv_site_visit", label: "Site visit needed?", fieldType: "BOOLEAN" },
  ],
  STARLINK_INTERNET: [
    { key: "net_location", label: "Installation location", fieldType: "TEXT", requiredOnQualify: true },
    { key: "net_users", label: "Expected users", fieldType: "NUMBER" },
    { key: "net_hardware", label: "Needs hardware supplied?", fieldType: "BOOLEAN" },
  ],
  ISP_BILLING: [
    { key: "isp_subscribers", label: "Number of subscribers", fieldType: "NUMBER", requiredOnQualify: true },
    { key: "isp_current_tool", label: "Current billing tool", fieldType: "TEXT" },
  ],
  WEB_DEVELOPMENT: [
    { key: "web_type", label: "Type of site", fieldType: "SELECT", options: opts("Brochure", "Online shop", "Web application", "Redesign"), requiredOnQualify: true },
    { key: "web_domain", label: "Existing domain", fieldType: "TEXT" },
  ],
  BRANDING: [
    { key: "brand_scope", label: "What is needed", fieldType: "MULTISELECT", options: opts("Logo", "Brand guide", "Stationery", "Signage"), requiredOnQualify: true },
  ],
  SOCIAL_MEDIA_MANAGEMENT: [
    { key: "social_channels", label: "Channels", fieldType: "MULTISELECT", options: opts("Facebook", "Instagram", "LinkedIn", "TikTok", "X"), requiredOnQualify: true },
    { key: "social_posts_week", label: "Posts per week", fieldType: "NUMBER" },
  ],
  AUTOMATION_SYSTEMS: [
    { key: "auto_process", label: "Process to automate", fieldType: "TEXT", requiredOnQualify: true },
    { key: "auto_systems", label: "Systems involved", fieldType: "TEXT" },
  ],
  CONSULTING_OTHER: [
    { key: "other_need", label: "What do they need?", fieldType: "TEXT", requiredOnQualify: true },
  ],
};
