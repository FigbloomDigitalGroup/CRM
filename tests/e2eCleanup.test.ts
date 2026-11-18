import { describe, expect, it } from "vitest";
import {
  ALLOWED_DATABASES,
  assertSafeTarget,
  cleanupStatements,
  databaseNameOf,
  E2E_MARKER,
  isE2eMarked,
  LEGACY_NAMES,
  utcTimestampLiteral,
} from "../e2e/support/cleanup";

/** The marker and guard logic of the Playwright data clean-up (docs/E2E_DATA_CLEANUP.md). No database and no Playwright needed. */
describe("e2e clean-up: what counts as a test record", () => {
  it("recognises the names the specs create", () => {
    for (const name of [
      "E2E Inline Co 1793961086320-4778",
      "e2e.invitee.1793826556019-2920@example.com",
      "Soft Nav Co 1793962534648-8272",
      "Mwangi Traders 1793826517379-6034",
      "Zuri E2E102399",
      "Home task 1793826088650",
    ]) {
      expect(isE2eMarked(name), name).toBe(true);
    }
  });

  it("does not recognise the seed or ordinary data", () => {
    for (const name of [
      "Kileleshwa Property Managers",
      "Davis & Shirtliff",
      "Sarova Hotels",
      "Amara Osei",
      "Live Verify FB Lead",
      "Acknowledge and qualify website lead from Amara Osei",
      "Call +254 722 000 000 about the retainer",
      "Quote 20261106",
    ]) {
      expect(isE2eMarked(name), name).toBe(false);
    }
  });

  it("treats empty values as not marked", () => {
    expect(isE2eMarked(null)).toBe(false);
    expect(isE2eMarked(undefined)).toBe(false);
    expect(isE2eMarked("")).toBe(false);
  });

  it("is the same expression the SQL receives", () => {
    expect(E2E_MARKER).toBe("(E2E|e2e|[0-9]{13})");
    for (const sql of cleanupStatements(true)) expect(sql).not.toMatch(/\$[4-9]/);
  });
});

describe("e2e clean-up: where it may run", () => {
  const dev = "postgresql://u:p@localhost:55432/figbloom_crm_dev?schema=public";

  it("reads the database name from the URL", () => {
    expect(databaseNameOf(dev)).toBe("figbloom_crm_dev");
    expect(databaseNameOf("postgresql://u:p@host/figbloom_crm_test")).toBe("figbloom_crm_test");
  });

  it("allows only the dev and test databases", () => {
    expect([...ALLOWED_DATABASES]).toEqual(["figbloom_crm_dev", "figbloom_crm_test"]);
    expect(assertSafeTarget(dev, {})).toBe("figbloom_crm_dev");
    expect(assertSafeTarget("postgresql://u:p@localhost/figbloom_crm_test", {})).toBe("figbloom_crm_test");
  });

  it("refuses any other database, however it is named", () => {
    for (const url of [
      "postgresql://u:p@prod.example.com:5432/figbloom_crm?schema=public",
      "postgresql://u:p@localhost/figbloom_crm_staging",
      "postgresql://u:p@localhost/figbloom_crm_perf",
      "postgresql://u:p@localhost/postgres",
      "postgresql://u:p@localhost/figbloom_crm_dev_copy",
    ]) {
      expect(() => assertSafeTarget(url, {}), url).toThrow(/refuses to run against database/);
    }
  });

  it("refuses with NODE_ENV=production even for the dev database name", () => {
    expect(() => assertSafeTarget(dev, { NODE_ENV: "production" })).toThrow(/NODE_ENV=production/);
  });

  it("refuses when there is no URL or it is not a URL, and never echoes the URL", () => {
    expect(() => assertSafeTarget(undefined, {})).toThrow(/no database URL/);
    expect(() => assertSafeTarget("not a url", {})).toThrow(/could not be read/);
    try {
      assertSafeTarget("postgresql://secretuser:secretpass@host/other_db", {});
    } catch (e) {
      expect(String(e)).not.toContain("secretpass");
      expect(String(e)).not.toContain("secretuser");
    }
  });
});

describe("e2e clean-up: statements", () => {
  it("only touches the legacy names, settings and technical tables when given a start time", () => {
    const without = cleanupStatements(false).join("\n");
    const withSince = cleanupStatements(true).join("\n");
    for (const names of Object.values(LEGACY_NAMES)) for (const n of names) {
      expect(without).not.toContain(n);
      expect(withSince).toContain(n);
    }
    for (const table of ["sales_targets", "automation_rules", "website_api_keys", "background_jobs", "idempotency_keys", "auth_rate_limit_attempts"]) {
      expect(without).not.toContain(`FROM ${table}`);
      expect(withSince).toContain(`FROM ${table}`);
    }
  });

  it("limits every time-based delete to rows created at or after the start", () => {
    for (const sql of cleanupStatements(true)) {
      if (/DELETE FROM (sales_targets|automation_rules|website_api_keys|files|card_captures|idempotency_keys|background_jobs|auth_rate_limit_attempts)\b/.test(sql)) {
        expect(sql, sql).toContain("created_at >= $2");
      }
    }
  });

  it("never deletes from the seed's reference or tenant structure tables", () => {
    const all = cleanupStatements(true).join("\n");
    for (const table of ["organizations", "roles", "permissions", "pipelines", "pipeline_stages", "lead_sources", "lead_statuses", "services"]) {
      expect(all).not.toMatch(new RegExp(`DELETE FROM ${table}\\b`));
    }
    // The only chat_channels delete is by a deleted record's id.
    expect(cleanupStatements(true).filter((s) => s.startsWith("DELETE FROM chat_channels"))).toEqual([
      "DELETE FROM chat_channels WHERE record_id::text IN (SELECT id FROM e2e_ids)",
    ]);
  });

  it("writes timestamps as UTC wall-clock text, because the columns have no time zone", () => {
    expect(utcTimestampLiteral(new Date("2026-11-04T20:57:00.000Z"))).toBe("2026-11-04 20:57:00.000");
  });
});
