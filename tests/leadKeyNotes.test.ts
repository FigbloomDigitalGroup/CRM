import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { createActivity } from "../src/services/activityService";
import { createLead } from "../src/services/leadService";
import { listLeadKeyNotes } from "../src/services/leadKeyNoteService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

/**
 * FIG-1678 (P2-24): the batched read behind the key notes in the lead preview. It reads the same NOTE activities the Conversation uses.
 */

async function setup() {
  const org = await createTestOrganization("KeyNotes");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "kn.m");
  const sales = await createTestContext(org.id, "SALES", "kn.s");
  const other = await createTestContext(org.id, "SALES", "kn.o");
  await adminDb.user.update({ where: { id: sales.userId }, data: { name: "Amina Sales" } });
  const statusId = await getLeadStatusId(org.id);
  const { lead } = await createLead(sales, { leadStatusId: statusId });
  const { lead: second } = await createLead(sales, { leadStatusId: statusId });
  return { org, mgmt, sales, other, lead, second };
}

const note = (ctx: Awaited<ReturnType<typeof setup>>["sales"], leadId: string, text: string, at?: string) =>
  createActivity(ctx, { type: "NOTE", subject: "Note", description: text, leadId, occurredAt: at ? new Date(at) : undefined });

describe("listLeadKeyNotes", () => {
  it("returns the latest three notes per lead, newest first, with author, in one call for many leads", async () => {
    const { sales, lead, second } = await setup();
    for (let i = 1; i <= 4; i++) await note(sales, lead.id, `note ${i}`, `2026-11-0${i}T10:00:00Z`);
    await note(sales, second.id, "only one");
    await createActivity(sales, { type: "CALL", subject: "Call", description: "not a note", leadId: lead.id });

    const out = await listLeadKeyNotes(sales, [lead.id, second.id]);
    expect(out.canAdd).toBe(true);
    expect(out.leads[lead.id]!.total).toBe(4);
    expect(out.leads[lead.id]!.notes.map((n) => n.text)).toEqual(["note 4", "note 3", "note 2"]);
    expect(out.leads[lead.id]!.notes[0]!.authorName).toBe("Amina Sales");
    expect(out.leads[second.id]!.notes.map((n) => n.text)).toEqual(["only one"]);
  });

  it("a note added through the Conversation's service shows up (one store)", async () => {
    const { sales, lead } = await setup();
    expect((await listLeadKeyNotes(sales, [lead.id])).leads[lead.id]).toEqual({ total: 0, notes: [] });
    await note(sales, lead.id, "Wants a quote by Friday");
    expect((await listLeadKeyNotes(sales, [lead.id])).leads[lead.id]!.notes[0]!.text).toBe("Wants a quote by Friday");
  });

  it("leaves out leads the caller cannot see (a colleague's lead) and answers for the ones they can", async () => {
    const { sales, other, lead, mgmt } = await setup();
    await note(sales, lead.id, "private to the owner");
    expect((await listLeadKeyNotes(other, [lead.id])).leads).toEqual({});
    expect(Object.keys((await listLeadKeyNotes(mgmt, [lead.id])).leads)).toEqual([lead.id]);
  });

  it("hides a deal value typed into a note from a viewer without deals.view.value (rule 7)", async () => {
    const { sales, lead, mgmt } = await setup();
    await note(sales, lead.id, "They can pay KES 450,000 upfront");
    const masked = { ...mgmt, permissionKeys: mgmt.permissionKeys.filter((k) => k !== "deals.view.value") };
    const hidden = (await listLeadKeyNotes(masked, [lead.id])).leads[lead.id]!.notes[0]!.text;
    expect(hidden).not.toContain("450,000");
    expect((await listLeadKeyNotes(mgmt, [lead.id])).leads[lead.id]!.notes[0]!.text).toContain("450,000");
  });

  it("canAdd follows activities.create; without activities.view the read is refused with the explained no-access", async () => {
    const { sales, lead } = await setup();
    const readOnly = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => k !== "activities.create") };
    expect((await listLeadKeyNotes(readOnly, [lead.id])).canAdd).toBe(false);
    const none = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => k !== "activities.view") };
    await expect(listLeadKeyNotes(none, [lead.id])).rejects.toThrow(ForbiddenError);
  });

  it("never reads another organisation's lead or notes (cross-organisation)", async () => {
    const a = await setup();
    const b = await setup();
    await note(b.sales, b.lead.id, "org B secret");
    const out = await listLeadKeyNotes(a.mgmt, [b.lead.id, a.lead.id]);
    expect(Object.keys(out.leads)).toEqual([a.lead.id]);
    expect(JSON.stringify(out)).not.toContain("org B secret");
  });

  it("caps the batch size", async () => {
    const { sales } = await setup();
    await expect(listLeadKeyNotes(sales, Array.from({ length: 51 }, (_, i) => `id-${i}`))).rejects.toThrow(ValidationError);
  });
});

describe("the team alert for a note", () => {
  it("adding a note tells the other Management members once, and not the author; the text is not in the alert", async () => {
    const { org, mgmt, sales, lead } = await setup();
    await note(sales, lead.id, "Secret number KES 900,000");
    const notes = await adminDb.teamActivityPending.findMany({ where: { organizationId: org.id, recipientMembershipId: mgmt.membershipId, eventKey: "NOTE_ADDED" } });
    const instant = await adminDb.notification.findMany({ where: { organizationId: org.id, membershipId: mgmt.membershipId, type: "TEAM_ACTIVITY" } });
    expect(notes.length + instant.length).toBe(1);
    expect(JSON.stringify([notes, instant])).not.toContain("900,000");
    expect(await adminDb.teamActivityPending.count({ where: { organizationId: org.id, recipientMembershipId: sales.membershipId } })).toBe(0);
  });
});
