import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { addAttachment, listAttachments } from "@/services/attachmentService";

const AddAttachmentSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  mimeType: z.string({ error: "mimeType is required." }),
  sizeBytes: z.number({ error: "sizeBytes is required." }).int(),
  checksumSha256: z.string().optional(),
  title: z.string().max(120).optional(),
  /** Deals only: share with people who may not see the deal value. */
  shared: z.boolean().optional(),
  proposalReferenceId: z.string().optional(),
});

// Files on one deal (FIG-796). POST returns a signed upload link; send the bytes there, then POST .../attachments/{id}/complete.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const items = await listAttachments(ctx, "deal", dealId);
    return { items: items.map(({ file, ...attachment }) => ({ ...attachment, file: { id: file.id, name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType, status: file.status } })) };
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AddAttachmentSchema);
    const { attachment, upload } = await addAttachment(ctx, "deal", dealId, body);
    const { file, ...rest } = attachment;
    return { attachment: { ...rest, file: { id: file.id, name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType, status: file.status } }, upload };
  });
}
