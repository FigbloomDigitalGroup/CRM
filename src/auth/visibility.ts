import type { AuthContext } from "./context";
import { deny } from "./context";
import { NotFoundError } from "./errors";
import {
  canUseResource,
  canView,
  viewPermissionKeys,
  type ScopedRecord,
  type ScopedResource,
} from "./permissions";

/**
 * "Do not leak existence" (FIG-1018): a caller whose role cannot use a
 * resource at all gets the explained 403 (S4 names the role, the owner roles
 * and who to ask). A caller whose role can use it but who cannot see THIS
 * record (somebody else's lead, a deal that is not won, a task assigned to a
 * colleague) gets the same 404 a record that does not exist would get.
 *
 * Call it right after loading a single record, before any action-specific
 * check; the action check (`requireOwnedRecordPermission`) then yields the
 * explained 403 for "you can see it but not change it".
 */
export function assertRecordVisible(
  ctx: AuthContext,
  resource: ScopedResource,
  entityName: string,
  id: string,
  record: ScopedRecord,
): void {
  if (!canUseResource(ctx, resource)) {
    throw deny(ctx, `${resource}.view`, viewPermissionKeys(resource));
  }
  if (!canView(ctx, resource, record)) {
    throw new NotFoundError(entityName, id);
  }
}
