import { handleRoute } from "@/app/api/_lib/handleRoute";
import { UnauthorizedError } from "@/auth/errors";
import { runNotificationsSweep } from "@/services/notificationSweepService";

/**
 * FIG-783: the "authenticated /api/cron/... route called by an external
 * cron" option for scheduling the notifications sweep -- the one chosen
 * over a sidecar cron container or a specific platform's scheduler feature
 * because it needs nothing added to the Dockerfile/compose (still "one
 * image, no scheduler sidecar," per that file's own header) and works with
 * literally any external trigger: a VPS crontab calling `curl`, a GitHub
 * Actions scheduled workflow, or a platform's own cron/scheduled-job
 * feature hitting a URL (several, including Vercel Cron, send exactly the
 * `Authorization: Bearer <secret>` header this checks for).
 *
 * No session/org context -- this isn't a tenant request, it sweeps every
 * organization (see `notificationSweepService.ts`) -- so it's authenticated
 * by its own shared secret (`CRON_SECRET`) instead of `resolveRequestContext`.
 * Double-send protection (locking, self-throttling) lives in
 * `runNotificationsSweep` itself, not here, so it applies no matter what
 * calls it (this route, or `scripts/notifications-sweep.ts` directly).
 */
function assertAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fails closed: an unconfigured secret must never be treated as "no
    // auth required," which would leave this reachable by anyone.
    throw new Error(
      "CRON_SECRET is not configured -- refusing to run the notifications sweep.",
    );
  }

  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length)
    : request.headers.get("x-cron-secret");

  if (provided !== secret) {
    throw new UnauthorizedError("Invalid or missing cron secret.");
  }
}

async function handle(request: Request) {
  return handleRoute(async () => {
    assertAuthorized(request);
    const result = await runNotificationsSweep();
    return {
      ran: result.ran,
      skippedReason: result.skippedReason,
      organizationsSwept: result.organizationsSwept,
      lastCompletedAt: result.jobRun.completedAt,
      lastError: result.jobRun.lastError,
    };
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
