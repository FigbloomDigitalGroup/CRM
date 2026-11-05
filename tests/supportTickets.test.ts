import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { FeatureUnavailableError } from "../src/lib/featureFlags";
import { setOrganizationRelease, updateFeatureToggles } from "../src/services/featureService";
import {
  addTicketMessage,
  answerSurvey,
  createTicket,
  getSupportCustomerView,
  getTicket,
  listSurveys,
  listTickets,
  openSurvey,
  sendSurvey,
  updateTicket,
} from "../src/services/ticketService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

/**
 * FIG-1155 (B6.23): Customer Support tickets and satisfaction surveys, behind
 * `customer_support.role`, role-limited, tenant-isolated.
 */
const orgIds: string[] = [];
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
});

let n = Math.floor(Math.random() * 60000);
const ip = () => `10.${(++n >> 8) & 255}.${Math.floor(n / 250) % 250}.${n % 250}`;

/** An organisation on V1.1 with the Customer Support role switched on. */
async function supportOrg(options: { release?: "v1" | "v1.1"; toggle?: boolean } = {}) {
  const org = await createTestOrganization("Support");
  orgIds.push(org.id);
  if ((options.release ?? "v1.1") === "v1.1") await setOrganizationRelease(org.id, "v1.1");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "sup.mgmt");
  if ((options.release ?? "v1.1") === "v1.1" && (options.toggle ?? true)) await updateFeatureToggles(mgmt, { "customer_support.role": true });
  // contexts are resolved after the flag is set
  const fresh = async (role: string, prefix: string) => createTestContext(org.id, role, prefix);
  return { org, mgmt: await fresh("MANAGEMENT", "sup.mgmt2"), support: await fresh("CUSTOMER_SUPPORT", "sup.cs"), fresh };
}

async function customer(orgId: string, withEmail = true) {
  const company = await adminDb.company.create({ data: { organizationId: orgId, name: `Customer ${randomUUID().slice(0, 6)}`, industry: "Retail" } });
  const contact = await adminDb.contact.create({
    data: { organizationId: orgId, companyId: company.id, firstName: "Grace", lastName: "Achieng", email: withEmail ? `grace.${randomUUID().slice(0, 6)}@example.test` : null },
  });
  return { company, contact };
}

describe("the gate", () => {
  it("answers nothing in V1, and nothing in V1.1 until the organisation switches the role on", async () => {
    const v1 = await supportOrg({ release: "v1" });
    const { company } = await customer(v1.org.id);
    await expect(createTicket(v1.mgmt, { companyId: company.id, title: "x" })).rejects.toBeInstanceOf(FeatureUnavailableError);
    const off = await supportOrg({ toggle: false });
    const c2 = await customer(off.org.id);
    await expect(createTicket(off.mgmt, { companyId: c2.company.id, title: "x" })).rejects.toBeInstanceOf(FeatureUnavailableError);
    await expect(listTickets(off.mgmt)).rejects.toBeInstanceOf(FeatureUnavailableError);
    // and the role carries no permission while the flag is off
    const cs = await createTestContext(off.org.id, "CUSTOMER_SUPPORT", "sup.off");
    expect(cs.permissionKeys).toEqual([]);
  });

  it("is open to Management and Customer Support only: every other role is refused on every operation", async () => {
    const { org, mgmt, fresh } = await supportOrg();
    const { company } = await customer(org.id);
    const ticket = await createTicket(mgmt, { companyId: company.id, title: "Seen by management" });
    for (const role of ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]) {
      const ctx = await fresh(role, `sup.${role.toLowerCase()}`);
      const calls: Promise<unknown>[] = [
        createTicket(ctx, { companyId: company.id, title: "x" }),
        listTickets(ctx),
        getTicket(ctx, ticket.id),
        updateTicket(ctx, ticket.id, { status: "RESOLVED" }),
        addTicketMessage(ctx, ticket.id, { kind: "STAFF", body: "x" }),
        sendSurvey(ctx, { companyId: company.id }),
        listSurveys(ctx),
        getSupportCustomerView(ctx, company.id),
      ];
      // Handlers are attached to every call at once, so no rejection is ever left unhandled while an earlier one is awaited.
      await Promise.all(calls.map((call) => expect(call, role).rejects.toBeInstanceOf(ForbiddenError)));
    }
  });
});

describe("tickets", () => {
  it("creates numbered tickets linked to a customer, works them through the statuses, keeps a thread and audits changes", async () => {
    const { org, support, mgmt } = await supportOrg();
    const { company, contact } = await customer(org.id);
    const a = await createTicket(support, { companyId: company.id, contactId: contact.id, title: "  Payroll export misses a column ", priority: "HIGH", description: "Since the last update." });
    const b = await createTicket(support, { companyId: company.id, title: "Second" });
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(a).toMatchObject({ title: "Payroll export misses a column", status: "OPEN", priority: "HIGH", company: { id: company.id }, contact: { id: contact.id, name: "Grace Achieng" } });

    await addTicketMessage(support, a.id, { kind: "CUSTOMER", body: "It is urgent.", authorLabel: "Grace Achieng" });
    await addTicketMessage(support, a.id, { kind: "STAFF", body: "Looking into it." });
    await addTicketMessage(support, a.id, { kind: "INTERNAL", body: "Ask Delivery." });
    const owner = mgmt.membershipId;
    const waiting = await updateTicket(support, a.id, { status: "WAITING_ON_CLIENT", ownerMembershipId: owner });
    expect(waiting).toMatchObject({ status: "WAITING_ON_CLIENT", resolvedAt: null });
    expect(waiting.owner?.membershipId).toBe(owner);
    const resolved = await updateTicket(mgmt, a.id, { status: "RESOLVED" });
    expect(resolved.resolvedAt).not.toBeNull();
    expect((await updateTicket(support, a.id, { status: "OPEN" })).resolvedAt).toBeNull();

    const full = await getTicket(support, a.id);
    expect(full.messages.map((m) => [m.kind, m.author])).toEqual([["CUSTOMER", "Grace Achieng"], ["STAFF", expect.any(String)], ["INTERNAL", expect.any(String)]]);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityType: "Ticket", entityId: a.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((e) => e.action)).toEqual(["ticket.created", "ticket.updated", "ticket.updated", "ticket.updated"]);

    const open = await listTickets(support, { status: "OPEN" });
    expect(open.items.map((t) => t.number).sort()).toEqual([1, 2]);
    expect((await listTickets(support, { q: "second" })).items).toHaveLength(1);
    expect((await listTickets(support, { companyId: randomUUID() })).total).toBe(0);
  });

  it("validates input and refuses a customer, contact or owner that does not belong", async () => {
    const { org, support } = await supportOrg();
    const { company } = await customer(org.id);
    const other = await customer(org.id);
    await expect(createTicket(support, { companyId: company.id, title: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(support, { companyId: company.id, title: "x".repeat(161) })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(support, { companyId: company.id, title: "x", priority: "URGENT" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(support, { companyId: randomUUID(), title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTicket(support, { companyId: company.id, contactId: other.contact.id, title: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(support, { companyId: company.id, title: "x", ownerMembershipId: randomUUID() })).rejects.toBeInstanceOf(ValidationError);
    const t = await createTicket(support, { companyId: company.id, title: "ok" });
    await expect(updateTicket(support, t.id, { status: "DONE" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addTicketMessage(support, t.id, { kind: "SHOUT", body: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addTicketMessage(support, t.id, { kind: "STAFF", body: " " })).rejects.toBeInstanceOf(ValidationError);
    await expect(getTicket(support, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("numbers tickets without gaps or duplicates when several are opened at once", async () => {
    const { org, support } = await supportOrg();
    const { company } = await customer(org.id);
    const made = await Promise.all(Array.from({ length: 6 }, (_, i) => createTicket(support, { companyId: company.id, title: `Parallel ${i}` })));
    expect(made.map((t) => t.number).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("tenant isolation", () => {
  it("shows organisation B none of organisation A's tickets, messages or surveys, and refuses A's customer", async () => {
    const a = await supportOrg();
    const b = await supportOrg();
    const ca = await customer(a.org.id);
    const ticket = await createTicket(a.support, { companyId: ca.company.id, title: "Only A" });
    await addTicketMessage(a.support, ticket.id, { kind: "STAFF", body: "private to A" });
    await updateTicket(a.support, ticket.id, { status: "RESOLVED" });
    await sendSurvey(a.support, { ticketId: ticket.id });

    expect((await listTickets(b.support)).total).toBe(0);
    expect((await listSurveys(b.support)).total).toBe(0);
    await expect(getTicket(b.support, ticket.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateTicket(b.support, ticket.id, { status: "OPEN" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addTicketMessage(b.support, ticket.id, { kind: "STAFF", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTicket(b.support, { companyId: ca.company.id, title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendSurvey(b.support, { ticketId: ticket.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSupportCustomerView(b.support, ca.company.id)).rejects.toBeInstanceOf(NotFoundError);
    // the database says the same, with no application filter in the way
    for (const table of ["tickets", "ticket_messages", "satisfaction_surveys"]) {
      const rows = await withOrgContext(b.org.id, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}"`));
      expect(rows[0]!.n, table).toBe(0);
    }
    // a same-organisation foreign key refuses a company from another organisation even by raw SQL
    await expect(
      adminDb.$executeRawUnsafe(`INSERT INTO tickets (id, organization_id, number, company_id, title) VALUES ('${randomUUID()}', '${b.org.id}', 99, '${ca.company.id}', 'cross')`),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe("satisfaction surveys", () => {
  it("is sent only for a resolved ticket, once at a time, by email with a link whose token is not stored", async () => {
    const { org, support } = await supportOrg();
    const { company, contact } = await customer(org.id);
    const ticket = await createTicket(support, { companyId: company.id, contactId: contact.id, title: "To survey" });
    await expect(sendSurvey(support, { ticketId: ticket.id })).rejects.toThrow(/resolved/);
    await updateTicket(support, ticket.id, { status: "RESOLVED" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let printed = "";
    let survey;
    try {
      survey = await sendSurvey(support, { ticketId: ticket.id });
      printed = log.mock.calls.map((c) => String(c[1] ?? c[0])).join("\n");
    } finally {
      log.mockRestore();
    }
    expect(survey).toMatchObject({ status: "WAITING", score: null, ticketId: ticket.id, companyId: company.id });
    expect(printed).toContain(contact.email!);
    const token = /\/survey\/([A-Za-z0-9_-]+)/.exec(printed)![1]!;
    const row = await adminDb.satisfactionSurvey.findUniqueOrThrow({ where: { id: survey.id } });
    expect(row.tokenHash).not.toContain(token);
    expect(JSON.stringify(survey)).not.toContain(token);
    await expect(sendSurvey(support, { ticketId: ticket.id })).rejects.toThrow(/already waiting/);
  });

  it("needs a contact with an email, and a customer or ticket", async () => {
    const { org, support } = await supportOrg();
    const { company } = await customer(org.id, false);
    await expect(sendSurvey(support, { companyId: company.id })).rejects.toThrow(/email address/);
    await expect(sendSurvey(support, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("lets the customer answer once through the link: no sign-in, score 1 to 5, a comment, then it is spent", async () => {
    const { org, support } = await supportOrg();
    const { company } = await customer(org.id);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let token = "";
    try {
      await sendSurvey(support, { companyId: company.id });
      token = /\/survey\/([A-Za-z0-9_-]+)/.exec(log.mock.calls.map((c) => String(c[1] ?? c[0])).join("\n"))![1]!;
    } finally {
      log.mockRestore();
    }
    expect(await openSurvey(token, ip())).toEqual({ status: "open", organizationName: expect.stringContaining("Support") });
    await expect(answerSurvey(token, { score: 0 }, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(answerSurvey(token, { score: 6 }, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(answerSurvey(token, { score: 4.5 }, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(answerSurvey(token, { score: 5, comment: "x".repeat(1001) }, ip())).rejects.toBeInstanceOf(ValidationError);
    await expect(answerSurvey(token, { score: 5, comment: "  Quick and friendly.  " }, ip())).resolves.toEqual({ thanks: true });
    await expect(answerSurvey(token, { score: 1 }, ip())).rejects.toBeInstanceOf(ValidationError);
    expect((await openSurvey(token, ip())).status).toBe("answered");
    const listed = await listSurveys(support);
    expect(listed.summary).toEqual({ sent: 1, answered: 1, averageScore: 5 });
    expect(listed.items[0]).toMatchObject({ status: "ANSWERED", score: 5, comment: "Quick and friendly." });
  });

  it("says nothing about an unknown link, refuses an expired one, and is rate limited per address", async () => {
    const { org, support } = await supportOrg();
    const { company } = await customer(org.id);
    expect(await openSurvey("not-a-real-token", ip())).toEqual({ status: "unknown" });
    await expect(answerSurvey("not-a-real-token", { score: 3 }, ip())).rejects.toBeInstanceOf(ValidationError);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let token = "";
    try {
      await sendSurvey(support, { companyId: company.id });
      token = /\/survey\/([A-Za-z0-9_-]+)/.exec(log.mock.calls.map((c) => String(c[1] ?? c[0])).join("\n"))![1]!;
    } finally {
      log.mockRestore();
    }
    await adminDb.satisfactionSurvey.updateMany({ where: { organizationId: org.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await openSurvey(token, ip())).status).toBe("expired");
    await expect(answerSurvey(token, { score: 3 }, ip())).rejects.toBeInstanceOf(ValidationError);
    expect((await listSurveys(support)).items[0]!.status).toBe("EXPIRED");

    const sameIp = ip();
    for (let i = 0; i < 60; i++) await openSurvey("guess", sameIp);
    await expect(openSurvey("guess", sameIp)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("the role-limited customer view", () => {
  it("shows the customer, contacts, services, tickets and satisfaction, and no deal, value, cost or payment", async () => {
    const { org, support, mgmt } = await supportOrg();
    const { company, contact } = await customer(org.id);
    const stageId = await getPipelineStageId(org.id);
    await adminDb.deal.create({
      data: { organizationId: org.id, companyId: company.id, ownerMembershipId: mgmt.membershipId, pipelineStageId: stageId, value: "987654.32", notes: "margin note: 41% on this one" },
    });
    await adminDb.company.update({ where: { id: company.id }, data: { notes: "commercial notes: discount agreed" } });
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: org.id } });
    await adminDb.companyService.create({ data: { organizationId: org.id, companyId: company.id, serviceId: service.id, startDate: new Date("2026-01-05") } });
    await createTicket(support, { companyId: company.id, contactId: contact.id, title: "Camera offline" });

    const view = await getSupportCustomerView(support, company.id);
    expect(view.company).toMatchObject({ id: company.id, name: company.name, industry: "Retail" });
    expect(view.contacts).toEqual([expect.objectContaining({ name: "Grace Achieng", email: contact.email })]);
    expect(view.services).toEqual([expect.objectContaining({ name: service.name, since: "2026-01-05" })]);
    expect(view.tickets.map((t) => t.title)).toEqual(["Camera offline"]);
    const json = JSON.stringify(view);
    for (const forbidden of ["987654", "margin", "discount", "deal", "payment", "invoice", "cost", "amount"]) {
      expect(json.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    await expect(getSupportCustomerView(support, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
    // Customer Support has no way to the deal or payment data through this role at all
    expect(support.permissionKeys.filter((k) => /deals\.|payments\.|invoice|margin/.test(k))).toEqual([]);
  });
});

describe("keys", () => {
  it("only Management and Customer Support hold tickets.manage, and only from V1.1", async () => {
    const { org, mgmt, support, fresh } = await supportOrg();
    expect(mgmt.permissionKeys).toContain("tickets.manage");
    expect(support.permissionKeys).toContain("tickets.manage");
    for (const role of ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]) {
      expect((await fresh(role, `k.${role}`)).permissionKeys, role).not.toContain("tickets.manage");
    }
    const v1 = await createTestOrganization("KeysV1");
    orgIds.push(v1.id);
    expect((await createTestContext(v1.id, "MANAGEMENT", "k.v1")).permissionKeys).not.toContain("tickets.manage");
    void org;
  });
});

export type { AuthContext };
