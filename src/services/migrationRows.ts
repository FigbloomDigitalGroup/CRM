import { randomUUID } from "node:crypto";
import { canWorkAccounts } from "../auth/accountAccess";
import { adminDb } from "../db/adminClient";
import { applyValues, missingRequired, type FieldDefinition } from "../lib/customFields";
import {
  CellError,
  type MigrationEntity,
  parseDateCell,
  parseEmailCell,
  parseMoneyCell,
  splitFullName,
  splitTags,
} from "../lib/migrationFields";
import { normalizeCompanyName, normalizeEmail, phoneTail } from "../lib/matching";
import { toFieldDefinition } from "./customFieldService";
import { canWorkDeals, canWorkLeads, canWorkTasks } from "./ownerEligibility";
import { loadActiveDefinitions } from "./customFieldService";

/**
 * Turning one row of someone's file into a record, without touching the database (FIG-1061, B4.04). The data a row can refer
 * to (statuses, stages, people by email, companies by name, who is already in the CRM) is loaded once into `Lookups`; every
 * row is then resolved in memory, which is what lets 10,000 rows validate in seconds. The same `resolveRow` serves the
 * validation pass, the dry run and the import, so the three can never disagree about what a row means.
 */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Named {
  id: string;
  label: string;
}
export interface StageInfo extends Named {
  isWon: boolean;
  isLost: boolean;
}

export interface MemberInfo {
  id: string;
  email: string;
  name: string;
  permissionKeys: string[];
}

export interface Lookups {
  organizationId: string;
  importerMembershipId: string;
  defaultCurrency: string;
  catalogs: {
    leadStatus: Map<string, Named>;
    leadSource: Map<string, Named>;
    service: Map<string, Named>;
    stage: Map<string, StageInfo>;
    lifecycleState: Map<string, Named>;
    lostReason: Map<string, Named>;
  };
  membersByEmail: Map<string, MemberInfo>;
  companiesByName: Map<string, string[]>;
  companiesByEmail: Map<string, string>;
  contactsByEmail: Map<string, string>;
  contactsByPhone: Map<string, string>;
  openLeadByContact: Map<string, string>;
  dealKeys: Map<string, string>;
  tags: Map<string, string>;
  customFields: Partial<Record<"COMPANY" | "CONTACT" | "LEAD" | "DEAL", FieldDefinition[]>>;
  /** Companies created for earlier rows of this run, by normalised name, so a later row finds them. */
  pendingCompanies: Map<string, string>;
}

function index<T extends Named>(rows: { id: string; key: string; name: string }[], make: (r: { id: string; key: string; name: string }) => T): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const v = make(r);
    out.set(squash(r.name), v);
    out.set(squash(r.key), v);
  }
  return out;
}

/** Everything the rows of this entity may refer to. Loads only what the entity needs. */
export async function loadLookups(organizationId: string, importerMembershipId: string, entity: MigrationEntity): Promise<Lookups> {
  const org = { organizationId };
  const [org1, leadStatuses, leadSources, services, stages, lifecycle, members, tags, lostReasons] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { defaultCurrency: true } }),
    adminDb.leadStatus.findMany({ where: { ...org, isActive: true }, select: { id: true, key: true, name: true } }),
    adminDb.leadSource.findMany({ where: { ...org, isActive: true }, select: { id: true, key: true, name: true } }),
    adminDb.service.findMany({ where: { ...org, isActive: true }, select: { id: true, key: true, name: true } }),
    adminDb.pipelineStage.findMany({ where: { ...org, isActive: true }, select: { id: true, key: true, name: true, isWon: true, isLost: true } }),
    adminDb.customerLifecycleState.findMany({ where: { ...org, isActive: true }, select: { id: true, key: true, name: true } }),
    adminDb.membership.findMany({
      where: { ...org, status: "ACTIVE" },
      select: { id: true, user: { select: { email: true, name: true } }, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    }),
    adminDb.tag.findMany({ where: org, select: { id: true, name: true } }),
    adminDb.lostReason.findMany({ where: { ...org, isActive: true }, select: { id: true, key: true, name: true } }),
  ]);

  const membersByEmail = new Map<string, MemberInfo>();
  for (const m of members) {
    membersByEmail.set(m.user.email.toLowerCase(), { id: m.id, email: m.user.email.toLowerCase(), name: m.user.name, permissionKeys: m.role.rolePermissions.map((rp) => rp.permission.key) });
  }

  const lookups: Lookups = {
    organizationId,
    importerMembershipId,
    defaultCurrency: org1.defaultCurrency,
    catalogs: {
      leadStatus: index(leadStatuses, (r) => ({ id: r.id, label: r.name })),
      leadSource: index(leadSources, (r) => ({ id: r.id, label: r.name })),
      service: index(services, (r) => ({ id: r.id, label: r.name })),
      stage: index(stages, (r) => ({ id: r.id, label: r.name, isWon: stages.find((s) => s.id === r.id)!.isWon, isLost: stages.find((s) => s.id === r.id)!.isLost })),
      lifecycleState: index(lifecycle, (r) => ({ id: r.id, label: r.name })),
      lostReason: index(lostReasons, (r) => ({ id: r.id, label: r.name })),
    },
    membersByEmail,
    companiesByName: new Map(),
    companiesByEmail: new Map(),
    contactsByEmail: new Map(),
    contactsByPhone: new Map(),
    openLeadByContact: new Map(),
    dealKeys: new Map(),
    tags: new Map(tags.map((t) => [t.name.toLowerCase(), t.id])),
    customFields: {},
    pendingCompanies: new Map(),
  };

  const companies = await adminDb.company.findMany({ where: { ...org, archivedAt: null }, select: { id: true, name: true, email: true } });
  for (const c of companies) {
    const n = normalizeCompanyName(c.name);
    if (n) lookups.companiesByName.set(n, [...(lookups.companiesByName.get(n) ?? []), c.id]);
    const e = normalizeEmail(c.email);
    if (e) lookups.companiesByEmail.set(e, c.id);
  }
  if (entity === "CONTACT" || entity === "LEAD" || entity === "DEAL" || entity === "TASK" || entity === "ACTIVITY") {
    const contacts = await adminDb.contact.findMany({ where: { ...org, archivedAt: null }, select: { id: true, email: true, phone: true } });
    for (const c of contacts) {
      const e = normalizeEmail(c.email);
      if (e) lookups.contactsByEmail.set(e, c.id);
      const p = phoneTail(c.phone);
      if (p) lookups.contactsByPhone.set(p, c.id);
    }
  }
  if (entity === "LEAD") {
    const leads = await adminDb.lead.findMany({ where: { ...org, archivedAt: null, convertedAt: null, contactId: { not: null } }, select: { id: true, contactId: true } });
    for (const l of leads) if (l.contactId) lookups.openLeadByContact.set(l.contactId, l.id);
  }
  if (entity === "DEAL") {
    const deals = await adminDb.deal.findMany({ where: { ...org, archivedAt: null }, select: { id: true, companyId: true, serviceId: true, value: true, expectedCloseDate: true, pipelineStageId: true } });
    for (const d of deals) lookups.dealKeys.set(dealKey(d.companyId, d.serviceId, d.value?.toString() ?? null, d.expectedCloseDate, d.pipelineStageId), d.id);
  }
  if (entity === "COMPANY" || entity === "CONTACT" || entity === "LEAD" || entity === "DEAL") {
    lookups.customFields[entity] = (await loadActiveDefinitions(organizationId, entity, "GENERAL")).map(toFieldDefinition);
  }
  return lookups;
}

export function dealKey(companyId: string, serviceId: string | null, value: string | number | null, close: Date | null, stageId: string): string {
  const v = value === null || value === undefined || value === "" ? "" : Number(value).toFixed(2);
  return [companyId, serviceId ?? "", v, close ? close.toISOString().slice(0, 10) : "", stageId].join("|");
}

// ---------------------------------------------------------------------------
// Resolving a row
// ---------------------------------------------------------------------------

export interface Issue {
  field?: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface UnmappedValue {
  field: string;
  value: string;
}

export interface RowOptions {
  /** target field key -> header in the file */
  mapping: Record<string, string>;
  /** field key -> raw value in the file -> value in the CRM (a name, or an email for people) */
  valueMappings: Record<string, Record<string, string>>;
  createMissingCompanies: boolean;
}

export interface NewContact {
  id: string;
  data: Record<string, unknown>;
}

export interface ResolvedRow {
  ok: true;
  entity: MigrationEntity;
  /** The record's own columns, ready for `createMany` once the id, organisation and session are added. */
  data: Record<string, unknown>;
  /** A company this row needs that does not exist yet. */
  newCompany?: { key: string; name: string };
  /** A contact this lead needs that does not exist yet. */
  newContact?: NewContact;
  tags: string[];
  /** Fields the file actually carried a value for, so an update never blanks anything. */
  provided: string[];
  match: { id: string; reason: string } | null;
  warnings: Issue[];
  /** A few words per field for the dry-run sample. */
  preview: Record<string, string>;
}

export interface FailedRow {
  ok: false;
  issues: Issue[];
  unmapped: UnmappedValue[];
}

class Fail extends Error {}

function clean(value: string | undefined, max: number): string | undefined {
  const v = value?.replace(/\s+/g, " ").trim();
  if (!v) return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

export function resolveRow(entity: MigrationEntity, raw: Record<string, string>, opts: RowOptions, lk: Lookups, now: Date): ResolvedRow | FailedRow {
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const unmapped: UnmappedValue[] = [];
  const provided: string[] = [];
  const preview: Record<string, string> = {};

  // The value-mapping index: case- and punctuation-insensitive on the file's value.
  const vm = new Map<string, Map<string, string>>();
  for (const [field, table] of Object.entries(opts.valueMappings)) vm.set(field, new Map(Object.entries(table).map(([k, v]) => [squash(k), v])));

  const mappedField = (key: string) => key in opts.mapping && opts.mapping[key] !== "" && opts.mapping[key] !== undefined;
  const cellRaw = (key: string): string | undefined => {
    const header = opts.mapping[key];
    if (!header) return undefined;
    const v = raw[header];
    return v === undefined || v.trim() === "" ? undefined : v.trim();
  };
  const fail = (field: string | undefined, message: string) => issues.push({ field, message, severity: "ERROR" });
  const warn = (field: string | undefined, message: string) => warnings.push({ field, message, severity: "WARNING" });

  const guard = <T>(field: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof CellError || err instanceof Fail) {
        fail(err instanceof CellError ? err.field : field, err.message);
        return undefined;
      }
      throw err;
    }
  };

  const text = (key: string, max: number): string | undefined => {
    const v = clean(cellRaw(key), max);
    if (v !== undefined) {
      provided.push(key);
      preview[key] = v.length > 40 ? `${v.slice(0, 37)}...` : v;
    }
    return v;
  };

  const valueMapped = (field: string, value: string): string => vm.get(field)?.get(squash(value)) ?? value;

  function catalog<T extends Named>(field: string, map: Map<string, T>, label: string, required = false): T | undefined {
    const v = cellRaw(field);
    if (v === undefined) {
      if (required) fail(field, `${label} is required.`);
      return undefined;
    }
    const found = map.get(squash(valueMapped(field, v)));
    if (!found) {
      unmapped.push({ field, value: v });
      fail(field, `"${v}" does not match any ${label.toLowerCase()} in this CRM. Map it in the value mapping step, or add it in Settings.`);
      return undefined;
    }
    provided.push(field);
    preview[field] = found.label;
    return found;
  }

  function member(field: string, eligible: (permissionKeys: string[]) => boolean, noun: string, missing: "importer" | "none" | "error"): string | undefined {
    const v = cellRaw(field);
    if (v === undefined) {
      if (mappedField(field) && missing === "error") {
        fail(field, `The ${noun} is required, and this row has none.`);
        return undefined;
      }
      if (missing === "importer") {
        const importer = [...lk.membersByEmail.values()].find((m) => m.id === lk.importerMembershipId);
        return importer && eligible(importer.permissionKeys) ? lk.importerMembershipId : undefined;
      }
      return undefined;
    }
    const email = normalizeEmail(valueMapped(field, v).includes("@") ? valueMapped(field, v) : v);
    const found = email ? lk.membersByEmail.get(email) ?? lk.membersByEmail.get(valueMapped(field, v).toLowerCase()) : undefined;
    if (!found) {
      unmapped.push({ field, value: v });
      fail(field, `No active member of this CRM has the email "${v}". Map it to someone in the value mapping step.`);
      return undefined;
    }
    if (!eligible(found.permissionKeys)) {
      fail(field, `${found.name} cannot be the ${noun}: their role cannot work these records.`);
      return undefined;
    }
    provided.push(field);
    preview[field] = found.name;
    return found.id;
  }

  /** A company by name: found, or created when the options say so. */
  function company(field: string): { id?: string; create?: { key: string; name: string } } {
    const v = clean(cellRaw(field), 200);
    if (!v) return {};
    provided.push(field);
    preview[field] = v;
    const key = normalizeCompanyName(v);
    const pending = lk.pendingCompanies.get(key);
    if (pending) return { id: pending };
    const matches = lk.companiesByName.get(key) ?? [];
    if (matches.length === 1) return { id: matches[0] };
    if (matches.length > 1) {
      fail(field, `More than one company in the CRM is called "${v}". Make the name more specific or merge the duplicates first.`);
      return {};
    }
    if (opts.createMissingCompanies) return { create: { key, name: v } };
    fail(field, `No company called "${v}" is in the CRM. Import the companies first, or switch on creating missing companies.`);
    return {};
  }

  function contactByEmail(field: string): string | undefined {
    const v = cellRaw(field);
    if (!v) return undefined;
    const e = guard(field, () => parseEmailCell(v, field));
    if (!e) return undefined;
    provided.push(field);
    const id = lk.contactsByEmail.get(normalizeEmail(e) ?? e);
    if (!id) warn(field, `No contact with the email ${e} is in the CRM, so the row was not linked to one.`);
    return id;
  }

  const date = (key: string): Date | undefined => {
    const v = cellRaw(key);
    if (v === undefined) return undefined;
    const d = guard(key, () => parseDateCell(v, key));
    if (d) {
      provided.push(key);
      preview[key] = d.toISOString().slice(0, 10);
    }
    return d && d.getTime() > now.getTime() + 24 * 3600_000 && (key === "createdAt" || key === "occurredAt") ? (fail(key, "That date is in the future."), undefined) : d;
  };

  const email = (key: string): string | undefined => {
    const v = cellRaw(key);
    if (v === undefined) return undefined;
    const e = guard(key, () => parseEmailCell(v, key));
    if (e) {
      provided.push(key);
      preview[key] = e;
    }
    return e;
  };

  const enumValue = (key: string, options: readonly string[], fallback?: string): string | undefined => {
    const v = cellRaw(key);
    if (v === undefined) return fallback;
    const mapped = valueMapped(key, v).toUpperCase().replace(/[\s-]+/g, "_");
    if (!options.includes(mapped)) {
      unmapped.push({ field: key, value: v });
      fail(key, `"${v}" is not one of ${options.join(", ")}.`);
      return undefined;
    }
    provided.push(key);
    preview[key] = mapped;
    return mapped;
  };

  /** `cf:<key>` columns, validated against the organisation's field definitions. */
  const customFields = (): Record<string, unknown> | undefined => {
    const defs2 = (entity === "COMPANY" || entity === "CONTACT" || entity === "LEAD" || entity === "DEAL" ? lk.customFields[entity] : undefined) ?? [];
    const byKey = new Map(defs2.map((d) => [d.key, d]));
    const incoming: Record<string, unknown> = {};
    for (const field of Object.keys(opts.mapping).filter((f) => f.startsWith("cf:"))) {
      const cell = cellRaw(field);
      const key = field.slice(3);
      if (cell === undefined) continue;
      const def = byKey.get(key);
      if (!def) {
        fail(field, `"${key}" is not a custom field of this record type.`);
        continue;
      }
      incoming[key] = def.fieldType === "NUMBER" ? Number(cell) : def.fieldType === "MULTISELECT" ? cell.split(";").map((s) => s.trim()).filter(Boolean) : def.fieldType === "BOOLEAN" ? (["true", "yes", "1"].includes(cell.toLowerCase()) ? true : ["false", "no", "0"].includes(cell.toLowerCase()) ? false : cell) : cell;
    }
    if (Object.keys(incoming).length === 0) {
      const missing = missingRequired(defs2, {}, "save");
      if (missing.length > 0) fail(undefined, missing.map((i) => i.message).join(" "));
      return undefined;
    }
    const result = applyValues(defs2, incoming, { unknownKeys: "reject" });
    const all = [...result.issues, ...missingRequired(defs2, result.values, "save")];
    if (all.length > 0) {
      fail(undefined, all.map((i) => i.message).join(" "));
      return undefined;
    }
    provided.push("customFields");
    return result.values;
  };

  const tags = (): string[] => {
    const header = opts.mapping.tags ?? (raw.tags !== undefined && !("tags" in opts.mapping) ? "tags" : undefined);
    if (!header) return [];
    const list = splitTags(raw[header]);
    if (list.length > 0) provided.push("tags");
    return list;
  };

  const createdAt = date("createdAt");
  const data: Record<string, unknown> = {};
  let newCompany: ResolvedRow["newCompany"];
  let newContact: ResolvedRow["newContact"];
  let match: ResolvedRow["match"] = null;

  switch (entity) {
    case "COMPANY": {
      const name = text("name", 200);
      if (!name) fail("name", "The company name is required.");
      const emailValue = email("email");
      data.name = name;
      data.industry = text("industry", 100);
      data.website = text("website", 200);
      data.location = text("location", 200);
      data.phone = text("phone", 40);
      data.email = emailValue;
      data.notes = text("notes", 4000);
      data.lifecycleStateId = catalog("lifecycleState", lk.catalogs.lifecycleState, "customer state")?.id;
      data.ownerMembershipId = member("ownerEmail", (p) => canWorkAccounts(p, "companies"), "owner", "importer");
      data.createdByMembershipId = lk.importerMembershipId;
      data.customFields = customFields() ?? {};
      if (name) {
        const byName = lk.companiesByName.get(normalizeCompanyName(name));
        const byEmail = emailValue ? lk.companiesByEmail.get(normalizeEmail(emailValue) ?? "") : undefined;
        const id = byName?.[0] ?? byEmail;
        if (id) match = { id, reason: byName?.[0] ? "A company with the same name exists." : "A company with the same email exists." };
      }
      break;
    }

    case "CONTACT": {
      let firstName = text("firstName", 100);
      let lastName = text("lastName", 100);
      const full = clean(cellRaw("fullName"), 200);
      if (!firstName && full) {
        const parts = splitFullName(full);
        firstName = parts.firstName;
        lastName = lastName ?? parts.lastName;
        provided.push("fullName");
        preview.fullName = full;
      }
      if (!firstName) fail("firstName", "The contact needs a first name, or a full name.");
      const emailValue = email("email");
      const phone = text("phone", 40);
      const c = company("company");
      data.firstName = firstName;
      data.lastName = lastName;
      data.email = emailValue;
      data.phone = phone;
      data.companyId = c.id;
      newCompany = c.create;
      data.jobTitle = text("jobTitle", 100);
      data.department = text("department", 100);
      data.notes = text("notes", 4000);
      data.ownerMembershipId = member("ownerEmail", (p) => canWorkAccounts(p, "contacts"), "owner", "importer");
      data.createdByMembershipId = lk.importerMembershipId;
      data.customFields = customFields() ?? {};
      const byEmail = emailValue ? lk.contactsByEmail.get(normalizeEmail(emailValue) ?? "") : undefined;
      const byPhone = phone ? lk.contactsByPhone.get(phoneTail(phone) ?? "") : undefined;
      if (byEmail || byPhone) match = { id: (byEmail ?? byPhone)!, reason: byEmail ? "A contact with the same email exists." : "A contact with the same phone number exists." };
      break;
    }

    case "LEAD": {
      const contactName = clean(cellRaw("contactName"), 200);
      const contactEmail = email("contactEmail");
      const contactPhone = text("contactPhone", 40);
      const c = company("company");
      if (contactName) {
        provided.push("contactName");
        preview.contactName = contactName;
      }
      if (!contactName && !contactEmail && !contactPhone && !c.id && !c.create) fail(undefined, "A lead needs a contact (name, email or phone) or a company.");
      let contactId: string | undefined;
      if (contactEmail || contactPhone) {
        const byEmail = contactEmail ? lk.contactsByEmail.get(normalizeEmail(contactEmail) ?? "") : undefined;
        const byPhone = contactPhone ? lk.contactsByPhone.get(phoneTail(contactPhone) ?? "") : undefined;
        contactId = byEmail ?? byPhone;
      }
      if (!contactId && (contactName || contactEmail || contactPhone)) {
        const parts = splitFullName(contactName ?? contactEmail ?? contactPhone ?? "Unknown");
        newContact = {
          id: randomUUID(),
          data: { firstName: parts.firstName.slice(0, 100), lastName: parts.lastName?.slice(0, 100), email: contactEmail, phone: contactPhone, companyId: c.id },
        };
        contactId = newContact.id;
      }
      newCompany = c.create;
      const status = catalog("leadStatus", lk.catalogs.leadStatus, "lead status");
      data.leadStatusId = status?.id ?? lk.catalogs.leadStatus.get("new")?.id;
      if (!data.leadStatusId) fail("leadStatus", "This CRM has no lead status called New to start leads in.");
      data.leadSourceId = catalog("leadSource", lk.catalogs.leadSource, "lead source")?.id;
      data.serviceInterestId = catalog("serviceInterest", lk.catalogs.service, "service")?.id;
      data.temperature = enumValue("temperature", ["HOT", "WARM", "COLD"], "WARM");
      data.notes = text("notes", 4000);
      data.ownerMembershipId = member("ownerEmail", canWorkLeads, "owner", "none");
      data.contactId = contactId;
      data.companyId = c.id;
      data.createdByMembershipId = lk.importerMembershipId;
      data.customFields = customFields() ?? {};
      if (contactId && !newContact) {
        const openLead = lk.openLeadByContact.get(contactId);
        if (openLead) match = { id: openLead, reason: "This contact already has an open lead." };
      }
      break;
    }

    case "DEAL": {
      const c = company("company");
      if (!c.id && !c.create && !issues.some((i) => i.field === "company")) fail("company", "The company is required.");
      newCompany = c.create;
      const stage = catalog("stage", lk.catalogs.stage, "pipeline stage", true);
      const service = catalog("service", lk.catalogs.service, "service");
      const ownerId = member("ownerEmail", canWorkDeals, "deal owner", mappedField("ownerEmail") ? "error" : "importer");
      const valueRaw = cellRaw("value");
      const value = valueRaw !== undefined ? guard("value", () => parseMoneyCell(valueRaw, "value")) : undefined;
      if (value !== undefined) {
        provided.push("value");
        preview.value = String(value);
      }
      const currency = text("currency", 3)?.toUpperCase();
      if (currency && !/^[A-Z]{3}$/.test(currency)) fail("currency", `"${currency}" is not a three-letter currency code.`);
      const expected = date("expectedCloseDate");
      const closedOn = date("closedOn");
      const dealName = text("name", 200);
      const notes = text("notes", 4000);
      const primaryContactId = contactByEmail("contactEmail");
      data.companyId = c.id;
      data.primaryContactId = primaryContactId;
      data.serviceId = service?.id;
      data.ownerMembershipId = ownerId;
      data.pipelineStageId = stage?.id;
      data.value = value;
      data.currency = currency ?? lk.defaultCurrency;
      data.expectedCloseDate = expected;
      data.notes = [dealName ? `Deal: ${dealName}` : null, notes].filter(Boolean).join("\n") || undefined;
      data.createdByMembershipId = lk.importerMembershipId;
      data.customFields = customFields() ?? {};
      // The outcome follows the stage, as it does everywhere else; no handoff, lifecycle move or notification runs for history.
      const closedAt = closedOn ?? expected ?? createdAt ?? now;
      if (stage?.isWon) {
        data.outcome = "WON";
        data.wonAt = closedAt;
      } else if (stage?.isLost) {
        data.outcome = "LOST";
        data.lostAt = closedAt;
        // A lost deal needs a reason. The file's own, or Other with a note saying so; never a guess.
        const given = catalog("lostReason", lk.catalogs.lostReason, "lost reason");
        const reason = given ?? lk.catalogs.lostReason.get("other");
        if (!reason) fail("lostReason", "A lost deal needs a lost reason, and this CRM has no reason called Other to fall back on.");
        else if (!given) warn("lostReason", "No lost reason in the file, so the deal was recorded as lost for Other.");
        data.lostReasonId = reason?.id;
      } else {
        data.outcome = "OPEN";
      }
      // Imported open deals count as active from the day they arrive, so they are not stalled before anyone has seen them.
      data.lastActivityAt = data.outcome === "OPEN" ? now : closedAt;
      if (c.id && stage) {
        const key = dealKey(c.id, (data.serviceId as string | undefined) ?? null, value ?? null, expected ?? null, stage.id);
        const existing = lk.dealKeys.get(key);
        if (existing) match = { id: existing, reason: "A deal with the same company, service, value, stage and close date exists." };
      }
      break;
    }

    case "TASK": {
      const title = text("title", 200);
      if (!title) fail("title", "The task needs a title.");
      const due = date("dueDate");
      const status = enumValue("status", ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"], "PENDING");
      const priority = enumValue("priority", ["LOW", "MEDIUM", "HIGH"], "MEDIUM");
      const assignee = member("assigneeEmail", canWorkTasks, "assignee", "importer");
      if (!assignee) fail("assigneeEmail", "The task has nobody who can work it; map the assignee or pick an importer whose role can work tasks.");
      const c = company("company");
      newCompany = c.create;
      const contactId = contactByEmail("contactEmail");
      data.title = title;
      data.description = text("description", 4000);
      data.dueAt = due;
      data.status = status;
      data.completedAt = status === "COMPLETED" ? (createdAt ?? due ?? now) : undefined;
      data.priority = priority;
      data.assigneeMembershipId = assignee;
      data.createdByMembershipId = lk.importerMembershipId;
      data.companyId = c.id;
      data.contactId = contactId;
      break;
    }

    case "ACTIVITY": {
      const type = enumValue("type", ["CALL", "MEETING", "NOTE", "EMAIL", "WHATSAPP", "OTHER"]);
      if (!type && !issues.some((i) => i.field === "type")) fail("type", "The activity type is required.");
      const occurredAt = date("occurredAt");
      if (!occurredAt && !issues.some((i) => i.field === "occurredAt")) fail("occurredAt", "The date the activity happened is required.");
      const author = member("authorEmail", () => true, "author", "importer");
      const c = company("company");
      newCompany = c.create;
      const contactId = contactByEmail("contactEmail");
      if (!c.id && !c.create && !contactId) fail(undefined, "An activity belongs to a company or a contact in the CRM; this row names neither.");
      data.type = type;
      data.subject = text("subject", 200);
      data.description = text("description", 4000);
      data.occurredAt = occurredAt;
      data.outcome = text("outcome", 200);
      data.authorMembershipId = author;
      data.companyId = c.id;
      data.contactId = contactId;
      break;
    }
  }

  if (createdAt && entity !== "ACTIVITY") data.createdAt = createdAt;
  const tagNames = entity === "COMPANY" || entity === "CONTACT" || entity === "LEAD" || entity === "DEAL" ? tags() : [];

  if (issues.length > 0) return { ok: false, issues: [...issues, ...warnings], unmapped };
  // Prisma wants undefined, not null, for "leave to the default".
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return { ok: true, entity, data, newCompany, newContact, tags: tagNames, provided, match, warnings, preview };
}

/** Records the keys of a row that was just planned, so a later row in the same file finds it as a duplicate. */
export function remember(entity: MigrationEntity, row: ResolvedRow, id: string, lk: Lookups): void {
  const d = row.data;
  if (entity === "COMPANY") {
    const n = normalizeCompanyName(String(d.name));
    lk.companiesByName.set(n, [...(lk.companiesByName.get(n) ?? []), id]);
    const e = normalizeEmail(d.email as string | undefined);
    if (e) lk.companiesByEmail.set(e, id);
  } else if (entity === "CONTACT") {
    const e = normalizeEmail(d.email as string | undefined);
    if (e) lk.contactsByEmail.set(e, id);
    const p = phoneTail(d.phone as string | undefined);
    if (p) lk.contactsByPhone.set(p, id);
  } else if (entity === "LEAD" && d.contactId) {
    lk.openLeadByContact.set(d.contactId as string, id);
  } else if (entity === "DEAL" && d.companyId && d.pipelineStageId) {
    lk.dealKeys.set(dealKey(d.companyId as string, (d.serviceId as string | undefined) ?? null, (d.value as number | undefined) ?? null, (d.expectedCloseDate as Date | undefined) ?? null, d.pipelineStageId as string), id);
  }
  if (row.newContact) {
    const nc = row.newContact.data;
    const e = normalizeEmail(nc.email as string | undefined);
    if (e) lk.contactsByEmail.set(e, row.newContact.id);
    const p = phoneTail(nc.phone as string | undefined);
    if (p) lk.contactsByPhone.set(p, row.newContact.id);
  }
}
