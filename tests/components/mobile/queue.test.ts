import { describe, expect, it, vi } from "vitest";
import { OfflineQueue, type KeyValueStore, type SendBatch } from "../../../src/ui/screens/mobile/queue";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function makeQueue(store = memoryStore()) {
  const counts: number[] = [];
  const q = new OfflineQueue("k", store, (n) => counts.push(n));
  return { q, store, counts };
}

describe("OfflineQueue (F4.12)", () => {
  it("keeps entries on the device and reloads them", () => {
    const { q, store } = makeQueue();
    q.add({ kind: "NOTE_ADD", payload: { leadId: "l1", text: "hi" }, label: "Note" });
    const again = new OfflineQueue("k", store);
    expect(again.list()).toHaveLength(1);
    expect(again.waiting()).toBe(1);
  });

  it("treats the same client id twice (a double tap) as one entry", () => {
    const { q } = makeQueue();
    q.add({ kind: "NOTE_ADD", payload: {}, label: "Note", clientId: "m-same-id-1" });
    q.add({ kind: "NOTE_ADD", payload: {}, label: "Note", clientId: "m-same-id-1" });
    expect(q.list()).toHaveLength(1);
  });

  it("removes an entry only when the server says it is applied or a duplicate", async () => {
    const { q } = makeQueue();
    const a = q.add({ kind: "CALL_LOG", payload: {}, label: "Call", clientId: "m-aaaaaaaa" });
    const b = q.add({ kind: "NOTE_ADD", payload: {}, label: "Note", clientId: "m-bbbbbbbb" });
    const send: SendBatch = async () => ({ results: [{ clientId: a.clientId, status: "DUPLICATE" }, { clientId: b.clientId, status: "APPLIED" }] });
    const out = await q.flush(send);
    expect(out).toMatchObject({ applied: 2, attention: 0, offline: false });
    expect(q.list()).toHaveLength(0);
  });

  it("a dropped connection changes nothing and the retry sends the same client ids (no duplicates)", async () => {
    const { q } = makeQueue();
    q.add({ kind: "QUICK_CAPTURE", payload: { name: "Chebet" }, label: "Capture", clientId: "m-capture-1" });
    const seen: string[] = [];
    const failing: SendBatch = async (m) => {
      seen.push(...m.map((x) => x.clientId));
      throw new Error("network");
    };
    const first = await q.flush(failing);
    expect(first.offline).toBe(true);
    expect(q.waiting()).toBe(1);
    const ok: SendBatch = async (m) => {
      seen.push(...m.map((x) => x.clientId));
      return { results: m.map((x) => ({ clientId: x.clientId, status: "APPLIED" as const })) };
    };
    await q.flush(ok);
    expect(seen).toEqual(["m-capture-1", "m-capture-1"]);
    expect(q.list()).toHaveLength(0);
  });

  it("keeps a conflict with the server's reason, never resends it on its own, and never loses it", async () => {
    const { q } = makeQueue();
    const item = q.add({ kind: "QUICK_CAPTURE", payload: { name: "Chebet" }, label: "Capture", clientId: "m-capture-2" });
    const send = vi.fn<SendBatch>(async () => ({
      results: [{ clientId: item.clientId, status: "CONFLICT", reason: { message: "Someone like this is already in the CRM." }, serverState: { duplicates: [{ id: "x" }] } }],
    }));
    await q.flush(send);
    expect(q.list()[0]).toMatchObject({ state: "CONFLICT", message: "Someone like this is already in the CRM." });
    await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    // The person decides: amend with their choice and it goes back in line.
    q.amend(item.clientId, { name: "Chebet", duplicateDecision: "CREATE_ANYWAY" });
    expect(q.list()[0]).toMatchObject({ state: "WAITING", payload: { duplicateDecision: "CREATE_ANYWAY" } });
  });

  it("sends in the order the person made things", async () => {
    const { q } = makeQueue();
    q.add({ kind: "QUICK_CAPTURE", payload: {}, label: "1", clientId: "m-order-1", at: new Date("2026-10-28T08:00:00Z") });
    q.add({ kind: "CALL_LOG", payload: {}, label: "2", clientId: "m-order-2", at: new Date("2026-10-28T08:05:00Z") });
    let order: string[] = [];
    await q.flush(async (m) => {
      order = m.map((x) => x.clientId);
      return { results: m.map((x) => ({ clientId: x.clientId, status: "APPLIED" as const })) };
    });
    expect(order).toEqual(["m-order-1", "m-order-2"]);
  });

  it("runs one flush at a time", async () => {
    const { q } = makeQueue();
    q.add({ kind: "NOTE_ADD", payload: {}, label: "n", clientId: "m-single-1" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn<SendBatch>(async (m) => {
      await gate;
      return { results: m.map((x) => ({ clientId: x.clientId, status: "APPLIED" as const })) };
    });
    const first = q.flush(send);
    const second = await q.flush(send);
    expect(second.sent).toBe(0);
    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports the waiting count to the connectivity service", () => {
    const { q, counts } = makeQueue();
    q.add({ kind: "NOTE_ADD", payload: {}, label: "n" });
    q.add({ kind: "NOTE_ADD", payload: {}, label: "n" });
    expect(counts.at(-1)).toBe(2);
  });
});
