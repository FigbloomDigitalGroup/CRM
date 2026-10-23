/**
 * Merge fields for email templates (FIG-797): `{{contact.firstName}}`,
 * `{{company.name}}`, `{{owner.name}}`. A fixed list; a template that names any
 * other field is rejected when it is saved, so a typo never reaches a customer.
 */
export const MERGE_FIELDS = [
  "contact.firstName",
  "contact.lastName",
  "contact.fullName",
  "contact.email",
  "contact.jobTitle",
  "company.name",
  "company.website",
  "owner.name",
  "sender.name",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** Every `{{field}}` used in the text, in order, including ones that are not known fields. */
export function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]!);
}

export function unknownTokens(...texts: string[]): string[] {
  const known = new Set<string>(MERGE_FIELDS);
  return [...new Set(texts.flatMap(tokensIn).filter((t) => !known.has(t)))];
}

/** Replaces known fields; a field with no value becomes empty, and is reported in `missing`. */
export function renderMergeFields(
  text: string,
  values: Partial<Record<MergeField, string | null | undefined>>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(TOKEN, (_match, name: string) => {
    const value = values[name as MergeField];
    if (value === undefined || value === null || value === "") {
      missing.add(name);
      return "";
    }
    return value;
  });
  return { text: out, missing: [...missing] };
}
