import { describe, expect, it } from "vitest";
import { seedPlatform } from "../../../src/ui/screens/platform/demo/data";
import {
  apply, applyWizardField, attentionItems, awaitingSecond, canApprove, canRemoveAdmin, dialogValid, EMPTY_WIZARD, filterOrgs, hasTwoApprovals, slugState, slugify,
  stepLocked, verifyCode, wizardStepError, type Action,
} from "../../../src/ui/screens/platform/logic";

const NOW = new Date("2026-10-30T12:00:00Z");
const fresh = () => seedPlatform(NOW);
const run = (s: ReturnType<typeof fresh>, a: Action) => apply(s, a, NOW);

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
    expect(slugState("figbloom")).toBe("taken");
    expect(slugState("kilimani")).toBe("ok");
    expect(slugify("  Cafe & Co. ")).toBe("cafe-co");
  });

  it("explains why a step cannot continue, in the design wording", () => {
    expect(wizardStepError(0, EMPTY_WIZARD)).toBe("Give the organisation a name.");
    expect(wizardStepError(0, { ...EMPTY_WIZARD, name: "X", slug: "x" })).toMatch(/Slugs use lowercase/);
    expect(wizardStepError(0, { ...EMPTY_WIZARD, name: "Figbloom", slug: "figbloom" })).toBe("That slug is taken. Choose another.");
    expect(wizardStepError(2, { ...EMPTY_WIZARD, email: "nope" })).toMatch(/Enter the first admin/);
    expect(wizardStepError(2, { ...EMPTY_WIZARD, email: "Amina@WestlandsClinics.co.ke" })).toMatch(/already has a pending invite/);
    expect(wizardStepError(2, { ...EMPTY_WIZARD, email: "new@company.co.ke" })).toBe("");
  });

  it("provisions an Active organisation with a pending Management invite, and audits it", () => {
    const form = { ...EMPTY_WIZARD, name: "Kilimani Property Group", slug: "kilimani", email: "boss@kilimani.co.ke" };
    const { state, result } = run(fresh(), { type: "provision", form, lists: {}, keys: { web: true, mail: false } });
    expect(result.ok).toBe(true);
    const org = state.orgs.find((o) => o.slug === "kilimani")!;
    expect(org.status).toBe("Active");
    expect(org.people[0]).toEqual(["Invite pending", "boss@kilimani.co.ke", "Management"]);
    expect(state.audit[0]).toMatchObject({ action: "Organisation provisioned", org: "Kilimani Property Group" });
  });

  it("refuses a taken slug even if the screen let it through", () => {
    const form = { ...EMPTY_WIZARD, name: "Dup", slug: "figbloom", email: "a@b.co" };
    const { result } = run(fresh(), { type: "provision", form, lists: {}, keys: { web: false, mail: false } });
    expect(result).toMatchObject({ ok: false, message: "That slug is taken. Choose another." });
  });
});

describe("minimum two platform admins (FIG-1163)", () => {
  it("allows a removal while three admins exist, then blocks the second-last", () => {
    const s0 = fresh();
    expect(s0.admins).toHaveLength(3);
    const first = run(s0, { type: "admin-remove", id: "pm" });
    expect(first.result.ok).toBe(true);
    expect(first.state.admins.map((a) => a.id)).toEqual(["pa", "pg"]);
    const second = run(first.state, { type: "admin-remove", id: "pg" });
    expect(second.result).toMatchObject({ ok: false, message: "Blocked: at least two platform admins are required." });
    expect(second.state.admins).toHaveLength(2);
  });

  it("never removes the signed-in admin, even above the minimum", () => {
    expect(canRemoveAdmin(fresh().admins, "pa", "pa")).toEqual({ ok: false, reason: "Ask another admin to remove you." });
  });

  it("only invites platform.figbloom.co.ke addresses, once", () => {
    const bad = run(fresh(), { type: "admin-invite", email: "x@gmail.com" });
    expect(bad.result.ok).toBe(false);
    const ok = run(fresh(), { type: "admin-invite", email: "new@platform.figbloom.co.ke" });
    expect(ok.state.admins).toHaveLength(4);
    expect(run(ok.state, { type: "admin-invite", email: "new@platform.figbloom.co.ke" }).result.ok).toBe(false);
  });
});

describe("two-person approval of deletions (FIG-1162)", () => {
  it("the same admin cannot approve twice; a different admin completes it; the delete step unlocks", () => {
    const s0 = fresh();
    const offboard = s0.requests.find((r) => r.id === "dr1")!;
    expect(offboard.approvals).toEqual(["pa"]);
    expect(awaitingSecond(offboard)).toBe(true);
    expect(canApprove(offboard, "pa")).toMatchObject({ ok: false });
    expect(run(s0, { type: "request-approve", id: "dr1" }).result.ok).toBe(false);

    const del = offboard.steps.findIndex(([l]) => /Delete organisation data/.test(l));
    expect(stepLocked(offboard, offboard.steps[del]![0], false)).toBe(true);
    expect(run(s0, { type: "request-step", id: "dr1", index: del }).result.ok).toBe(false);

    const after = run(s0, { type: "request-approve", id: "dr1", as: "pg" });
    expect(after.result.ok).toBe(true);
    const r = after.state.requests.find((x) => x.id === "dr1")!;
    expect(hasTwoApprovals(r)).toBe(true);
    expect(run(after.state, { type: "request-step", id: "dr1", index: del }).result.ok).toBe(true);
  });

  it("completes a request when every step is ticked", () => {
    let s = run(fresh(), { type: "request-approve", id: "dr1", as: "pg" }).state;
    const n = s.requests.find((x) => x.id === "dr1")!.steps.length;
    for (let i = 0; i < n; i++) if (!s.requests.find((x) => x.id === "dr1")!.steps[i]![1]) s = run(s, { type: "request-step", id: "dr1", index: i }).state;
    expect(s.requests.find((x) => x.id === "dr1")!.status).toBe("Completed");
  });

  it("exports never need a second admin", () => {
    expect(awaitingSecond(fresh().requests.find((r) => r.kind === "export")!)).toBe(false);
  });
});

describe("suspend, reactivate and offboard (PL5)", () => {
  it("needs a reason and the exact organisation name", () => {
    expect(dialogValid("", "Figbloom Sandbox", "Figbloom Sandbox")).toBe(false);
    expect(dialogValid("Non-payment", "figbloom sandbox", "Figbloom Sandbox")).toBe(false);
    expect(dialogValid("Non-payment", "Figbloom Sandbox", "Figbloom Sandbox")).toBe(true);
  });

  it("suspends and reactivates, and writes the audit log", () => {
    const sus = run(fresh(), { type: "org-status", id: "o2", kind: "suspend", reason: "Abuse report", notify: true });
    expect(sus.state.orgs.find((o) => o.id === "o2")!.status).toBe("Suspended");
    expect(sus.result).toMatchObject({ ok: true, message: "Figbloom Sandbox is now Suspended. Management was emailed." });
    const re = run(sus.state, { type: "org-status", id: "o2", kind: "reactivate", reason: "Resolved", notify: false });
    expect(re.state.orgs.find((o) => o.id === "o2")!.status).toBe("Active");
    expect(re.state.audit.slice(0, 2).map((a) => a.action)).toEqual(["Reactivate", "Suspend organisation"]);
  });

  it("starting offboarding opens a data request that needs two admins", () => {
    const { state } = run(fresh(), { type: "org-status", id: "o1", kind: "offboard", reason: "Contract ended", notify: true });
    const req = state.requests[0]!;
    expect(req).toMatchObject({ type: "Tenant offboarding", org: "o1", approvals: [], status: "Received" });
    expect(awaitingSecond(req)).toBe(true);
  });

  it("refuses to offboard twice and to act without a reason", () => {
    expect(run(fresh(), { type: "org-status", id: "o3", kind: "offboard", reason: "x", notify: false }).result.ok).toBe(false);
    expect(run(fresh(), { type: "org-status", id: "o2", kind: "suspend", reason: "  ", notify: false }).result.ok).toBe(false);
  });
});

describe("support access (V2)", () => {
  const req: Action = { type: "support-request", org: "o2", reason: "Check import", ticket: "FIG-1", mins: 30, scope: "Leads (read-only)", mask: true };

  it("is requested, approved by the organisation, runs for its time, ends on its own or by the admin", () => {
    let { state } = run(fresh(), req);
    const pending = state.support[0]!;
    expect(pending.status).toBe("Pending organisation approval");
    expect(state.activeSupport).toBeNull();
    state = run(state, { type: "support-approve", id: pending.id }).state;
    expect(state.activeSupport).toBe(pending.id);
    expect(state.support[0]!.endsAt!.getTime()).toBe(NOW.getTime() + 30 * 60000);
    const ended = run(state, { type: "support-end", id: pending.id }).state;
    expect(ended.activeSupport).toBeNull();
    expect(ended.support[0]).toMatchObject({ status: "Ended", endedBy: "Dev Super Admin" });
    const expired = run(state, { type: "support-expire", id: pending.id }).state;
    expect(expired.support[0]!.status).toBe("Expired");
  });

  it("needs a reason", () => {
    expect(run(fresh(), { ...req, reason: " " }).result.ok).toBe(false);
  });
});

describe("flags, limits and announcements (V2)", () => {
  it("records each flag and limit change in the history and the audit log", () => {
    const f = run(fresh(), { type: "flag", org: "o2", flag: "assistant" });
    expect(f.state.orgs.find((o) => o.id === "o2")!.flags.assistant).toBe(true);
    expect(f.state.flagHistory[0]).toEqual(["Just now", "Dev Super Admin", "Figbloom Sandbox", "Assistant", "Off → On"]);
    const l = run(f.state, { type: "limit", org: "o2", limit: "seats", value: 9 });
    expect(l.state.flagHistory[0]![4]).toBe("5 → 9");
    expect(l.state.audit[0]!.action).toBe("Flag changed");
    expect(run(l.state, { type: "limit", org: "o2", limit: "seats", value: 9 }).state.flagHistory).toHaveLength(l.state.flagHistory.length);
  });

  it("publishes and expires an announcement, needing an audience", () => {
    const s = fresh();
    const noAudience = run(run(s, { type: "announcement", patch: { orgs: [] } }).state, { type: "announcement-publish" });
    expect(noAudience.result.ok).toBe(false);
    const live = run(s, { type: "announcement-publish" });
    expect(live.state.announcement.status).toBe("Live");
    expect(run(live.state, { type: "announcement-expire" }).state.announcement.status).toBe("Expired");
  });
});

describe("list, search, home and verify (PL1, PL2, PL14)", () => {
  it("filters and sorts organisations", () => {
    const orgs = fresh().orgs;
    expect(filterOrgs(orgs, "west", "", "last").map((o) => o.slug)).toEqual(["westlands-pilot"]);
    expect(filterOrgs(orgs, "", "Active", "name").map((o) => o.name)).toEqual(["FigBloom Digital Group", "Figbloom Sandbox"]);
    expect(filterOrgs(orgs, "zzz", "", "last")).toEqual([]);
  });

  it("lists what needs attention: degraded health, deletions waiting for a second admin, support pending", () => {
    expect(attentionItems(fresh(), NOW).map((a) => a.key)).toEqual(["h-web", "r-dr1", "s-ss2"]);
  });

  it("accepts a 6-digit code or an XXXX-XXXX backup code, and rejects 000000", () => {
    expect(verifyCode("123 456", false)).toBe(true);
    expect(verifyCode("000000", false)).toBe(false);
    expect(verifyCode("12345", false)).toBe(false);
    expect(verifyCode("AB12-CD34", true)).toBe(true);
    expect(verifyCode("123456", true)).toBe(false);
  });

  it("never mutates the state it was given", () => {
    const s = fresh();
    const before = JSON.stringify(s);
    run(s, { type: "org-status", id: "o2", kind: "suspend", reason: "r", notify: false });
    run(s, { type: "admin-remove", id: "pm" });
    expect(JSON.stringify(s)).toBe(before);
  });
});
