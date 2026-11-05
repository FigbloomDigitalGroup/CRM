import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { EXCLUDED_TABLES, EXPORTED_TABLES, EXPORT_TABLE_FILTERS } from "../src/services/organisationExportTables";

/**
 * The organisation export is an allow-list: every table with an organization_id column must be classified as exported or
 * excluded (with a reason), so a table added later is never handed to the organisation by default.
 */
describe("organisation export table classification", () => {
  it("puts every organisation-owned table in exactly one of EXPORTED or EXCLUDED", async () => {
    const rows = await adminDb.$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND c.table_name NOT LIKE '\\_prisma%'`;
    const tables = rows.map((r) => r.table_name);
    const exported = new Set(EXPORTED_TABLES);
    const excluded = new Set(Object.keys(EXCLUDED_TABLES));
    const unclassified = tables.filter((t) => !exported.has(t) && !excluded.has(t));
    expect(unclassified, "add each new table to EXPORTED_TABLES or EXCLUDED_TABLES (with a reason) in src/services/organisationExportTables.ts").toEqual([]);
    expect(tables.filter((t) => exported.has(t) && excluded.has(t))).toEqual([]);
    expect(EXPORTED_TABLES.length).toBe(exported.size);
    // no stale names either
    expect([...exported, ...excluded].filter((t) => !tables.includes(t))).toEqual([]);
    for (const [table, reason] of Object.entries(EXCLUDED_TABLES)) expect(reason.length, table).toBeGreaterThan(5);
  });

  it("leaves out the private material by name, and filters chat to public channels", () => {
    for (const t of ["sessions", "oauth_connections", "oauth_states", "mail_drafts", "assistant_requests", "card_captures", "push_subscriptions", "chat_read_markers"]) {
      expect(EXCLUDED_TABLES, t).toHaveProperty(t);
      expect(EXPORTED_TABLES).not.toContain(t);
    }
    for (const t of ["chat_channels", "chat_channel_members", "chat_messages", "chat_message_mentions", "chat_message_attachments", "chat_reactions"]) {
      expect(EXPORT_TABLE_FILTERS[t], t).toMatch(/PUBLIC/);
    }
  });
});
