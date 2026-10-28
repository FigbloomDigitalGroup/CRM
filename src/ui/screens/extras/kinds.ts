import type { ExtrasKind } from "./RecordExtras";

/**
 * The API names its record operations per record type; the panel is one component, so this table is the only place that knows the names.
 * `param` is the path parameter that carries the record's id.
 */
export interface KindOps {
  param: "leadId" | "contactId" | "companyId" | "dealId";
  entityType: "LEAD" | "CONTACT" | "COMPANY" | "DEAL";
  noun: string;
  record: string;
  patch: string;
  attachments: string;
  addAttachment: string;
  comments: string;
  addComment: string;
  mentionable: string;
  follow: string;
  unfollow: string;
  tags: string;
  changeTags: string;
}

export const KIND_OPS: Record<ExtrasKind, KindOps> = {
  lead: {
    param: "leadId", entityType: "LEAD", noun: "lead", record: "getLeadsByLeadId", patch: "patchLeadsByLeadId",
    attachments: "getLeadsByLeadIdAttachments", addAttachment: "postLeadsByLeadIdAttachments",
    comments: "listLeadComments", addComment: "addLeadComment", mentionable: "getLeadsByLeadIdCommentsMentionable",
    follow: "postLeadsByLeadIdFollow", unfollow: "deleteLeadsByLeadIdFollow", tags: "getLeadsByLeadIdTags", changeTags: "patchLeadsByLeadIdTags",
  },
  contact: {
    param: "contactId", entityType: "CONTACT", noun: "contact", record: "getContactsByContactId", patch: "patchContactsByContactId",
    attachments: "getContactsByContactIdAttachments", addAttachment: "postContactsByContactIdAttachments",
    comments: "getContactsByContactIdComments", addComment: "postContactsByContactIdComments", mentionable: "getContactsByContactIdCommentsMentionable",
    follow: "postContactsByContactIdFollow", unfollow: "deleteContactsByContactIdFollow", tags: "getContactsByContactIdTags", changeTags: "patchContactsByContactIdTags",
  },
  company: {
    param: "companyId", entityType: "COMPANY", noun: "company", record: "getCompaniesByCompanyId", patch: "patchCompaniesByCompanyId",
    attachments: "getCompaniesByCompanyIdAttachments", addAttachment: "postCompaniesByCompanyIdAttachments",
    comments: "getCompaniesByCompanyIdComments", addComment: "postCompaniesByCompanyIdComments", mentionable: "getCompaniesByCompanyIdCommentsMentionable",
    follow: "postCompaniesByCompanyIdFollow", unfollow: "deleteCompaniesByCompanyIdFollow", tags: "getCompaniesByCompanyIdTags", changeTags: "patchCompaniesByCompanyIdTags",
  },
  deal: {
    param: "dealId", entityType: "DEAL", noun: "deal", record: "getDeal", patch: "patchDealsByDealId",
    attachments: "getDealsByDealIdAttachments", addAttachment: "postDealsByDealIdAttachments",
    comments: "getDealsByDealIdComments", addComment: "postDealsByDealIdComments", mentionable: "getDealsByDealIdCommentsMentionable",
    follow: "postDealsByDealIdFollow", unfollow: "deleteDealsByDealIdFollow", tags: "getDealsByDealIdTags", changeTags: "patchDealsByDealIdTags",
  },
};

/** Attachment rules, the same as the server's (`src/storage/policy.ts`), so a bad file is refused before it is sent. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "csv", "docx", "xlsx", "pptx"] as const;
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(",");
export const ATTACHMENT_RULE = "PDF, images, Word, Excel, PowerPoint, CSV or text, up to 25 MB.";

export const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a file cannot be attached, in words, or null when it can. */
export function refuseFile(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) return `${file.name} wasn’t uploaded: ${ext ? `.${ext}` : "that"} files aren’t allowed. ${ATTACHMENT_RULE} Nothing else changed.`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name} wasn’t uploaded: files can be up to 25 MB. Nothing else changed.`;
  if (file.size === 0) return `${file.name} wasn’t uploaded: the file is empty. Nothing else changed.`;
  return null;
}
