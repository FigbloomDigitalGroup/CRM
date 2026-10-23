/**
 * Content sniffing (FIG-1023, B1.07): what the bytes actually are, whatever
 * the client claimed. The file service refuses a file whose sniffed kind does
 * not fit its declared type, so an executable renamed `logo.png` is rejected.
 */
export type SniffedKind = "png" | "jpeg" | "gif" | "webp" | "pdf" | "zip" | "text" | "unknown";

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

export function sniffKind(buf: Buffer): SniffedKind {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38]) && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return "gif";
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (looksLikeText(buf)) return "text";
  return "unknown";
}

/** Plain text: no NUL byte and no invalid UTF-8 in the first 8 KB. An empty file counts as text. */
function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head);
    return true;
  } catch {
    // A cut multi-byte character at the 8 KB boundary is not a reason to refuse.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length - 3));
      return true;
    } catch {
      return false;
    }
  }
}

const OOXML_FOLDER: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt/",
};

/** Does `buf` fit the declared type? A zip must also hold the folder an Office document of that kind holds. */
export function contentMatchesMime(buf: Buffer, mime: string): boolean {
  const kind = sniffKind(buf);
  switch (mime.toLowerCase()) {
    case "image/png":
      return kind === "png";
    case "image/jpeg":
      return kind === "jpeg";
    case "image/gif":
      return kind === "gif";
    case "image/webp":
      return kind === "webp";
    case "application/pdf":
      return kind === "pdf";
    case "text/plain":
    case "text/csv":
      return kind === "text";
    default: {
      const folder = OOXML_FOLDER[mime.toLowerCase()];
      return folder !== undefined && kind === "zip" && buf.includes(Buffer.from(folder, "ascii"));
    }
  }
}
