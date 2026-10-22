import { createHash } from "crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { ApiError } from "./apiErrors";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  findIdempotencyKey,
  releaseIdempotencyKey,
} from "../repositories/idempotencyKeys";

/**
 * Idempotency keys for create endpoints (FIG-1014, B0.06), used by mobile
 * and offline sync. The client sends `Idempotency-Key: <unique string>` on a
 * POST; retrying the same request with the same key returns the first
 * response (with `Idempotent-Replayed: true`) instead of creating the record
 * again.
 *
 *  - Same key, different body or path: 422 `IDEMPOTENCY_KEY_REUSED`.
 *  - Same key while the first request is still running: 409
 *    `IDEMPOTENCY_IN_PROGRESS` (a claim older than `STALE_CLAIM_MS` is taken
 *    to be a crashed request and is reclaimed).
 *  - A request that fails is not stored; the key is freed so the retry runs.
 *  - Keys are per person per organization and forgotten after 24 hours.
 *  - No header, no change in behaviour.
 */
export const IDEMPOTENCY_HEADER = "idempotency-key";
const STALE_CLAIM_MS = 60_000;
const KEY_PATTERN = /^[\x21-\x7e]{8,200}$/;

function hashRequest(method: string, path: string, body: unknown) {
  return createHash("sha256")
    .update(JSON.stringify([method, path, body ?? null]))
    .digest("hex");
}

export async function withIdempotency(
  ctx: AuthContext,
  request: Request,
  body: unknown,
  execute: () => Promise<unknown>,
): Promise<unknown> {
  const key = request.headers.get(IDEMPOTENCY_HEADER);
  if (key === null) return execute();
  if (!KEY_PATTERN.test(key)) {
    throw new ValidationError(
      "Idempotency-Key must be 8 to 200 printable characters.",
      [{ path: "Idempotency-Key", message: "Use a UUID or similar unique string." }],
    );
  }

  const scope = {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    key,
  };
  const path = new URL(request.url).pathname;
  const requestHash = hashRequest(request.method, path, body);

  let claim = await claimIdempotencyKey(scope, {
    method: request.method,
    path,
    requestHash,
  });

  if (!claim) {
    const existing = await findIdempotencyKey(scope);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used for a different request.",
        );
      }
      if (existing.status === "COMPLETED" && existing.responseStatus !== null) {
        return NextResponse.json(existing.responseBody ?? {}, {
          status: existing.responseStatus,
          headers: { "Idempotent-Replayed": "true" },
        });
      }
      if (Date.now() - existing.createdAt.getTime() < STALE_CLAIM_MS) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_IN_PROGRESS",
          "A request with this Idempotency-Key is still being processed. Retry shortly.",
        );
      }
      // Abandoned claim (the first request died): take it over.
      await releaseIdempotencyKey(ctx.organizationId, existing.id);
      claim = await claimIdempotencyKey(scope, {
        method: request.method,
        path,
        requestHash,
      });
    }
    if (!claim) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_IN_PROGRESS",
        "A request with this Idempotency-Key is still being processed. Retry shortly.",
      );
    }
  }

  let result: unknown;
  try {
    result = await execute();
  } catch (err) {
    await releaseIdempotencyKey(ctx.organizationId, claim.id);
    throw err;
  }

  if (result instanceof NextResponse) return result;
  await completeIdempotencyKey(ctx.organizationId, claim.id, {
    status: 200,
    body: JSON.parse(JSON.stringify(result ?? {})) as Prisma.InputJsonValue,
  });
  return result;
}
