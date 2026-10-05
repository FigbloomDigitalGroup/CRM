import { z } from "zod";
import { ValidationError, type ValidationIssue } from "@/auth/errors";

/**
 * A required, non-blank string with ONE message covering both ways a
 * route commonly gets this wrong: the field is missing entirely (zod's
 * own base-type check fires first and would otherwise show a generic
 * "expected string, received undefined") or present as an empty string
 * (caught by `.min(1, ...)`). Plain `z.string().min(1, "msg")` only
 * customizes the second case -- this covers both with the one message.
 */
export function requiredString(message: string) {
  return z.string({ error: message }).min(1, message);
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

function throwValidationError(issues: ValidationIssue[]): never {
  // A single issue's own message is more useful as the top-level `error`
  // string (most client code only reads that one field) than a generic
  // "Validation failed." -- the full `issues` array is always attached
  // regardless, for anything that wants per-field detail.
  const message = issues.length === 1 ? issues[0]!.message : "Validation failed.";
  throw new ValidationError(message, issues);
}

/**
 * Validates already-in-hand data (not a `Request`) against a schema, with
 * the same `ValidationError`/`{error, issues}` contract as `parseJsonBody`.
 * Exists for the rare route that must branch on the body's raw shape
 * before knowing which schema applies (e.g.
 * `reference-catalogs/[catalogKey]/[entryId]/route.ts`'s single endpoint
 * for both "toggle isActive" and "edit fields") -- parse once into a
 * generic shape, decide which schema fits, then validate again with this.
 */
export function validateData<Schema extends z.ZodType>(
  data: unknown,
  schema: Schema,
): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throwValidationError(toIssues(result.error));
  }
  return result.data;
}

/**
 * Shared request-body validation (FIG-605) -- replaces each route's own
 * `request.json()` + `as {...}` cast + hand-written required-field checks
 * with one call. Every rejection becomes a 400 with a consistent
 * `{ error, issues }` shape (`handleRoute.ts`), instead of a raw
 * `SyntaxError` (malformed JSON) or an unmapped Prisma error (a required
 * field silently missing) surfacing as an opaque 500.
 *
 * Business-rule validation (DB-existence checks, cross-entity consistency,
 * "already archived," permission-dependent branches) stays in the service
 * layer, which scripts call directly too, not just routes -- this only
 * validates the request's shape: required-ness, types, formats, enums.
 */
export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  return validateData(raw, schema);
}

/**
 * Same contract as `parseJsonBody`, for a route's `URLSearchParams` (query
 * filters) instead of its body -- every value arrives as a string, so the
 * schema is expected to `.optional()` and coerce/refine as needed (e.g.
 * `z.enum([...]).optional()` for a filter, `z.coerce.date().optional()`
 * for a date-range bound).
 */
export function parseQueryParams<Schema extends z.ZodType>(
  searchParams: URLSearchParams,
  schema: Schema,
): z.output<Schema> {
  const raw = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throwValidationError(toIssues(result.error));
  }
  return result.data;
}
