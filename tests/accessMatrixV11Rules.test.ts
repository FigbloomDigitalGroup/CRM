/**
 * G2.01 (FIG-1156): the reviewed V1.1 role rules, applied to the recorded matrix (src/api/contract/accessMatrixV11.json).
 *
 * tests/apiWalkV11.test.ts walks every route on a V1.1 organisation and proves the recorded matrix is what the code does (about 17 minutes).
 * This file holds that matrix to the human-written rules in tests/fixtures/roleFamiliesV11.ts and to the V1 matrix, and takes seconds.
 *   - a route that worked in a V1 organisation answers every role the same way in a V1.1 organisation (except the listed changes);
 *   - Management-only areas (V1 and V1.1) stay Management's, invoices and payments stay Finance's and Management's;
 *   - each role reaches only the areas it is meant to work in, and every area listed for a role is reached by that role (a permission
 *     that was granted but is wired to nothing is found).
 * A letter other than D (refused) or U (signed out) counts as reached, as in G1.02: A answered, H hidden, V refused as invalid.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLE_KEYS, type RoleKey } from "./helpers/world";
import { MANAGEMENT_ONLY, PAYMENTS_ONLY, ROLE_FAMILIES } from "./fixtures/roleFamilies";
import { V11_COST_AND_MARGIN_ROUTES, V11_MANAGEMENT_ONLY, V11_ROLE_FAMILIES, V1_TO_V11_CHANGES } from "./fixtures/roleFamiliesV11";

const v11 = JSON.parse(readFileSync("src/api/contract/accessMatrixV11.json", "utf8")).rows as Record<string, string>;
const v1 = JSON.parse(readFileSync("src/api/contract/accessMatrix.json", "utf8")).rows as Record<string, string>;
const rows = Object.entries(v11);
/** A route counts as reached for the role rules only when it answered (A). V (refused as invalid) and H (hidden) do not show who may use it; tests/v11PermissionDenial.test.ts covers those with valid requests. */
const reached = (l: string) => l === "A";
const notRefused = (l: string) => l !== "D" && l !== "U";
const reachedBy = (row: string): RoleKey[] => ROLE_KEYS.filter((_, i) => reached(row[i]!));
const notRefusedBy = (row: string): RoleKey[] => ROLE_KEYS.filter((_, i) => notRefused(row[i]!));

/** In a V1.1 organisation members connect their own mailbox and calendar; only the organisation-wide connection is Management's. */
const V1_MANAGEMENT_ONLY_IN_V11 = MANAGEMENT_ONLY.filter((re) => !re.test("GET /api/orgs/{orgSlug}/integrations/connections") && !re.test("GET /api/orgs/{orgSlug}/integrations/connections/{connectionId}"));

describe("the V1.1 matrix against the reviewed rules (G2.01)", () => {
  it("records the five roles in the same order as the walk", () => {
    expect(JSON.parse(readFileSync("src/api/contract/accessMatrixV11.json", "utf8")).roles).toEqual([...ROLE_KEYS]);
  });

  it("keeps every route that worked in a V1 organisation answering the same in a V1.1 organisation, except the listed changes", () => {
    const changed = Object.keys(v1)
      .filter((key) => key in v11 && v1[key] !== v11[key] && /[^D]/.test(v1[key]!) && !(key in V1_TO_V11_CHANGES))
      .map((key) => `${key}: V1 ${v1[key]}, V1.1 ${v11[key]}`);
    expect(changed).toEqual([]);
  });

  it("lists only changes that happened", () => {
    expect(Object.keys(V1_TO_V11_CHANGES).filter((key) => !(key in v1) || !(key in v11) || v1[key] === v11[key])).toEqual([]);
  });

  it("keeps the V1 routes that are closed to everyone in V1 (a V1.1 feature) from being closed to Management in V1.1", () => {
    const stillClosed = Object.keys(v1).filter((key) => v1[key] === "DDDDD" && v11[key]?.[0] === "D");
    expect(stillClosed).toEqual([]);
  });

  it("keeps the Management-only areas, V1 and V1.1, to Management", () => {
    const bad = rows
      .filter(([key]) => [...V1_MANAGEMENT_ONLY_IN_V11, ...V11_MANAGEMENT_ONLY].some((re) => re.test(key)))
      .flatMap(([key, row]) => reachedBy(row).filter((r) => r !== "MANAGEMENT").map((r) => `${r} reached ${key}`));
    expect(bad).toEqual([]);
  });

  it("keeps invoices, payments and the deal payment note to Finance and Management", () => {
    const bad = rows
      .filter(([key]) => PAYMENTS_ONLY.some((re) => re.test(key)))
      .flatMap(([key, row]) => notRefusedBy(row).filter((r) => r !== "MANAGEMENT" && r !== "FINANCE").map((r) => `${r} reached ${key}`));
    expect(bad).toEqual([]);
  });

  it("keeps quote cost and margin routes to Management", () => {
    const bad = rows
      .filter(([key]) => V11_COST_AND_MARGIN_ROUTES.some((re) => re.test(key)))
      .flatMap(([key, row]) => notRefusedBy(row).filter((r) => r !== "MANAGEMENT").map((r) => `${r} reached ${key}`));
    expect(bad).toEqual([]);
  });

  it("lets each role reach only the areas it is meant to work in (V1 families plus V1.1 families)", () => {
    const bad: string[] = [];
    for (const [key, row] of rows) {
      ROLE_KEYS.forEach((role, i) => {
        if (role === "MANAGEMENT" || !reached(row[i]!)) return;
        const allowed = [...ROLE_FAMILIES[role], ...V11_ROLE_FAMILIES[role]];
        if (!allowed.some((re) => re.test(key))) bad.push(`${role} reached ${key}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("has every V1.1 area listed for a role reached by that role somewhere", () => {
    const missing: string[] = [];
    for (const role of ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const) {
      const i = ROLE_KEYS.indexOf(role);
      const keys = rows.filter(([, row]) => notRefused(row[i]!)).map(([key]) => key);
      for (const re of V11_ROLE_FAMILIES[role]) if (!keys.some((k) => re.test(k))) missing.push(`${role} never reaches ${re}`);
    }
    expect(missing).toEqual([]);
  });

  it("holds the permission model where the matrix can tell: who may use the assistant, mail and meetings", () => {
    const at = (key: string) => notRefusedBy(v11[`${key.split(" ")[0]} /api/orgs/{orgSlug}${key.split(" ")[1]}`] ?? "DDDDD");
    // ai.use: not Restricted Technical. mail.use and meetings.schedule: not Finance, not Restricted Technical.
    expect(at("POST /assistant/ask")).toEqual(["MANAGEMENT", "SALES", "DELIVERY", "FINANCE"]);
    expect(at("GET /communications/mail/drafts")).toEqual(["MANAGEMENT", "SALES", "DELIVERY"]);
    expect(at("POST /communications/meetings")).toEqual(["MANAGEMENT", "SALES", "DELIVERY"]);
    // quotes.create: Management and Sales. quotes.approve and catalogue.manage: Management.
    expect(at("GET /quotes")).toEqual(["MANAGEMENT", "SALES"]);
    expect(at("POST /approvals/{approvalId}/decision")).toEqual(["MANAGEMENT"]);
    expect(at("POST /catalogue")).toEqual(["MANAGEMENT"]);
    // chat: everybody.
    expect(at("GET /chat/channels")).toEqual([...ROLE_KEYS]);
  });
});
