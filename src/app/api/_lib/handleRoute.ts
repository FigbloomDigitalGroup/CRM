import { NextResponse } from "next/server";
import {
  ForbiddenError,
  NoActiveMembershipError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "@/auth/errors";
import { logger } from "@/lib/logger";

/**
 * Every API route delegates its actual work to this wrapper so error
 * mapping (typed service/auth errors -> HTTP status) happens in exactly one
 * place, matching the standard request flow: Client -> Auth context ->
 * Service -> Org+permission check -> Validation -> Data access -> Response.
 */
export async function handleRoute(
  fn: () => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const result = await fn();
    return NextResponse.json(result ?? {});
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (
      err instanceof ForbiddenError ||
      err instanceof NoActiveMembershipError
    ) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }

    logger.error({ err }, "Unhandled route error");
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
