import { ValidationError } from "../auth/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 200;
const MAX_NOTES = 5000;

/**
 * Normalises one optional text field coming from a form or the API.
 * `undefined` means "not provided" (leave the stored value alone); an empty
 * or whitespace-only string means "cleared" and becomes `null` so an edited
 * field does not end up stored as an invisible empty string.
 */
export function cleanOptionalText(
  value: string | null | undefined,
  label: string,
  max = MAX_TEXT,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${label} is too long (max ${max} characters).`);
  }
  return trimmed.length === 0 ? null : trimmed;
}

/** For required fields (a name): provided means non-empty. */
export function cleanRequiredText(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${label} is required.`);
  }
  if (trimmed.length > MAX_TEXT) {
    throw new ValidationError(`${label} is too long (max ${MAX_TEXT} characters).`);
  }
  return trimmed;
}

export function cleanEmail(
  value: string | null | undefined,
): string | null | undefined {
  const cleaned = cleanOptionalText(value, "Email");
  if (cleaned && !EMAIL_PATTERN.test(cleaned)) {
    throw new ValidationError("Enter a valid email address.");
  }
  return cleaned;
}

export function cleanNotes(
  value: string | null | undefined,
): string | null | undefined {
  return cleanOptionalText(value, "Notes", MAX_NOTES);
}

/** `null`/`undefined` -> `undefined`, for create inputs where "no value" simply means "omit". */
export function omitNull<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}
