import { ValidationError } from "../auth/errors";
import { MERGE_FIELDS, type MergeEntity } from "../repositories/merges";

/** How long a merge can be undone (FIG-1033, B2.04): one hour. */
export const MERGE_UNDO_WINDOW_MS = 60 * 60 * 1000;

export interface MergeOptions {
  /**
   * Field-by-field choice on the merge screen: `loser` copies the loser's value
   * onto the surviving record. Omit it to keep the winner's data, filling only
   * the fields the winner left blank. When given, only the fields named change.
   */
  fields?: Record<string, "winner" | "loser">;
}

export function validateMergeChoices(entity: MergeEntity, fields: MergeOptions["fields"]): void {
  if (!fields) return;
  const allowed = new Set(MERGE_FIELDS[entity]);
  const issues = Object.entries(fields)
    .filter(([name, choice]) => !allowed.has(name) || (choice !== "winner" && choice !== "loser"))
    .map(([name]) => ({ path: `fields.${name}`, message: `Cannot choose "${name}" when merging a ${entity.toLowerCase()}.` }));
  if (issues.length > 0) throw new ValidationError("Some merge choices are not valid.", issues);
}
