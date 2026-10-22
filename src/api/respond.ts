import type { z } from "zod";
import { logger } from "../lib/logger";

/**
 * Checks a route's response against its Zod schema (FIG-1014, B0.06) and
 * returns the data untouched. Outside production a mismatch throws, which the
 * route wrapper turns into a 500 and a logged list of the drifted fields --
 * so any test or dev request that hits a drifted route fails loudly. In
 * production the check is skipped (it would only cost time on every
 * request); the contract tests are what keep production honest.
 */
export function respond<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  if (process.env.NODE_ENV !== "production") {
    // What the client receives is the JSON form (Dates become ISO strings).
    const wire = JSON.parse(JSON.stringify(data ?? null));
    const result = schema.safeParse(wire);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      logger.error({ issues }, "Route response does not match its schema");
      throw new Error(
        `Response does not match its schema: ${issues
          .slice(0, 5)
          .map((i) => `${i.path || "(root)"}: ${i.message}`)
          .join("; ")}`,
      );
    }
  }
  return data as z.output<S>;
}
