import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { validateData } from "@/app/api/_lib/validation";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getWebsiteIntegrationStatus,
  regenerateWebsiteApiKey,
} from "@/services/integrationService";

// `graceHours` (B4.01): how long the key being replaced keeps working. Optional; the default is 24 hours, 0 ends it at once.
const RotateSchema = z.strictObject({ graceHours: z.number().optional() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getWebsiteIntegrationStatus(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    // The body is optional: an empty POST rotates with the default grace window.
    const text = await request.text();
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw new ValidationError("Request body must be valid JSON.");
      }
    }
    const body = validateData(raw, RotateSchema);
    return regenerateWebsiteApiKey(ctx, body);
  });
}
