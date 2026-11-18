"use client";

import { useCallback } from "react";
import { newIdempotencyKey, putSignedUpload } from "../../../data/client";
import { useApi } from "../../../data/hooks";
import { useMember } from "../../../data/member";
import { isNetworkFailure } from "../data";
import { markPhotoSent, photoBlob, readPhotos } from "./photos";

type Kind = "lead" | "deal" | "contact" | "company" | "task";
const OPS = {
  lead: ["postLeadsByLeadIdAttachments", "leadId"],
  deal: ["postDealsByDealIdAttachments", "dealId"],
  contact: ["postContactsByContactIdAttachments", "contactId"],
  company: ["postCompaniesByCompanyIdAttachments", "companyId"],
  task: ["postTasksByTaskIdAttachments", "taskId"],
} as const;

/**
 * Sends a phone photo to a record's attachments (docs/CARD_CAPTURE.md, camera attachments): the same signed-upload, content check and scan as any
 * attachment, and the same access rules by record. `record` is "lead:abc". Throws the API's error (HEIC refused, too large, no right to attach).
 */
export function usePhotoUpload() {
  const api = useApi();
  const { orgSlug } = useMember();
  const upload = useCallback(
    async (record: string, file: Blob & { name?: string }) => {
      const [kind, id] = record.split(":") as [Kind, string];
      const op = OPS[kind];
      if (!op || !id) throw new Error(`Unknown record ${record}`);
      const started = (await api.call(op[0] as "postLeadsByLeadIdAttachments", {
        params: { orgSlug, [op[1]]: id } as never,
        body: { name: file.name || "Photo.jpg", mimeType: file.type, sizeBytes: file.size, title: "Photo" } as never,
        idempotencyKey: newIdempotencyKey(),
      })) as unknown as { attachment: { id: string }; upload: { url: string; method?: string; headers?: Record<string, string> } };
      await putSignedUpload(started.upload, file);
      await api.call("postAttachmentsByAttachmentIdComplete", { params: { orgSlug, attachmentId: started.attachment.id } });
    },
    [api, orgSlug],
  );

  /** Sends the photos waiting on this device (all, or one). Returns how many went; a photo whose bytes were lost on reload is reported in `lost`. */
  const sendWaiting = useCallback(
    async (only?: string) => {
      let sent = 0;
      let lost = 0;
      for (const p of readPhotos().filter((x) => x.state === "WAITING" && (!only || x.id === only))) {
        const bytes = photoBlob(p.id);
        if (!bytes) {
          lost += 1;
          continue;
        }
        try {
          await upload(p.record, Object.assign(bytes, { name: p.name }));
          markPhotoSent(p.id);
          sent += 1;
        } catch (e) {
          if (isNetworkFailure(e)) break;
          throw e;
        }
      }
      return { sent, lost };
    },
    [upload],
  );
  return { upload, sendWaiting };
}
