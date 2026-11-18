import { ApiError } from "../lib/apiErrors";
import { NotFoundError } from "../auth/errors";
import { getFileByStorageKey } from "../repositories/files";
import { INLINE_PURPOSES } from "./policy";
import { getStorageDriver, localSigningSecret } from "./index";
import { verifyLocalToken, type LocalTokenPayload } from "./localToken";

/**
 * The route behind the local driver's signed links (`/api/storage/blob`).
 * Development and tests only: the S3 driver's links go straight to the bucket.
 * There is no session here; the HMAC-signed token is the credential, bound to
 * one key, one method and an expiry. Even so, a download re-reads the file row
 * on every request, so a file quarantined or deleted after its link was issued
 * stops being served at once.
 */
function tokenFrom(request: Request): LocalTokenPayload {
  if (getStorageDriver().name !== "local") throw new NotFoundError("Route", "storage/blob");
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = verifyLocalToken(token, localSigningSecret());
  if (!result.ok) {
    throw new ApiError(403, "FORBIDDEN", result.reason === "expired" ? "This link has expired." : "This link is not valid.");
  }
  return result.payload;
}

function organizationOfKey(key: string): string {
  return key.split("/")[1] ?? "";
}

export async function handleBlobPut(request: Request): Promise<Response> {
  const payload = tokenFrom(request);
  if (payload.m !== "PUT") throw new ApiError(403, "FORBIDDEN", "This link is not valid for uploading.");

  const organizationId = organizationOfKey(payload.k);
  const file = await getFileByStorageKey(organizationId, payload.k);
  if (!file || file.status !== "UPLOADING") throw new NotFoundError("File", payload.k);

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (payload.ct && contentType !== payload.ct.toLowerCase()) {
    throw new ApiError(400, "VALIDATION_FAILED", "The upload's Content-Type does not match the link.");
  }

  const max = payload.mb ?? 0;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (max > 0 && declared > max) {
    throw new ApiError(400, "VALIDATION_FAILED", "The upload is larger than the limit for this kind of file.");
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (max > 0 && body.length > max) {
    throw new ApiError(400, "VALIDATION_FAILED", "The upload is larger than the limit for this kind of file.");
  }
  await getStorageDriver().putObject(payload.k, body, { contentType: payload.ct ?? "application/octet-stream" });
  return new Response(null, { status: 200 });
}

export async function handleBlobGet(request: Request): Promise<Response> {
  const payload = tokenFrom(request);
  if (payload.m !== "GET") throw new ApiError(403, "FORBIDDEN", "This link is not valid for downloading.");

  const organizationId = organizationOfKey(payload.k);
  const file = await getFileByStorageKey(organizationId, payload.k);
  if (!file || file.status === "DELETED") throw new NotFoundError("File", payload.k);
  if (file.status === "QUARANTINED") {
    throw new ApiError(409, "FILE_UNAVAILABLE", "This file was quarantined by the malware scan and cannot be downloaded.");
  }
  if (file.status !== "READY") throw new NotFoundError("File", payload.k);

  const data = await getStorageDriver().getObject(payload.k, Math.max(file.sizeBytes, 1) + 1024);
  const inline = payload.d === "inline" && INLINE_PURPOSES.includes(file.purpose);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(payload.fn ?? file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
