import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  deleteReferenceValue,
  getReferenceValueUsage,
  renameReferenceValue,
  setReferenceValueHidden,
} from "@/services/referenceAdminService";

const PatchSchema = z.strictObject({ name: z.string().optional(), hidden: z.boolean().optional() });

type Params = { params: Promise<{ orgSlug: string; kind: string; valueId: string }> };

// How many records use this value and what holds them: the "In use" state (FIG-1063).
export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, kind, valueId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getReferenceValueUsage(ctx, kind, valueId);
  });
}

// Rename and/or hide or unhide. A hidden value stays on the records that carry it and leaves the pickers.
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, kind, valueId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, PatchSchema);
    if (body.name === undefined && body.hidden === undefined) {
      throw new ValidationError("Send a name, hidden, or both.", [{ path: "(root)", message: "Nothing to change." }]);
    }
    let value;
    if (body.name !== undefined) value = await renameReferenceValue(ctx, kind, valueId, body.name);
    if (body.hidden !== undefined) value = await setReferenceValueHidden(ctx, kind, valueId, body.hidden);
    return value;
  });
}

// Delete a value nothing uses. A used one is refused with the usage and the advice to hide it.
export async function DELETE(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, kind, valueId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteReferenceValue(ctx, kind, valueId);
  });
}
