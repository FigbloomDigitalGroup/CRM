import { adminDb } from "../src/db/adminClient";

/**
 * Demo channels for the dev organisations (FIG-1382, B6.24): the same channels the Chat demo screens show
 * (`src/ui/screens/communication/demo/data.ts`), so the real API starts with something to read.
 *
 * Only ever called from `runDevSeed`, which refuses to run in production. Written with the schema-owner client straight into the
 * tables (no notifications, no jobs). Safe to repeat: it does nothing when the organisation already has a channel.
 */

interface Seeded {
  name: string;
  kind: "PUBLIC" | "PRIVATE";
  description: string;
  /** Dev user ids; the first is the owner. Everyone in the organisation when absent. */
  members?: string[];
  messages: [author: string, body: string][];
}

const CHANNELS: Seeded[] = [
  {
    name: "general",
    kind: "PUBLIC",
    description: "Company-wide announcements and chatter",
    messages: [
      ["mg", "Morning team. Quarter-end is Friday, please log your calls today."],
      ["s1", "Done on my side. Two tickets closed overnight."],
    ],
  },
  { name: "field-ops", kind: "PUBLIC", description: "Installs, site visits and equipment", messages: [["tc", "Router stock is low at the Nakuru store. Ordering six more."], ["dl", "Approved. Add the invoice to finance-desk when it arrives."]] },
  { name: "sales-team", kind: "PUBLIC", description: "Pipeline, wins and handovers", members: ["mg", "s1", "s2"], messages: [["s1", "Lakeside Hotel wants a revised proposal by Monday."], ["mg", "I will review the numbers tonight."]] },
  { name: "finance-desk", kind: "PRIVATE", description: "Invoices, receipts and follow-ups", members: ["fn", "mg"], messages: [["fn", "Deposit for Kisumu Greens is expected today. I will confirm once it clears."]] },
  { name: "leadership", kind: "PRIVATE", description: "Management only", members: ["mg"], messages: [["mg", "Hiring plan for December is in the shared folder."]] },
];

export async function seedDemoChat(organizationId: string, members: Map<string, string>, now = new Date()): Promise<void> {
  if ((await adminDb.chatChannel.count({ where: { organizationId } })) > 0) return;
  const everyone = [...members.keys()];
  let offset = CHANNELS.reduce((n, c) => n + c.messages.length, 0) + 5;
  for (const spec of CHANNELS) {
    const people = (spec.members ?? everyone).filter((id) => members.has(id));
    if (people.length === 0) continue;
    const owner = members.get(people[0]!)!;
    const channel = await adminDb.chatChannel.create({ data: { organizationId, kind: spec.kind, name: spec.name, description: spec.description, createdByMembershipId: owner } });
    await adminDb.chatChannelMember.createMany({ data: people.map((id, i) => ({ organizationId, channelId: channel.id, membershipId: members.get(id)!, role: i === 0 ? "OWNER" : "MEMBER", addedByMembershipId: owner })) });
    let seq = 0;
    for (const [author, body] of spec.messages) {
      const authorId = members.get(author) ?? owner;
      seq += 1;
      offset -= 1;
      await adminDb.chatMessage.create({ data: { organizationId, channelId: channel.id, seq, authorMembershipId: authorId, body, createdAt: new Date(now.getTime() - offset * 3_600_000) } });
    }
    await adminDb.chatChannel.update({ where: { id: channel.id }, data: { lastSeq: seq, lastMessageAt: new Date(now.getTime() - offset * 3_600_000) } });
  }
}
