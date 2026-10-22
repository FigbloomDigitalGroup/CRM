import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { buildErrorResponse, newRequestId } from "@/lib/apiErrors";

/** The caller's `x-request-id` when it sent a usable one, otherwise a fresh id. Outside a request (unit tests) it is always fresh. */
async function currentRequestId(): Promise<string> {
  try {
    return newRequestId((await headers()).get("x-request-id"));
  } catch {
    return newRequestId();
  }
}

/** Typed service/auth errors -> the standard error envelope (`src/lib/apiErrors.ts`), shared by `handleRoute` and `handleCsvRoute` below. */
async function mapErrorToResponse(err: unknown): Promise<NextResponse> {
  const requestId = await currentRequestId();
  const { status, body } = await buildErrorResponse(err, requestId);
  return NextResponse.json(body, {
    status,
    headers: { "x-request-id": requestId },
  });
}

/**
 * Every API route delegates its actual work to this wrapper so error
 * mapping (typed service/auth errors -> HTTP status) happens in exactly one
 * place, matching the standard request flow: Client -> Auth context ->
 * Service -> Org+permission check -> Validation -> Data access -> Response.
 *
 * `fn` normally returns plain data to be JSON-serialized, but a route that
 * needs to set a cookie/header on success (the auth routes, FIG-605 --
 * login, signup, accept-invite all set the session cookie) can instead
 * return its own already-built `NextResponse` directly; it's passed
 * through unchanged rather than re-wrapped.
 */
export async function handleRoute(
  fn: () => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const result = await fn();
    if (result instanceof NextResponse) return result;
    return NextResponse.json(result ?? {}, {
      headers: { "x-request-id": await currentRequestId() },
    });
  } catch (err) {
    return await mapErrorToResponse(err);
  }
}

/**
 * Same error-mapping contract as `handleRoute`, but for routes that stream a
 * non-JSON body on success (CSV exports, FIG-596) -- `fn` builds and returns
 * its own `Response` instead of a plain value.
 */
export async function handleCsvRoute(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return await mapErrorToResponse(err);
  }
}
