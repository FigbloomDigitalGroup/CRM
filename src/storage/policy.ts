import type { FilePurpose } from "@prisma/client";

/**
 * What each purpose may store (FIG-1023, B1.07): a size cap, an allowlist of
 * types, and the extensions each type may carry. A file is accepted only when
 * its declared type, its extension and its actual bytes (see `sniff.ts`) agree.
 *
 * SVG is deliberately absent everywhere: an SVG is a document that can carry
 * script, and an organisation logo does not need to be one.
 */
export interface AllowedType {
  mime: string;
  extensions: readonly string[];
}

export interface FilePolicy {
  maxBytes: number;
  types: readonly AllowedType[];
  /** How long the upload link stays valid. */
  uploadLinkSeconds: number;
}

const IMAGES: AllowedType[] = [
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/webp", extensions: ["webp"] },
];

const MB = 1024 * 1024;

export const FILE_POLICIES: Record<FilePurpose, FilePolicy> = {
  AVATAR: { maxBytes: 2 * MB, types: IMAGES, uploadLinkSeconds: 600 },
  LOGO: { maxBytes: 2 * MB, types: IMAGES, uploadLinkSeconds: 600 },
  ATTACHMENT: {
    maxBytes: 25 * MB,
    uploadLinkSeconds: 900,
    types: [
      ...IMAGES,
      { mime: "image/gif", extensions: ["gif"] },
      { mime: "application/pdf", extensions: ["pdf"] },
      { mime: "text/plain", extensions: ["txt"] },
      { mime: "text/csv", extensions: ["csv"] },
      { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
      { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"] },
      { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extensions: ["pptx"] },
    ],
  },
  IMPORT: {
    maxBytes: 10 * MB,
    uploadLinkSeconds: 900,
    types: [
      { mime: "text/csv", extensions: ["csv"] },
      { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"] },
    ],
  },
  EXPORT: {
    maxBytes: 50 * MB,
    uploadLinkSeconds: 900,
    types: [
      { mime: "text/csv", extensions: ["csv"] },
      { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extensions: ["xlsx"] },
      { mime: "application/pdf", extensions: ["pdf"] },
    ],
  },
};

/** Purposes whose files the app itself displays inline (an `<img>`), so they are served with an inline disposition. */
export const INLINE_PURPOSES: readonly FilePurpose[] = ["AVATAR", "LOGO"];

/** The file name's extension, lower-case, without the dot; `""` when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export interface NameCheck {
  ok: boolean;
  name: string;
  reason?: string;
}

/** A name is kept for display and download only; it never reaches a path. Control characters and path separators are refused, not silently stripped. */
export function checkFileName(raw: string): NameCheck {
  const name = raw.normalize("NFC").trim();
  if (name.length === 0) return { ok: false, name, reason: "A file name is required." };
  if (name.length > 255) return { ok: false, name, reason: "The file name is longer than 255 characters." };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) {
    return { ok: false, name, reason: "The file name contains a path separator or control character." };
  }
  if (name === "." || name === "..") return { ok: false, name, reason: "That is not a valid file name." };
  return { ok: true, name };
}

export function findAllowedType(policy: FilePolicy, mime: string, extension: string): AllowedType | undefined {
  return policy.types.find((t) => t.mime === mime.toLowerCase() && t.extensions.includes(extension));
}
