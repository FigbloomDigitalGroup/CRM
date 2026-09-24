import { NextResponse } from "next/server";
import {
  ForbiddenError,
  NoActiveMembershipError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/auth/errors";

/**
 * Every API route delegates its actual work to this wrapper so error
 * mapping (typed service/auth errors -> HTTP status) is applied
 * consistently in exactly one place, per FIG-436 section 10's request flow:
 * Client -> Auth context -> API/Application service -> Org+permission
 * check -> Validation/business rules -> Data access -> Response.
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

    console.error(err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
