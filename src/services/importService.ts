import type { Readable } from "node:stream";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import type { AccountKind } from "../auth/accountAccess";
import { processInBatches } from "../lib/asyncBatch";
import { parseCsvRows } from "../lib/csv";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createCompany,
  findPossibleDuplicateCompanies,
} from "../repositories/companies";
import {
  createContact,
  findPossibleDuplicateContacts,
} from "../repositories/contacts";
import { createLead, findConvertedLeadMatches, findPossibleDuplicateLeads } from "../repositories/leads";
import { applyValues, missingRequired, type FieldDefinition } from "../lib/customFields";
import { loadActiveDefinitions, toFieldDefinition } from "./customFieldService";
import { findDuplicates } from "./duplicateService";
import { assertEligibleAccountOwner } from "./ownerEligibility";
import { changeTags } from "./tagService";

/**
 * Hard ceiling on rows processed per import call, independent of upload
 * size -- the CSV is streamed row-by-row (see `parseCsvRows`) so memory
 * never scales with file size, but DB writes still do, so this is the
 * actual backstop against a runaway request (FIG-596, no job-queue
 * infrastructure exists in this project to hand large imports off to).
 */
function maxImportRows(): number {
  const raw = process.env.IMPORT_MAX_ROWS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20_000;
}

const BATCH_SIZE = 20;
const MAX_REPORTED_ERRORS = 500;

export type DuplicateStrategy = "skip" | "create";

export type ImportRowOutcome = "failed" | "duplicate" | "already_converted" | "warning";

export interface ImportRowError {
  row: number;
  reason: string;
  /** What happened to the row; rows that failed leave nothing behind, a warning means the record was created. */
  outcome?: ImportRowOutcome;
  /** The existing record a duplicate or already-converted row matched. */
  matchedId?: string;
}

export interface ImportSummary {
  totalRows: number;
  created: number;
  duplicatesSkipped: number;
  /** Leads only: rows for a contact or company that already has a converted lead. */
  alreadyConverted: number;
  failed: number;
  truncated: boolean;
  cancelled: boolean;
  /** At most 500 in the request-time summary; background runs keep every row for the error report. */
  errors: ImportRowError[];
}

/** What a background import adds: progress, cancelling, and a complete error list. */
export interface ImportHooks {
  onProgress?: (summary: ImportSummary) => Promise<void>;
  isCancelled?: () => Promise<boolean>;
  /** Keep every problem row (up to this many) instead of the first 500. */
  maxErrors?: number;
}

/** Thrown by a row resolver for a problem specific to that one row -- caught per-row, never aborts the whole import. */
class RowValidationError extends Error {}

function requiredCell(
  rawRow: Record<string, string>,
  mapping: Record<string, string | undefined>,
  field: string,
): string {
  const header = mapping[field];
  const value = header ? rawRow[header]?.trim() : undefined;
  if (!value) {
    throw new RowValidationError(`"${field}" is required but was empty.`);
  }
  return value;
}

function optionalCell(
  rawRow: Record<string, string>,
  mapping: Record<string, string | undefined>,
  field: string,
): string | undefined {
  const header = mapping[field];
  const value = header ? rawRow[header]?.trim() : undefined;
  return value ? value : undefined;
}

async function resolveOwnerMembershipId(
  organizationId: string,
  email: string | undefined,
): Promise<string | undefined> {
  if (!email) return undefined;
  const user = await adminDb.user.findUnique({ where: { email } });
  const membership = user
    ? await adminDb.membership.findFirst({
        where: { organizationId, userId: user.id, status: "ACTIVE" },
      })
    : null;
  if (!membership) {
    throw new RowValidationError(
      `No active member with email "${email}" found in this organization.`,
    );
  }
  return membership.id;
}

/**
 * Company/contact imports: the named owner must be someone who can work
 * the records (not Delivery/Finance), and rows that name nobody belong to
 * whoever ran the import rather than being left orphaned.
 */
async function resolveAccountOwner(
  organizationId: string,
  email: string | undefined,
  kind: AccountKind,
  importerMembershipId: string,
): Promise<string> {
  const membershipId = await resolveOwnerMembershipId(organizationId, email);
  if (!membershipId) return importerMembershipId;
  try {
    await assertEligibleAccountOwner(organizationId, membershipId, kind);
  } catch (err) {
    if (err instanceof ValidationError) throw new RowValidationError(err.message);
    throw err;
  }
  return membershipId;
}

async function resolveCompanyIdByName(
  organizationId: string,
  name: string | undefined,
): Promise<string | undefined> {
  if (!name) return undefined;
  const matches = await adminDb.company.findMany({
    where: {
      organizationId,
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 0) {
    throw new RowValidationError(
      `No existing company named "${name}" found -- create it first or leave this column blank.`,
    );
  }
  if (matches.length > 1) {
    throw new RowValidationError(
      `More than one existing company is named "${name}" -- link by a more specific name or leave blank.`,
    );
  }
  return matches[0].id;
}

type NamedCatalog = "leadStatus" | "leadSource" | "service" | "customerLifecycleState";

async function findByOrgAndName(
  table: NamedCatalog,
  organizationId: string,
  name: string,
): Promise<{ id: string } | null> {
  const where = { organizationId, name: { equals: name, mode: "insensitive" as const } };
  switch (table) {
    case "leadStatus":
      return adminDb.leadStatus.findFirst({ where, select: { id: true } });
    case "leadSource":
      return adminDb.leadSource.findFirst({ where, select: { id: true } });
    case "service":
      return adminDb.service.findFirst({ where, select: { id: true } });
    case "customerLifecycleState":
      return adminDb.customerLifecycleState.findFirst({ where, select: { id: true } });
  }
}

async function resolveByName(
  organizationId: string,
  table: NamedCatalog,
  name: string | undefined,
  fieldLabel: string,
): Promise<string | undefined> {
  if (!name) return undefined;
  const match = await findByOrgAndName(table, organizationId, name);
  if (!match) {
    throw new RowValidationError(
      `"${fieldLabel}" value "${name}" does not match any configured option for this organization.`,
    );
  }
  return match.id;
}

/** The text of one CSV cell as the value a custom field of this type stores. */
function csvValueFor(def: FieldDefinition, cell: string): unknown {
  switch (def.fieldType) {
    case "NUMBER":
      return Number(cell);
    case "BOOLEAN": {
      const v = cell.toLowerCase();
      if (["true", "yes", "1"].includes(v)) return true;
      if (["false", "no", "0"].includes(v)) return false;
      return cell;
    }
    case "MULTISELECT":
      return cell.split(";").map((s) => s.trim()).filter(Boolean);
    default:
      return cell;
  }
}

/**
 * Tags and custom fields from the file (FIG-798, FIG-803). A `tags` column holds names
 * separated by ";"; a `cf:<key>` column holds that custom field. The headers an export
 * writes are read back as they are, with no mapping needed, and a mapping entry can point
 * either at another header.
 */
async function extraColumns(
  organizationId: string,
  entityType: "LEAD" | "CONTACT" | "COMPANY",
  rawRow: Record<string, string>,
  mapping: Record<string, string | undefined>,
): Promise<{ customFields?: Record<string, unknown>; tags: string[] }> {
  const tagHeader = mapping.tags ?? "tags";
  const tags = (rawRow[tagHeader] ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);

  const incoming: Record<string, unknown> = {};
  const defs = (await loadActiveDefinitions(organizationId, entityType, "GENERAL")).map(toFieldDefinition);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const key of new Set([...Object.keys(rawRow).filter((h) => h.startsWith("cf:")).map((h) => h.slice(3)), ...Object.keys(mapping).filter((f) => f.startsWith("cf:")).map((f) => f.slice(3))])) {
    const header = mapping[`cf:${key}`] ?? `cf:${key}`;
    const cell = rawRow[header]?.trim();
    const def = byKey.get(key);
    if (!cell) continue;
    if (!def) throw new RowValidationError(`"${header}" is not a custom field of this record.`);
    incoming[key] = csvValueFor(def, cell);
  }

  if (Object.keys(incoming).length === 0) {
    // Required fields still apply to an imported record.
    const missing = missingRequired(defs, {}, "save");
    if (missing.length > 0) throw new RowValidationError(missing.map((i) => i.message).join(" "));
    return { tags };
  }
  const result = applyValues(defs, incoming, { unknownKeys: "reject" });
  const issues = [...result.issues, ...missingRequired(defs, result.values, "save")];
  if (issues.length > 0) throw new RowValidationError(issues.map((i) => i.message).join(" "));
  return { customFields: result.values, tags };
}

/** Why a row was not imported although it is not an error: the matching record, if any. */
export type RowHold = { outcome: "duplicate" | "already_converted"; matchedId?: string; reason: string };

interface RunImportOptions<TCandidate> {
  organizationId: string;
  fileStream: Readable;
  duplicateStrategy: DuplicateStrategy;
  resolveCandidate: (
    rawRow: Record<string, string>,
    mapping: Record<string, string | undefined>,
  ) => Promise<TCandidate>;
  /** A reason to leave this row out (a duplicate, an already-converted lead), or null to import it. */
  findHold: (candidate: TCandidate, strategy: DuplicateStrategy) => Promise<RowHold | null>;
  create: (candidate: TCandidate) => Promise<{ id: string }>;
  /** Tags from the row, applied after the record exists. A failure is a warning, not a failed row. */
  afterCreate?: (record: { id: string }, rawRow: Record<string, string>, mapping: Record<string, string | undefined>) => Promise<void>;
  hooks?: ImportHooks;
}

async function runImport<TCandidate>(
  mapping: Record<string, string | undefined>,
  opts: RunImportOptions<TCandidate>,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    totalRows: 0,
    created: 0,
    duplicatesSkipped: 0,
    alreadyConverted: 0,
    failed: 0,
    truncated: false,
    cancelled: false,
    errors: [],
  };
  const maxErrors = opts.hooks?.maxErrors ?? MAX_REPORTED_ERRORS;
  const note = (entry: ImportRowError) => {
    if (summary.errors.length < maxErrors) summary.errors.push(entry);
  };

  async function handleRow(rawRow: Record<string, string>, row: number) {
    try {
      const candidate = await opts.resolveCandidate(rawRow, mapping);
      const hold = await opts.findHold(candidate, opts.duplicateStrategy);
      if (hold) {
        if (hold.outcome === "already_converted") summary.alreadyConverted += 1;
        else summary.duplicatesSkipped += 1;
        note({ row, reason: hold.reason, outcome: hold.outcome, matchedId: hold.matchedId });
        return;
      }
      const record = await opts.create(candidate);
      summary.created += 1;
      if (opts.afterCreate) {
        try {
          await opts.afterCreate(record, rawRow, mapping);
        } catch (err) {
          note({ row, reason: `Created, but the tags were not applied: ${err instanceof Error ? err.message : "unknown error"}`, outcome: "warning" });
        }
      }
    } catch (err) {
      summary.failed += 1;
      note({
        row,
        reason: err instanceof Error ? err.message : "Unknown error.",
        outcome: "failed",
      });
    }
  }

  const maxRows = maxImportRows();
  let rowNumber = 1; // header is row 1, first data row is row 2
  let stopped = false;
  const PROGRESS_EVERY = 50;

  async function* boundedRows() {
    for await (const rawRow of parseCsvRows(opts.fileStream)) {
      rowNumber += 1;
      if (rowNumber - 1 > maxRows) {
        stopped = true;
        summary.truncated = true;
        return;
      }
      if (opts.hooks && (rowNumber - 1) % PROGRESS_EVERY === 0) {
        await opts.hooks.onProgress?.(summary);
        if (await opts.hooks.isCancelled?.()) {
          stopped = true;
          summary.cancelled = true;
          return;
        }
      }
      summary.totalRows = rowNumber - 1;
      yield { rawRow, row: rowNumber };
    }
  }

  await processInBatches(boundedRows(), BATCH_SIZE, ({ rawRow, row }) =>
    handleRow(rawRow, row),
  );

  if (stopped) {
    // Drain the rest of the stream so it doesn't dangle.
    opts.fileStream.destroy();
  }
  await opts.hooks?.onProgress?.(summary);

  return summary;
}

async function applyTags(
  ctx: AuthContext,
  entity: "lead" | "contact" | "company",
  id: string,
  rawRow: Record<string, string>,
  mapping: Record<string, string | undefined>,
) {
  const names = (rawRow[mapping.tags ?? "tags"] ?? "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (names.length > 0) await changeTags(ctx, entity, id, { addTagNames: names });
}

export interface ImportCompaniesInput {
  fileStream: Readable;
  mapping: Record<string, string | undefined>;
  duplicateStrategy: DuplicateStrategy;
  hooks?: ImportHooks;
}

export async function importCompanies(
  ctx: AuthContext,
  input: ImportCompaniesInput,
): Promise<ImportSummary> {
  requirePermission(ctx, "companies.import");

  const summary = await runImport(input.mapping, {
    organizationId: ctx.organizationId,
    fileStream: input.fileStream,
    duplicateStrategy: input.duplicateStrategy,
    hooks: input.hooks,
    resolveCandidate: async (rawRow, mapping) => {
      const name = requiredCell(rawRow, mapping, "name");
      const email = optionalCell(rawRow, mapping, "email");
      const phone = optionalCell(rawRow, mapping, "phone");
      const lifecycleStateId = await resolveByName(
        ctx.organizationId,
        "customerLifecycleState",
        optionalCell(rawRow, mapping, "lifecycleState"),
        "lifecycleState",
      );
      const ownerMembershipId = await resolveAccountOwner(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "ownerEmail"),
        "companies",
        ctx.membershipId,
      );
      const extra = await extraColumns(ctx.organizationId, "COMPANY", rawRow, mapping);
      return {
        customFields: extra.customFields as never,
        organizationId: ctx.organizationId,
        name,
        industry: optionalCell(rawRow, mapping, "industry"),
        website: optionalCell(rawRow, mapping, "website"),
        location: optionalCell(rawRow, mapping, "location"),
        phone,
        email,
        notes: optionalCell(rawRow, mapping, "notes"),
        lifecycleStateId,
        ownerMembershipId,
        createdByMembershipId: ctx.membershipId,
      };
    },
    findHold: async (candidate, strategy) => {
      if (strategy !== "skip") return null;
      const existing = await findPossibleDuplicateCompanies(ctx.organizationId, candidate);
      if (existing.length > 0) return { outcome: "duplicate", matchedId: existing[0]!.id, reason: `Skipped: a company with the same name, email or phone already exists.` };
      const found = await findDuplicates(ctx, { entity: "company", companyName: candidate.name, email: candidate.email, phone: candidate.phone, website: candidate.website });
      const high = found.candidates.find((c) => c.confidence === "high");
      return high ? { outcome: "duplicate", matchedId: high.id, reason: `Skipped: looks like the existing company "${high.label}".` } : null;
    },
    create: (candidate) => createCompany(candidate),
    afterCreate: (record, rawRow, mapping) => applyTags(ctx, "company", record.id, rawRow, mapping),
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "companies.imported",
    entityType: "Company",
    metadata: { ...summary, errors: undefined },
  });

  return summary;
}

export interface ImportContactsInput {
  fileStream: Readable;
  mapping: Record<string, string | undefined>;
  duplicateStrategy: DuplicateStrategy;
  hooks?: ImportHooks;
}

export async function importContacts(
  ctx: AuthContext,
  input: ImportContactsInput,
): Promise<ImportSummary> {
  requirePermission(ctx, "contacts.import");

  const summary = await runImport(input.mapping, {
    organizationId: ctx.organizationId,
    fileStream: input.fileStream,
    duplicateStrategy: input.duplicateStrategy,
    hooks: input.hooks,
    resolveCandidate: async (rawRow, mapping) => {
      const firstName = requiredCell(rawRow, mapping, "firstName");
      const email = optionalCell(rawRow, mapping, "email");
      const phone = optionalCell(rawRow, mapping, "phone");
      const companyId = await resolveCompanyIdByName(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "company"),
      );
      const ownerMembershipId = await resolveAccountOwner(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "ownerEmail"),
        "contacts",
        ctx.membershipId,
      );
      const extra = await extraColumns(ctx.organizationId, "CONTACT", rawRow, mapping);
      return {
        customFields: extra.customFields as never,
        organizationId: ctx.organizationId,
        firstName,
        lastName: optionalCell(rawRow, mapping, "lastName"),
        companyId,
        phone,
        email,
        jobTitle: optionalCell(rawRow, mapping, "jobTitle"),
        department: optionalCell(rawRow, mapping, "department"),
        notes: optionalCell(rawRow, mapping, "notes"),
        ownerMembershipId,
        createdByMembershipId: ctx.membershipId,
      };
    },
    findHold: async (candidate, strategy) => {
      if (strategy !== "skip") return null;
      const existing = await findPossibleDuplicateContacts(ctx.organizationId, candidate);
      if (existing.length > 0) return { outcome: "duplicate", matchedId: existing[0]!.id, reason: `Skipped: a contact with the same email or phone already exists.` };
      const found = await findDuplicates(ctx, { entity: "contact", firstName: candidate.firstName, lastName: candidate.lastName, email: candidate.email, phone: candidate.phone });
      const high = found.candidates.find((c) => c.confidence === "high");
      return high ? { outcome: "duplicate", matchedId: high.id, reason: `Skipped: looks like the existing contact "${high.label}".` } : null;
    },
    create: (candidate) => createContact(candidate),
    afterCreate: (record, rawRow, mapping) => applyTags(ctx, "contact", record.id, rawRow, mapping),
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contacts.imported",
    entityType: "Contact",
    metadata: { ...summary, errors: undefined },
  });

  return summary;
}

export interface ImportLeadsInput {
  fileStream: Readable;
  mapping: Record<string, string | undefined>;
  duplicateStrategy: DuplicateStrategy;
  hooks?: ImportHooks;
}

export async function importLeads(
  ctx: AuthContext,
  input: ImportLeadsInput,
): Promise<ImportSummary> {
  requirePermission(ctx, "leads.import");

  const summary = await runImport(input.mapping, {
    organizationId: ctx.organizationId,
    fileStream: input.fileStream,
    duplicateStrategy: input.duplicateStrategy,
    hooks: input.hooks,
    resolveCandidate: async (rawRow, mapping) => {
      const leadStatusId = await resolveByName(
        ctx.organizationId,
        "leadStatus",
        requiredCell(rawRow, mapping, "leadStatus"),
        "leadStatus",
      );
      if (!leadStatusId) {
        throw new RowValidationError('"leadStatus" is required.');
      }
      const contactEmail = optionalCell(rawRow, mapping, "contactEmail");
      const contactPhone = optionalCell(rawRow, mapping, "contactPhone");
      const companyId = await resolveCompanyIdByName(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "company"),
      );
      const leadSourceId = await resolveByName(
        ctx.organizationId,
        "leadSource",
        optionalCell(rawRow, mapping, "leadSource"),
        "leadSource",
      );
      const serviceInterestId = await resolveByName(
        ctx.organizationId,
        "service",
        optionalCell(rawRow, mapping, "serviceInterest"),
        "serviceInterest",
      );
      const ownerMembershipId = await resolveOwnerMembershipId(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "ownerEmail"),
      );
      const temperatureRaw = optionalCell(
        rawRow,
        mapping,
        "temperature",
      )?.toUpperCase();
      if (
        temperatureRaw &&
        temperatureRaw !== "HOT" &&
        temperatureRaw !== "WARM" &&
        temperatureRaw !== "COLD"
      ) {
        throw new RowValidationError(
          `"temperature" must be HOT, WARM, or COLD -- got "${temperatureRaw}".`,
        );
      }

      const extra = await extraColumns(ctx.organizationId, "LEAD", rawRow, mapping);
      return {
        customFields: extra.customFields as never,
        organizationId: ctx.organizationId,
        leadStatusId,
        companyId,
        leadSourceId,
        serviceInterestId,
        ownerMembershipId,
        temperature: temperatureRaw as "HOT" | "WARM" | "COLD" | undefined,
        createdByMembershipId: ctx.membershipId,
        notes: optionalCell(rawRow, mapping, "notes"),
        _contactEmail: contactEmail,
        _contactPhone: contactPhone,
      };
    },
    findHold: async (candidate, strategy) => {
      if (strategy !== "skip") return null;
      const probe = { contactEmail: candidate._contactEmail, contactPhone: candidate._contactPhone, companyId: candidate.companyId };
      const converted = await findConvertedLeadMatches(ctx.organizationId, probe);
      if (converted.length > 0) {
        return { outcome: "already_converted", matchedId: converted[0]!.id, reason: "Skipped: this contact or company already has a lead that became a deal." };
      }
      const open = await findPossibleDuplicateLeads(ctx.organizationId, probe);
      if (open.length > 0) return { outcome: "duplicate", matchedId: open[0]!.id, reason: "Skipped: an open lead for this contact or company already exists." };
      const found = await findDuplicates(ctx, { entity: "lead", email: candidate._contactEmail, phone: candidate._contactPhone, companyId: candidate.companyId });
      const high = found.candidates.find((c) => c.confidence === "high");
      return high ? { outcome: "duplicate", matchedId: high.id, reason: `Skipped: looks like the existing record "${high.label}".` } : null;
    },
    create: ({ _contactEmail, _contactPhone, ...candidate }) =>
      createLead(candidate),
    afterCreate: (record, rawRow, mapping) => applyTags(ctx, "lead", record.id, rawRow, mapping),
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "leads.imported",
    entityType: "Lead",
    metadata: { ...summary, errors: undefined },
  });

  return summary;
}

export function assertCsvRequestSize(contentLength: number | null): void {
  const maxBytes = 50 * 1024 * 1024; // 50MB -- generous for a CSV, protects against an accidental non-CSV upload
  if (contentLength !== null && contentLength > maxBytes) {
    throw new ValidationError(
      `File is too large (max ${Math.floor(maxBytes / (1024 * 1024))}MB).`,
    );
  }
}
