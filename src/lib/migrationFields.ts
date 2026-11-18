/**
 * What a data migration can bring in, and how a column in someone's file lines up with it (FIG-1061, B4.04, screen S7).
 * Pure: no database, so the mapper, the templates and the cell parsers are tested on their own.
 */

export const MIGRATION_ENTITIES = ["COMPANY", "CONTACT", "LEAD", "DEAL", "TASK", "ACTIVITY"] as const;
export type MigrationEntity = (typeof MIGRATION_ENTITIES)[number];

export type FieldType = "text" | "email" | "phone" | "number" | "date" | "enum" | "catalog" | "member" | "company" | "tags";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Allowed values for an enum field. */
  options?: readonly string[];
  /** Which reference list a catalog or member value is looked up in, and so which value mapping applies. */
  catalog?: "leadStatus" | "leadSource" | "service" | "stage" | "lifecycleState" | "owner" | "lostReason";
  /** Header names (lower case, spaces and punctuation ignored) that map to this field by themselves. */
  aliases?: readonly string[];
  help?: string;
}

const owner = (key: string, label: string, aliases: string[]): FieldDef => ({ key, label, type: "member", catalog: "owner", aliases, help: "The person's email address in this CRM." });
const createdAt: FieldDef = { key: "createdAt", label: "Date created", type: "date", aliases: ["created", "createdat", "createddate", "dateadded", "datecreated"], help: "Keeps the original date." };

export const FIELDS: Record<MigrationEntity, readonly FieldDef[]> = {
  COMPANY: [
    { key: "name", label: "Company name", type: "text", required: true, aliases: ["company", "companyname", "organisation", "organization", "account", "accountname", "business"] },
    { key: "industry", label: "Industry", type: "text", aliases: ["sector", "industry"] },
    { key: "website", label: "Website", type: "text", aliases: ["web", "url", "site", "domain"] },
    { key: "location", label: "Location", type: "text", aliases: ["address", "city", "town", "country", "area"] },
    { key: "phone", label: "Phone", type: "phone", aliases: ["telephone", "tel", "mobile", "phonenumber", "contactnumber"] },
    { key: "email", label: "Email", type: "email", aliases: ["emailaddress", "mail"] },
    { key: "notes", label: "Notes", type: "text", aliases: ["note", "comments", "remarks", "description"] },
    { key: "lifecycleState", label: "Customer state", type: "catalog", catalog: "lifecycleState", aliases: ["lifecycle", "customerstatus", "customerstate", "stage", "status"] },
    owner("ownerEmail", "Owner", ["owner", "owneremail", "accountowner", "accountmanager", "salesrep", "assignedto"]),
    { key: "tags", label: "Tags", type: "tags", aliases: ["tag", "labels"], help: "Separate several with ; or ,." },
    createdAt,
  ],
  CONTACT: [
    { key: "fullName", label: "Full name", type: "text", aliases: ["name", "fullname", "contactname", "contact"], help: "Used when there is no separate first name." },
    { key: "firstName", label: "First name", type: "text", aliases: ["first", "firstname", "givenname", "forename"] },
    { key: "lastName", label: "Last name", type: "text", aliases: ["last", "lastname", "surname", "familyname"] },
    { key: "email", label: "Email", type: "email", aliases: ["emailaddress", "mail", "email"] },
    { key: "phone", label: "Phone", type: "phone", aliases: ["telephone", "tel", "mobile", "phonenumber", "cell"] },
    { key: "company", label: "Company", type: "company", aliases: ["company", "companyname", "organisation", "organization", "account", "employer"] },
    { key: "jobTitle", label: "Job title", type: "text", aliases: ["title", "jobtitle", "position", "role"] },
    { key: "department", label: "Department", type: "text", aliases: ["dept", "department"] },
    { key: "notes", label: "Notes", type: "text", aliases: ["note", "comments", "remarks"] },
    owner("ownerEmail", "Owner", ["owner", "owneremail", "assignedto", "salesrep"]),
    { key: "tags", label: "Tags", type: "tags", aliases: ["tag", "labels"] },
    createdAt,
  ],
  LEAD: [
    { key: "contactName", label: "Contact name", type: "text", aliases: ["name", "fullname", "contactname", "lead", "leadname", "person"] },
    { key: "contactEmail", label: "Contact email", type: "email", aliases: ["email", "emailaddress", "contactemail", "mail"] },
    { key: "contactPhone", label: "Contact phone", type: "phone", aliases: ["phone", "telephone", "mobile", "contactphone", "phonenumber"] },
    { key: "company", label: "Company", type: "company", aliases: ["company", "companyname", "organisation", "organization", "business"] },
    { key: "leadStatus", label: "Lead status", type: "catalog", catalog: "leadStatus", aliases: ["status", "leadstatus", "state"], help: "Left empty, a lead starts as New." },
    { key: "leadSource", label: "Lead source", type: "catalog", catalog: "leadSource", aliases: ["source", "leadsource", "channel", "origin"] },
    { key: "serviceInterest", label: "Service interest", type: "catalog", catalog: "service", aliases: ["service", "interest", "product", "serviceinterest"] },
    { key: "temperature", label: "Temperature", type: "enum", options: ["HOT", "WARM", "COLD"], aliases: ["temperature", "priority", "rating"] },
    { key: "notes", label: "Notes", type: "text", aliases: ["note", "comments", "remarks", "message"] },
    owner("ownerEmail", "Owner", ["owner", "owneremail", "assignedto", "salesrep"]),
    { key: "tags", label: "Tags", type: "tags", aliases: ["tag", "labels"] },
    createdAt,
  ],
  DEAL: [
    { key: "name", label: "Deal name (kept in the notes)", type: "text", aliases: ["dealname", "name", "title", "opportunity"] },
    { key: "company", label: "Company", type: "company", required: true, aliases: ["company", "companyname", "organisation", "organization", "account", "customer", "client"] },
    { key: "contactEmail", label: "Primary contact email", type: "email", aliases: ["contactemail", "email", "primarycontact", "contact"] },
    { key: "value", label: "Value", type: "number", aliases: ["value", "amount", "dealvalue", "dealamount", "price", "worth"] },
    { key: "currency", label: "Currency", type: "text", aliases: ["currency", "ccy"] },
    { key: "stage", label: "Stage", type: "catalog", catalog: "stage", required: true, aliases: ["stage", "dealstage", "pipelinestage", "status"] },
    owner("ownerEmail", "Owner", ["owner", "owneremail", "dealowner", "assignedto", "salesrep"]),
    { key: "service", label: "Service", type: "catalog", catalog: "service", aliases: ["service", "product", "serviceinterest"] },
    { key: "expectedCloseDate", label: "Expected close date", type: "date", aliases: ["closedate", "expectedclose", "expectedclosedate", "closingdate", "expecteddate"] },
    { key: "closedOn", label: "Closed on", type: "date", aliases: ["closedon", "wonon", "lostdate", "dateclosed"], help: "For won or lost deals: when it closed." },
    { key: "lostReason", label: "Lost reason", type: "catalog", catalog: "lostReason", aliases: ["lostreason", "reasonlost", "reason", "whylost"], help: "For lost deals. Left empty, a lost deal is recorded as Other." },
    { key: "notes", label: "Notes", type: "text", aliases: ["note", "comments", "remarks", "description"] },
    { key: "tags", label: "Tags", type: "tags", aliases: ["tag", "labels"] },
    createdAt,
  ],
  TASK: [
    { key: "title", label: "Title", type: "text", required: true, aliases: ["title", "task", "subject", "taskname", "name"] },
    { key: "description", label: "Description", type: "text", aliases: ["description", "details", "notes", "note"] },
    { key: "dueDate", label: "Due date", type: "date", aliases: ["due", "duedate", "dueon", "deadline"] },
    owner("assigneeEmail", "Assigned to", ["assignee", "assigneeemail", "assignedto", "owner", "owneremail"]),
    { key: "status", label: "Status", type: "enum", options: ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"], aliases: ["status", "state"] },
    { key: "priority", label: "Priority", type: "enum", options: ["LOW", "MEDIUM", "HIGH"], aliases: ["priority", "importance"] },
    { key: "company", label: "Company", type: "company", aliases: ["company", "companyname", "organisation", "account"] },
    { key: "contactEmail", label: "Contact email", type: "email", aliases: ["contactemail", "contact", "email"] },
    createdAt,
  ],
  ACTIVITY: [
    { key: "type", label: "Type", type: "enum", required: true, options: ["CALL", "MEETING", "NOTE", "EMAIL", "WHATSAPP", "OTHER"], aliases: ["type", "activitytype", "kind"] },
    { key: "subject", label: "Subject", type: "text", aliases: ["subject", "title", "summary"] },
    { key: "description", label: "Description", type: "text", aliases: ["description", "details", "notes", "note", "body"] },
    { key: "occurredAt", label: "Happened on", type: "date", required: true, aliases: ["date", "occurredat", "happenedon", "when", "activitydate", "datetime"] },
    { key: "outcome", label: "Outcome", type: "text", aliases: ["outcome", "result"] },
    owner("authorEmail", "Done by", ["author", "authoremail", "doneby", "user", "owner", "owneremail"]),
    { key: "company", label: "Company", type: "company", aliases: ["company", "companyname", "organisation", "account"] },
    { key: "contactEmail", label: "Contact email", type: "email", aliases: ["contactemail", "contact", "email"] },
  ],
};

export function fieldsFor(entity: MigrationEntity): readonly FieldDef[] {
  return FIELDS[entity];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Lines a file's headers up with fields by name, once each: the header that matches a field's key or one of its aliases
 * wins, and a header is never used twice. The person still reviews and changes the result in the mapping step.
 */
export function suggestMapping(entity: MigrationEntity, headers: readonly string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of FIELDS[entity]) {
    const wanted = new Set([squash(field.key), squash(field.label), ...(field.aliases ?? []).map(squash)]);
    const match = headers.find((h) => !used.has(h) && wanted.has(squash(h)));
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  // "cf:<key>" columns (custom fields) and an exported file's own headers map to themselves.
  for (const h of headers) if (/^cf:[a-z][a-z0-9_]*$/.test(h) && !used.has(h)) mapping[h] = h;
  return mapping;
}

/** The header row and one example row of the fixed template for an entity, using the field keys as headers so it maps itself. */
export const TEMPLATE_EXAMPLES: Record<MigrationEntity, Record<string, string>> = {
  COMPANY: { name: "Kamau Hardware Ltd", industry: "Retail", website: "kamauhardware.co.ke", location: "Nairobi", phone: "0722 000 111", email: "info@kamauhardware.co.ke", notes: "Existing customer since 2021", lifecycleState: "Active Customer", ownerEmail: "sales@yourcompany.co.ke", tags: "hardware;nairobi", createdAt: "2024-03-14" },
  CONTACT: { firstName: "Amina", lastName: "Odhiambo", email: "amina@kamauhardware.co.ke", phone: "0722 123 456", company: "Kamau Hardware Ltd", jobTitle: "Operations Manager", department: "Operations", notes: "Prefers WhatsApp", ownerEmail: "sales@yourcompany.co.ke", tags: "decision-maker", createdAt: "2024-03-14" },
  LEAD: { contactName: "Brian Njoroge", contactEmail: "brian@example.co.ke", contactPhone: "0733 222 333", company: "Njoroge Logistics", leadStatus: "New", leadSource: "Referral", serviceInterest: "Fleet / GPS", temperature: "WARM", notes: "Asked about tracking 12 trucks", ownerEmail: "sales@yourcompany.co.ke", tags: "", createdAt: "2026-09-02" },
  DEAL: { name: "CCTV for the Westlands shop", company: "Kamau Hardware Ltd", contactEmail: "amina@kamauhardware.co.ke", value: "450000", currency: "KES", stage: "Negotiation", ownerEmail: "sales@yourcompany.co.ke", service: "CCTV", expectedCloseDate: "2026-11-30", closedOn: "", lostReason: "", notes: "8 cameras and a recorder", tags: "", createdAt: "2026-08-20" },
  TASK: { title: "Send the CCTV quote", description: "Include installation", dueDate: "2026-11-05", assigneeEmail: "sales@yourcompany.co.ke", status: "PENDING", priority: "HIGH", company: "Kamau Hardware Ltd", contactEmail: "amina@kamauhardware.co.ke", createdAt: "2026-10-20" },
  ACTIVITY: { type: "CALL", subject: "Call about the quote", description: "Confirmed the camera count", occurredAt: "2026-10-18 14:30", outcome: "Reached", authorEmail: "sales@yourcompany.co.ke", company: "Kamau Hardware Ltd", contactEmail: "amina@kamauhardware.co.ke" },
};

export function templateCsv(entity: MigrationEntity): string {
  const columns = FIELDS[entity].map((f) => f.key);
  const example = TEMPLATE_EXAMPLES[entity];
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${columns.join(",")}\n${columns.map((c) => cell(example[c] ?? "")).join(",")}\n`;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export class CellError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

/** A date from a spreadsheet or a CRM export: 2026-10-26, 26/10/2026, 26 Oct 2026, with an optional time. Day first, as in Kenya. */
export function parseDateCell(value: string, field: string): Date {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  let y: number, mo: number, d: number, h = 0, mi = 0, s = 0;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    [h, mi, s] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    [h, mi, s] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  } else if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(v))) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const idx = months.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (idx === -1) throw new CellError(field, `"${value}" is not a date.`);
    [d, mo, y] = [Number(m[1]), idx + 1, Number(m[3])];
    [h, mi] = [Number(m[4] ?? 0), Number(m[5] ?? 0)];
  } else {
    throw new CellError(field, `"${value}" is not a date. Use a form like 2026-10-26 or 26/10/2026.`);
  }
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || y < 1990 || y > 2100) {
    throw new CellError(field, `"${value}" is not a real date.`);
  }
  return date;
}

/** A money amount: 450000, 450,000.50, KES 450,000, 450000.5. Returns a number with at most two decimals. */
export function parseMoneyCell(value: string, field: string): number {
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const n = Number(cleaned.replace(/,/g, "."));
  if (!cleaned || !Number.isFinite(n) || n < 0 || n > 9_999_999_999_999) throw new CellError(field, `"${value}" is not an amount.`);
  return Math.round(n * 100) / 100;
}

export function parseEmailCell(value: string, field: string): string {
  const v = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) throw new CellError(field, `"${value}" is not an email address.`);
  return v;
}

export function splitTags(value: string | undefined): string[] {
  return (value ?? "").split(/[;,]/).map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 20);
}

export function splitFullName(name: string): { firstName: string; lastName?: string } {
  const t = name.trim().replace(/\s+/g, " ");
  const i = t.indexOf(" ");
  return i === -1 ? { firstName: t } : { firstName: t.slice(0, i), lastName: t.slice(i + 1) };
}
