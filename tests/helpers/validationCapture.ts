/**
 * The `validation` mock the generated suites install: the real validators, remembering the last schema each was given, so the walker
 * can build a request that passes. Kept free of every other helper on purpose -- the mock factory runs while the routes are being
 * loaded, and a factory that waits on the module that is loading the routes would wait forever.
 */
import { vi } from "vitest";
import type { z } from "zod";

export const captured: { body?: z.ZodType; query?: z.ZodType } = {};

/** The factory for `vi.mock("../src/app/api/_lib/validation", ...)`: the real validators, remembering the last schema each was given. */
export async function capturingValidation() {
  const actual = await vi.importActual<typeof import("../../src/app/api/_lib/validation")>("../../src/app/api/_lib/validation");
  return {
    ...actual,
    parseJsonBody: (request: Request, schema: z.ZodType) => {
      captured.body = schema;
      return actual.parseJsonBody(request, schema);
    },
    parseOptionalJsonBody: (request: Request, schema: z.ZodType) => {
      captured.body = schema;
      return actual.parseOptionalJsonBody(request, schema);
    },
    parseQueryParams: (searchParams: URLSearchParams, schema: z.ZodType) => {
      captured.query = schema;
      return actual.parseQueryParams(searchParams, schema);
    },
    validateData: (data: unknown, schema: z.ZodType) => {
      captured.body ??= schema;
      return actual.validateData(data, schema);
    },
  };
}

