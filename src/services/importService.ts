import type { Readable } from "node:stream";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
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
import { createLead, findPossibleDuplicateLeads } from "../repositories/leads";

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

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportSummary {
  totalRows: number;
  created: number;
  duplicatesSkipped: number;
  failed: number;
  truncated: boolean;
  errors: ImportRowError[];
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

async function resolveCompanyIdByName(
  organizationId: string,
  name: string | undefined,
): Promise<string | undefined> {
  if (!name) return undefined;
  const matches = await adminDb.company.findMany({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
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

interface RunImportOptions<TCandidate> {
  organizationId: string;
  fileStream: Readable;
  duplicateStrategy: DuplicateStrategy;
  resolveCandidate: (
    rawRow: Record<string, string>,
    mapping: Record<string, string | undefined>,
  ) => Promise<TCandidate>;
  findDuplicates: (candidate: TCandidate) => Promise<unknown[]>;
  create: (candidate: TCandidate) => Promise<unknown>;
}

async function runImport<TCandidate>(
  mapping: Record<string, string | undefined>,
  opts: RunImportOptions<TCandidate>,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    totalRows: 0,
    created: 0,
    duplicatesSkipped: 0,
    failed: 0,
    truncated: false,
    errors: [],
  };

  async function handleRow(rawRow: Record<string, string>, row: number) {
    try {
      const candidate = await opts.resolveCandidate(rawRow, mapping);
      if (opts.duplicateStrategy === "skip") {
        const duplicates = await opts.findDuplicates(candidate);
        if (duplicates.length > 0) {
          summary.duplicatesSkipped += 1;
          return;
        }
      }
      await opts.create(candidate);
      summary.created += 1;
    } catch (err) {
      summary.failed += 1;
      if (summary.errors.length < MAX_REPORTED_ERRORS) {
        summary.errors.push({
          row,
          reason:
            err instanceof RowValidationError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Unknown error.",
        });
      }
    }
  }

  const maxRows = maxImportRows();
  let rowNumber = 1; // header is row 1, first data row is row 2
  let stopped = false;

  async function* boundedRows() {
    for await (const rawRow of parseCsvRows(opts.fileStream)) {
      rowNumber += 1;
      if (rowNumber - 1 > maxRows) {
        stopped = true;
        summary.truncated = true;
        return;
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

  return summary;
}

export interface ImportCompaniesInput {
  fileStream: Readable;
  mapping: Record<string, string | undefined>;
  duplicateStrategy: DuplicateStrategy;
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
      const ownerMembershipId = await resolveOwnerMembershipId(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "ownerEmail"),
      );
      return {
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
    findDuplicates: (candidate) =>
      findPossibleDuplicateCompanies(ctx.organizationId, candidate),
    create: (candidate) => createCompany(candidate),
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
    resolveCandidate: async (rawRow, mapping) => {
      const firstName = requiredCell(rawRow, mapping, "firstName");
      const email = optionalCell(rawRow, mapping, "email");
      const phone = optionalCell(rawRow, mapping, "phone");
      const companyId = await resolveCompanyIdByName(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "company"),
      );
      const ownerMembershipId = await resolveOwnerMembershipId(
        ctx.organizationId,
        optionalCell(rawRow, mapping, "ownerEmail"),
      );
      return {
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
    findDuplicates: (candidate) =>
      findPossibleDuplicateContacts(ctx.organizationId, candidate),
    create: (candidate) => createContact(candidate),
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

      return {
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
    findDuplicates: (candidate) =>
      findPossibleDuplicateLeads(ctx.organizationId, {
        contactEmail: candidate._contactEmail,
        contactPhone: candidate._contactPhone,
        companyId: candidate.companyId,
      }),
    create: ({ _contactEmail, _contactPhone, ...candidate }) =>
      createLead(candidate),
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
