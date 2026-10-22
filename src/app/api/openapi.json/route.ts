import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/api/openapi";

// The generated OpenAPI document (FIG-1014, B0.06). Served outside
// production only; CI exports the same document as an artifact.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json(buildOpenApiDocument());
}
