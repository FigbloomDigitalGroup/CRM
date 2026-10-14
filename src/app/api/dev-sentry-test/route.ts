import { handleRoute } from "@/app/api/_lib/handleRoute";

/**
 * Dev-only trigger for a genuine unhandled error, so FIG-753 (Sentry error
 * tracking) can be verified end-to-end through the real
 * logger.error -> Sentry bridge instead of a unit-test mock. Enabled ONLY
 * when NODE_ENV is explicitly "development" (same fail-closed convention as
 * src/app/api/dev-session/route.ts).
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 });
  }

  return handleRoute(async () => {
    throw new Error("FIG-753 test: deliberate server-side error (dev-sentry-test route)");
  });
}
