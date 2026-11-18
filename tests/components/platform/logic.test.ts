import { describe, expect, it } from "vitest";
import { emptyLocal } from "../../../src/ui/screens/platform/demo/local";
import { mapAdmin, mapOrg, mapRequest, mapAudit, type RawRequest } from "../../../src/ui/screens/platform/api";
import {
  apply, applyWizardField, attentionItems, awaitingApproval, canApprove, canRemoveAdmin, canRunDeletion, dialogValid, EMPTY_WIZARD, filterOrgs, homeTiles, nameFromEmail,
  slugState, slugify, verifyCode, wizardStepError, type Action,
} from "../../../src/ui/screens/platform/logic";
import type { PlatformState } from "../../../src/ui/screens/platform/model";
import { fixtures, NOW } from "./fakePlatform";

const orgs = fixtures.orgs.map((o) => mapOrg(o));
const requests = fixtures.requests.map((r) => mapRequest(r as RawRequest, NOW));
const base = (): PlatformState => {
  const l = emptyLocal(NOW);
  return {
    orgs, requests, admins: fixtures.admins.items.map(mapAdmin), invitations: [], home: fixtures.home, me: "pa", release: l.release,
    support: l.support, announcement: { ...l.announcement, title: "Maintenance", orgs: ["o1"] }, flagHistory: l.flagHistory, activeSupport: null,
  };
};
const run = (s: PlatformState, a: Action) => apply(s, a, NOW);

describe("provisioning wizard rules (PL3)", () => {
  it("builds the slug from the name until the slug is edited by hand", () => {
    let f = applyWizardField(EMPTY_WIZARD, "name", "Kilimani Property Group");
    expect(f.slug).toBe("kilimani-property-group");
    f = applyWizardField(f, "slug", "kpg");
    f = applyWizardField(f, "name", "Kilimani Property Group Ltd");
    expect(f.slug).toBe("kpg");
  });

  it("checks the slug: empty, invalid, taken, ok", () => {
    expect(slugState("")).toBe("empty");
    expect(slugState("Ab")).toBe("invalid");
    expect(slugState("figbloom", ["figbloom"])).toBe("taken");
    expect(slugState("kilimani", ["figbloom"])).toBe("ok");
    expect(slugify("  Cafe & Co. ")).toBe("cafe-co");
  });

  it("explains why a step cannot continue, in the design wording", () => {
    expect(wizardStepError(0, EMPTY_WIZARD)).toBe("Give the organisation a name.");
    expect(wizardStepError(0, { ...EMPTY_WIZARD, name: "X", slug: "x" })).toMatch(/Slugs use lowercase/);
    expect(wizardStepError(0, { ...EMPTY_WIZARD, name: "Figbloom", slug: "figbloom" }, ["figbloom"])).toBe("That slug is taken. Choose another.");
    expect(wizardStepError(1, { ...EMPTY_WIZARD, email: "a@b.co" })).toMatch(/Enter the first admin’s name/);
    expect(wizardStepError(1, { ...EMPTY_WIZARD, ownerName: "A", email: "nope" })).toMatch(/Enter the first admin’s email/);
    expect(wizardStepError(1, { ...EMPTY_WIZARD, ownerName: "A", email: "new@company.co.ke" })).toBe("");
  });
});

describe("mapping the API's records", () => {
  it("maps an organisation's counts and status", () => {
    expect(orgs[2]).toMatchObject({ status: "Offboarding", members: 3, companies: 4, deals: 2 });
  });

  it("maps a deletion request: two approvals needed, one given, steps derived from the facts", () => {
    const r = requests[0]!;
    expect(r).toMatchObject({ kind: "offboard", status: "In review", approvalsRequired: 2, approvals: ["pg"], type: "Organisation deletion" });
    expect(r.steps.map(([, done]) => done)).toEqual([true, true, false, false, false, false, false]);
    expect(requests[1]).toMatchObject({ kind: "export", status: "Received", approvalsRequired: 1 });
  });

  it("maps admins and audit events", () => {
    expect(mapAdmin(fixtures.admins.items[2]!)).toMatchObject({ tfa: "Not set up", last: "Never" });
    const a = mapAudit({ seq: 1, id: "x", occurredAt: NOW.toISOString(), actorIdentityId: "pa", actorLabel: "a@p.test", action: "organization.provisioned", targetType: "Organization", targetId: null, organizationId: "o1", organizationSlug: "figbloom", reason: null, metadata: { name: "N" }, requestId: "r1" });
    expect(a).toMatchObject({ action: "Organisation provisioned", org: "figbloom", detail: "name: N" });
  });
});

describe("the approval rule (FIG-1162)", () => {
  it("lets a different admin approve, not the same one twice, and nobody once it is fully approved", () => {
    const r = requests[0]!;
    expect(canApprove(r, "pa")).toEqual({ ok: true });
    expect(canApprove(r, "pg")).toMatchObject({ ok: false, reason: expect.stringMatching(/already approved/) });
    expect(canApprove({ ...r, approvals: ["pg", "pa"] }, "pm")).toMatchObject({ ok: false });
    expect(canApprove({ ...r, status: "Rejected" }, "pa")).toMatchObject({ ok: false });
  });

  it("an export needs one approval, a deletion two", () => {
    expect(awaitingApproval(requests[1]!)).toBe(true);
    expect(awaitingApproval({ ...requests[1]!, approvals: ["pa"] })).toBe(false);
    expect(awaitingApproval(requests[0]!)).toBe(true);
  });

  it("deletion can run only when approved, the retention period is over and the export is packaged", () => {
    const r = { ...requests[0]!, status: "Approved" as const, due: new Date(NOW.getTime() + 864e5), exportStatus: "READY" as const };
    expect(canRunDeletion(r, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/Retention/) });
    expect(canRunDeletion({ ...r, due: new Date(NOW.getTime() - 1) }, NOW)).toEqual({ ok: true });
    expect(canRunDeletion({ ...r, due: null, exportStatus: "PACKAGING" }, NOW)).toMatchObject({ ok: false });
  });
});

describe("minimum two platform admins (FIG-1163)", () => {
  it("allows a removal while three are active, blocks the second-last, and blocks removing yourself", () => {
    const admins = base().admins;
    expect(canRemoveAdmin(admins, "pa", "pm")).toEqual({ ok: true });
    expect(canRemoveAdmin(admins.slice(0, 2), "pa", "pg")).toMatchObject({ ok: false, reason: "Blocked: at least two platform admins are required." });
    expect(canRemoveAdmin(admins, "pa", "pa")).toMatchObject({ ok: false, reason: "Ask another admin to remove you." });
  });

  it("derives a name for an invite from the email", () => {
    expect(nameFromEmail("sam.new@platform.test")).toBe("Sam New");
  });
});

describe("the organisation dialog (PL5)", () => {
  it("needs a reason of 5 to 500 characters and the exact name typed back", () => {
    expect(dialogValid("", "X", "X")).toBe(false);
    expect(dialogValid("abc", "X", "X")).toBe(false);
    expect(dialogValid("Abuse report", "x", "X")).toBe(false);
    expect(dialogValid("Abuse report", "X", "X")).toBe(true);
    expect(dialogValid("a".repeat(501), "X", "X")).toBe(false);
  });
});

describe("support access (V2, in memory)", () => {
  const req: Action = { type: "support-request", org: "o2", reason: "Check import", ticket: "FIG-1", mins: 30, scope: "Leads (read-only)", mask: true };

  it("is requested, approved by the organisation, runs for its time, ends on its own or by the admin", () => {
    let { state } = run(base(), req);
    const pending = state.support[0]!;
    expect(pending.status).toBe("Pending organisation approval");
    state = run(state, { type: "support-approve", id: pending.id }).state;
    expect(state.activeSupport).toBe(pending.id);
    expect(state.support[0]!.endsAt!.getTime()).toBe(NOW.getTime() + 30 * 60000);
    expect(run(state, { type: "support-end", id: pending.id }).state.activeSupport).toBeNull();
    expect(run(state, { type: "support-expire", id: pending.id }).state.support[0]!.status).toBe("Expired");
  });

  it("needs a reason", () => {
    expect(run(base(), { ...req, reason: " " }).result.ok).toBe(false);
  });
});

describe("flags, limits and announcements (V2, in memory)", () => {
  it("records each flag and limit change in the history", () => {
    const f = run(base(), { type: "flag", org: "o2", flag: "assistant" });
    expect(f.state.orgs.find((o) => o.id === "o2")!.flags.assistant).toBe(false);
    expect(f.state.flagHistory[0]).toEqual(["Just now", "You", "Figbloom Sandbox", "Assistant", "On → Off"]);
    const l = run(f.state, { type: "limit", org: "o2", limit: "seats", value: 9 });
    expect(l.state.flagHistory[0]![4]).toBe("5 → 9");
  });

  it("publishes and expires an announcement, needing an audience", () => {
    const s = base();
    expect(run(run(s, { type: "announcement", patch: { orgs: [] } }).state, { type: "announcement-publish" }).result.ok).toBe(false);
    const live = run(s, { type: "announcement-publish" });
    expect(live.state.announcement.status).toBe("Live");
    expect(run(live.state, { type: "announcement-expire" }).state.announcement.status).toBe("Expired");
  });
});

describe("list, home and verify (PL1, PL2, PL14)", () => {
  it("filters and sorts organisations", () => {
    expect(filterOrgs(orgs, "west", "", "name").map((o) => o.slug)).toEqual(["westlands-pilot"]);
    expect(filterOrgs(orgs, "", "Active", "name").map((o) => o.name)).toEqual(["FigBloom Digital Group", "Figbloom Sandbox"]);
    expect(filterOrgs(orgs, "", "", "members")[0]!.slug).toBe("figbloom");
    expect(filterOrgs(orgs, "zzz", "", "name")).toEqual([]);
  });

  it("lists what needs attention: degraded components, open incidents, requests waiting for approval", () => {
    expect(attentionItems(base()).map((a) => a.key)).toEqual(["h-EMAIL", "incidents", "r-dr1", "r-dr2"]);
  });

  it("builds the home tiles from the API's numbers", () => {
    const tiles = homeTiles(base());
    expect(tiles.find((t) => t.key === "orgs")).toMatchObject({ v: "3" });
    expect(tiles.find((t) => t.key === "health")).toMatchObject({ v: "Degraded", warn: true });
    expect(homeTiles({ ...base(), home: null })).toEqual([]);
  });

  it("the stand-alone verify page accepts a 6-digit code or an XXXX-XXXX backup code, and rejects 000000", () => {
    expect(verifyCode("123 456", false)).toBe(true);
    expect(verifyCode("000000", false)).toBe(false);
    expect(verifyCode("12345", false)).toBe(false);
    expect(verifyCode("AB12-CD34", true)).toBe(true);
    expect(verifyCode("123456", true)).toBe(false);
  });

  it("never mutates the state it was given", () => {
    const s = base();
    const before = JSON.stringify(s);
    run(s, { type: "flag", org: "o2", flag: "assistant" });
    run(s, { type: "support-request", org: "o2", reason: "r", ticket: "", mins: 30, scope: "x", mask: true });
    expect(JSON.stringify(s)).toBe(before);
  });
});
