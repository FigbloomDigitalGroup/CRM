import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { handleBlobGet, handleBlobPut } from "@/storage/blobHandler";

// Local-disk storage links (development and tests). Authorised by the signed
// token in the query string, not by a session; see src/storage/blobHandler.ts.
export async function GET(request: Request) {
  return handleCsvRoute(() => handleBlobGet(request));
}

export async function PUT(request: Request) {
  return handleCsvRoute(() => handleBlobPut(request));
}
