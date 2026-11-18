import { describe, expect, it } from "vitest";
import { archiveCompany, createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import { createDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import {
  clearRecents,
  recentSearches,
  rememberRecentSearch,
  searchAll,
} from "../src/services/searchService";
import { ValidationError } from "../src/auth/errors";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

const group = (r: Awaited<ReturnType<typeof searchAll>>, type: string) => r.groups.find((g) => g.type === type);

describe("global search v2 (FIG-1041, B2.12)", () => {
  it("groups results by type with a total per group and pages inside one group", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    for (let i = 0; i < 7; i += 1) await createCompany(mgmt, { name: `Zebra Works ${i}` });
    await createContact(mgmt, { firstName: "Zebra", lastName: "Keeper" });

    const all = await searchAll(mgmt, { q: "zebra" });
    expect(group(all, "companies")?.total).toBe(7);
    expect(group(all, "companies")?.items).toHaveLength(5); // preview size
    expect(group(all, "contacts")?.total).toBe(1);
    expect(all.total).toBe(8);

    const page2 = await searchAll(mgmt, { q: "zebra", type: "companies", paging: { page: 2, pageSize: 5 } });
    expect(page2.groups).toHaveLength(1);
    expect(page2.groups[0]!.items).toHaveLength(2);
    expect(page2.groups[0]!.nextCursor).toBeNull();
  });

  it("finds a phone number written in any Kenyan format", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    await createContact(mgmt, { firstName: "Wanjiru", phone: "+254 712 345 678" });
    await createCompany(mgmt, { name: "Mombasa Freight", phone: "0712-345-678" });
    await createContact(mgmt, { firstName: "Other", phone: "0799 000 111" });

    for (const q of ["0712345678", "+254712345678", "712 345 678", "254712345678"]) {
      const r = await searchAll(mgmt, { q });
      expect(group(r, "contacts")?.items.map((c) => c.label)).toEqual(["Wanjiru"]);
      expect(group(r, "companies")?.items.map((c) => c.label)).toEqual(["Mombasa Freight"]);
    }
  });

  it("leaves archived records out by default and finds them with the filter", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(mgmt, { name: "Quokka Old Ltd" });
    await createCompany(mgmt, { name: "Quokka Live Ltd" });
    await archiveCompany(mgmt, company.id, { reason: "Closed" });

    const normal = await searchAll(mgmt, { q: "quokka" });
    expect(group(normal, "companies")?.items.map((c) => c.label)).toEqual(["Quokka Live Ltd"]);
    const only = await searchAll(mgmt, { q: "quokka", archived: "only" });
    expect(group(only, "companies")?.items.map((c) => [c.label, c.archived])).toEqual([["Quokka Old Ltd", true]]);
    const both = await searchAll(mgmt, { q: "quokka", archived: "include" });
    expect(group(both, "companies")?.total).toBe(2);
  });

  it("limits a role to what it may view, says results are hidden, and never leaks others' records or values", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const salesA = await createTestContext(org.id, "SALES", "a");
    const salesB = await createTestContext(org.id, "SALES", "b");
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    const statusId = await getLeadStatusId(org.id);
    const stageId = await getPipelineStageId(org.id);
    const { company } = await createCompany(mgmt, { name: "Narwhal Holdings" });
    await createLead(salesB, { leadStatusId: statusId, companyId: company.id });
    await createDeal(salesB, { companyId: company.id, pipelineStageId: stageId, value: 987654 } as never);

    const asA = await searchAll(salesA, { q: "narwhal" });
    expect(group(asA, "leads")?.total ?? 0).toBe(0); // B's lead
    expect(group(asA, "deals")?.total ?? 0).toBe(0); // B's deal
    expect(asA.hidden.someResultsHidden).toBe(true);
    expect(asA.hidden.limitedToYours).toContain("leads");
    expect(JSON.stringify(asA)).not.toContain("987654");

    const asTech = await searchAll(technical, { q: "narwhal" });
    expect(asTech.hidden.someResultsHidden).toBe(true);
    expect(asTech.hidden.unavailableGroups.length).toBeGreaterThan(0);
    expect(asTech.hidden.unavailableGroups[0]!.reason).toMatch(/role/i);
    expect(JSON.stringify(asTech)).not.toContain("987654");

    const asMgmt = await searchAll(mgmt, { q: "narwhal" });
    expect(group(asMgmt, "leads")?.total).toBe(1);
    expect(group(asMgmt, "deals")?.total).toBe(1);
    expect(JSON.stringify(asMgmt)).not.toContain("987654"); // results carry no values at all
  });

  it("never returns another organisation's rows, including through a phone match", async () => {
    const a = await createTestOrganization();
    const b = await createTestOrganization();
    const mgmtA = await createTestContext(a.id, "MANAGEMENT", "ma");
    const mgmtB = await createTestContext(b.id, "MANAGEMENT", "mb");
    await createContact(mgmtB, { firstName: "Elsewhere", phone: "0722 111 222" });
    const r = await searchAll(mgmtA, { q: "0722111222" });
    expect(r.total).toBe(0);
    const byName = await searchAll(mgmtA, { q: "Elsewhere" });
    expect(byName.total).toBe(0);
  });

  it("keeps a short, per-user, newest-first list of recent searches", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "s");
    for (let i = 0; i < 12; i += 1) await rememberRecentSearch(mgmt, `query ${i}`);
    await rememberRecentSearch(mgmt, "QUERY 5"); // same text, other case: moves to the top, no duplicate
    const recents = await recentSearches(mgmt);
    expect(recents).toHaveLength(10);
    expect(recents[0]!.query).toBe("QUERY 5");
    expect(recents.filter((r) => r.query.toLowerCase() === "query 5")).toHaveLength(1);
    expect(await recentSearches(sales)).toEqual([]);
    await expect(rememberRecentSearch(mgmt, "x")).rejects.toBeInstanceOf(ValidationError);
    expect((await clearRecents(mgmt)).cleared).toBe(10);
    expect(await recentSearches(mgmt)).toEqual([]);
  });

  it("answers a too-short query with an empty result and no error", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const r = await searchAll(mgmt, { q: " a " });
    expect(r.tooShort).toBe(true);
    expect(r.groups).toEqual([]);
  });
});
