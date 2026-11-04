import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { createVisionCardExtractor, readCard, setCardExtractorFactory, unavailableExtractor, type CardExtractor } from "../src/capture/cardExtractor";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { withIdempotency } from "../src/lib/idempotency";
import { setStorageDriverForTests } from "../src/storage";
import { LocalDriver } from "../src/storage/localDriver";
import { addAttachment, completeAttachment, listAttachments } from "../src/services/attachmentService";
import { confirmCardCapture, discardCardCapture, extractCard, getCardCapture, startCardCapture } from "../src/services/cardCaptureService";
import { createContact } from "../src/services/contactService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

// Fixture "photos": real file headers (so the file service accepts them) with a different tail for each card. The fake reader
// below "reads" a card from the tail, so no image engine and no network are involved.
const png = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`CARD:${tag}`)]);
const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`CARD:${tag}`)]);

const CARDS: Record<string, string> = {
  achieng: "Lakeview Hotels Ltd\nAchieng Otieno\nMarketing Manager\n+254 722 410 088\nachieng@lakeview.co.ke\nwww.lakeview.co.ke",
  partial: "Kamau and Sons Ltd\nPeter Kamau\nDirector\n0733 1204",
  blank: "",
};

let dir: string;
let driver: LocalDriver;
let readerCalls = 0;
const fakeReader: CardExtractor = {
  id: "fake-ocr",
  async extract({ bytes }) {
    readerCalls += 1;
    const tag = /CARD:(\w+)/.exec(bytes.toString("latin1"))?.[1] ?? "blank";
    return { text: CARDS[tag] ?? "" };
  },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "figbloom-card-"));
  process.env.STORAGE_SIGNING_SECRET = "card-test-secret";
  driver = new LocalDriver({ rootDir: dir, signingSecret: "card-test-secret", baseUrl: "http://localhost:3000" });
  setStorageDriverForTests(driver);
});
afterAll(async () => {
  setCardExtractorFactory(null);
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  readerCalls = 0;
  setCardExtractorFactory(async () => fakeReader);
});

async function setup() {
  const org = await createTestOrganization("Card");
  const sales = await createTestContext(org.id, "SALES", "card.sales");
  return { org, sales };
}

async function capture(ctx: AuthContext, bytes: Buffer, mime = "image/png", name = "card.png") {
  const started = await startCardCapture(ctx, { name, mimeType: mime, sizeBytes: bytes.length });
  const file = await adminDb.file.findUniqueOrThrow({ where: { id: started.capture.fileId } });
  await driver.putObject(file.storageKey, bytes, { contentType: mime });
  return started.capture.id;
}

const counts = (orgId: string) => Promise.all([adminDb.lead.count({ where: { organizationId: orgId } }), adminDb.contact.count({ where: { organizationId: orgId } })]);

describe("reading a card (FIG-1154)", () => {
  it("suggests the fields from the photo and creates nothing", async () => {
    const { org, sales } = await setup();
    const id = await capture(sales, png("achieng"));
    const read = await extractCard(sales, id);
    expect(read.status).toBe("EXTRACTED");
    expect(read.fields).toMatchObject({ name: "Achieng Otieno", company: "Lakeview Hotels Ltd", title: "Marketing Manager", phone: "+254 722 410 088", email: "achieng@lakeview.co.ke", website: "www.lakeview.co.ke" });
    expect(read.unsure).toEqual([]);
    expect(await counts(org.id)).toEqual([0, 0]);
    // Asking again returns the same reading without reading twice.
    expect((await extractCard(sales, id)).fields).toEqual(read.fields);
    expect(readerCalls).toBe(1);
  });

  it("flags what it is unsure of, so the person is asked to check it", async () => {
    const { sales } = await setup();
    const read = await extractCard(sales, await capture(sales, jpeg("partial"), "image/jpeg", "card.jpg"));
    expect(read.fields).toMatchObject({ name: "Peter Kamau", company: "Kamau and Sons Ltd", title: "Director" });
    expect(read.unsure).toEqual(expect.arrayContaining(["email"]));
  });

  it("falls back to typing when the reader finds nothing, fails, or is not configured, and keeps the photo", async () => {
    const { sales } = await setup();
    const blank = await extractCard(sales, await capture(sales, png("blank")));
    expect(blank.note).toMatch(/type the details/i);
    expect(blank.unsure).toEqual(expect.arrayContaining(["name", "phone", "email"]));
    setCardExtractorFactory(async () => ({ id: "broken", extract: async () => Promise.reject(new Error("engine crashed")) }));
    const failed = await extractCard(sales, await capture(sales, png("achieng")));
    expect(failed.status).toBe("EXTRACTED");
    expect(failed.note).toMatch(/could not be read/i);
    setCardExtractorFactory(async () => unavailableExtractor);
    expect((await extractCard(sales, await capture(sales, png("achieng")))).note).toMatch(/not set up/i);
  });

  it("only accepts a photo, and checks the bytes really are one", async () => {
    const { sales } = await setup();
    await expect(startCardCapture(sales, { name: "card.pdf", mimeType: "application/pdf", sizeBytes: 100 })).rejects.toBeInstanceOf(ValidationError);
    await expect(startCardCapture(sales, { name: "card.png", mimeType: "image/png", sizeBytes: 30 * 1024 * 1024 })).rejects.toBeInstanceOf(ValidationError);
    // Text declared as a PNG: refused when the upload is completed, and nothing is read.
    const id = await capture(sales, Buffer.from("not an image at all"), "image/png");
    await expect(extractCard(sales, id)).rejects.toThrow();
    expect(readerCalls).toBe(0);
  });
});

describe("confirming (FIG-1154): extracted fields are always shown for confirmation before saving", () => {
  it("creates nothing without an explicit confirmation, and saves what the person confirmed, not what was read", async () => {
    const { org, sales } = await setup();
    const id = await capture(sales, png("achieng"));
    await extractCard(sales, id);
    const fields = { name: "Achieng Otieno", company: "Lakeview Hotels Ltd", phone: "+254 722 410 088", email: "achieng@lakeview.co.ke" };
    await expect(confirmCardCapture(sales, id, { confirmed: false, fields })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "CARD_NOT_CONFIRMED" })] });
    await expect(confirmCardCapture(sales, id, { fields } as never)).rejects.toBeInstanceOf(ValidationError);
    expect(await counts(org.id)).toEqual([0, 0]);

    // The person corrects the phone number the reader got wrong.
    const out = await confirmCardCapture(sales, id, { confirmed: true, fields: { ...fields, phone: "0722 410 099", title: "Marketing Manager" } });
    expect(out.status).toBe("CREATED");
    if (out.status !== "CREATED") throw new Error("unreachable");
    const lead = await adminDb.lead.findUniqueOrThrow({ where: { id: out.result.lead!.id }, include: { contact: true } });
    expect(lead.contact).toMatchObject({ firstName: "Achieng", lastName: "Otieno", phone: "0722 410 099", email: "achieng@lakeview.co.ke" });
    expect(lead.ownerMembershipId).toBe(sales.membershipId);
    expect(lead.notes).toContain("Marketing Manager");
    expect(lead.notes).toContain("From a business card.");
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "capture.card_confirmed", entityId: lead.id } })).toBe(1);
  });

  it("attaches the card photo to the new lead", async () => {
    const { sales } = await setup();
    const id = await capture(sales, png("achieng"));
    await extractCard(sales, id);
    const out = await confirmCardCapture(sales, id, { confirmed: true, fields: { name: "Achieng Otieno", phone: "+254 722 410 088" } });
    if (out.status !== "CREATED") throw new Error("expected CREATED");
    const files = await listAttachments(sales, "lead", out.result.lead!.id);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ title: "Business card" });
    expect(files[0]!.file.status).toBe("READY");
    expect((await getCardCapture(sales, id)).status).toBe("CONFIRMED");
  });

  it("refuses to confirm a card that has not been read, and validates the fields as if typed", async () => {
    const { org, sales } = await setup();
    const unread = await capture(sales, png("achieng"));
    await expect(confirmCardCapture(sales, unread, { confirmed: true, fields: { name: "A B", phone: "0722000111" } })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "CARD_NOT_EXTRACTED" })] });
    await extractCard(sales, unread);
    await expect(confirmCardCapture(sales, unread, { confirmed: true, fields: { name: " ", phone: "0722000111" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(confirmCardCapture(sales, unread, { confirmed: true, fields: { name: "Name Only" } })).rejects.toBeInstanceOf(ValidationError); // phone or email needed
    await expect(confirmCardCapture(sales, unread, { confirmed: true, fields: { name: "Bad Email", email: "nope" } })).rejects.toBeInstanceOf(ValidationError);
    expect(await counts(org.id)).toEqual([0, 0]);
    // A refused confirmation leaves the card ready to be confirmed properly.
    expect((await confirmCardCapture(sales, unread, { confirmed: true, fields: { name: "Good Name", phone: "0722000111" } })).status).toBe("CREATED");
  });

  it("makes one lead when the confirmation is sent twice, even at once, or with the same Idempotency-Key", async () => {
    const { org, sales } = await setup();
    const id = await capture(sales, png("achieng"));
    await extractCard(sales, id);
    const input = { confirmed: true, fields: { name: "Achieng Otieno", phone: "+254 722 410 088" } };
    const results = await Promise.allSettled([confirmCardCapture(sales, id, input), confirmCardCapture(sales, id, input)]);
    expect(results.filter((r) => r.status === "fulfilled" && (r.value.status === "CREATED"))).toHaveLength(1);
    expect(await counts(org.id)).toEqual([1, 1]);
    expect((await confirmCardCapture(sales, id, input)).status).toBe("ALREADY_CONFIRMED");

    const id2 = await capture(sales, png("partial"));
    await extractCard(sales, id2);
    const body = { confirmed: true, fields: { name: "Peter Kamau", phone: "0733120455" } };
    const req = () => new Request("http://localhost/x", { method: "POST", headers: { "idempotency-key": "card-key-0001" } });
    const first = await withIdempotency(sales, req(), body, () => confirmCardCapture(sales, id2, body));
    await withIdempotency(sales, req(), body, () => confirmCardCapture(sales, id2, body));
    expect((first as { status: string }).status).toBe("CREATED");
    expect(await counts(org.id)).toEqual([2, 2]);
  });
});

describe("duplicates (FIG-1154)", () => {
  async function withExisting() {
    const { org, sales } = await setup();
    const { contact } = await createContact(sales, { firstName: "Achieng", lastName: "Otieno", email: "achieng@lakeview.co.ke" });
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: org.id } })).id, ownerMembershipId: sales.membershipId, contactId: contact.id } });
    const id = await capture(sales, png("achieng"));
    return { org, sales, contact, lead, id };
  }
  const fields = { name: "Achieng Otieno", phone: "+254 722 410 088", email: "achieng@lakeview.co.ke" };

  it("warns at reading time and at confirmation, saving nothing until the person chooses", async () => {
    const { org, sales, contact, lead, id } = await withExisting();
    const read = await extractCard(sales, id);
    expect((read as unknown as { duplicates: { id: string }[] }).duplicates.map((d) => d.id)).toEqual(expect.arrayContaining([contact.id]));
    const warned = await confirmCardCapture(sales, id, { confirmed: true, fields });
    expect(warned.status).toBe("DUPLICATE_WARNING");
    if (warned.status !== "DUPLICATE_WARNING") throw new Error("unreachable");
    expect(warned.options).toEqual(expect.arrayContaining(["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"]));
    expect(warned.duplicates.map((d) => d.id)).toEqual(expect.arrayContaining([lead.id]));
    expect(await counts(org.id)).toEqual([1, 1]);
    expect((await getCardCapture(sales, id)).status).toBe("EXTRACTED");
  });

  it("merges into the existing lead and attaches the photo there", async () => {
    const { org, sales, lead, id } = await withExisting();
    await extractCard(sales, id);
    const out = await confirmCardCapture(sales, id, { confirmed: true, fields, duplicateDecision: "MERGE", duplicateId: lead.id });
    expect(out.status).toBe("MERGED");
    expect(await counts(org.id)).toEqual([1, 1]);
    expect((await listAttachments(sales, "lead", lead.id)).map((a) => a.title)).toEqual(["Business card"]);
    expect((await adminDb.contact.findFirstOrThrow({ where: { organizationId: org.id } })).phone).toBe("+254 722 410 088");
  });

  it("opens the existing record without keeping the photo, or creates anyway when told to", async () => {
    const a = await withExisting();
    await extractCard(a.sales, a.id);
    const opened = await confirmCardCapture(a.sales, a.id, { confirmed: true, fields, duplicateDecision: "OPEN_EXISTING", duplicateId: a.lead.id });
    expect(opened.status).toBe("OPENED_EXISTING");
    expect(await counts(a.org.id)).toEqual([1, 1]);
    expect(await adminDb.attachment.count({ where: { organizationId: a.org.id } })).toBe(0);
    expect((await adminDb.file.findFirstOrThrow({ where: { organizationId: a.org.id } })).status).toBe("DELETED");

    const b = await withExisting();
    await extractCard(b.sales, b.id);
    const created = await confirmCardCapture(b.sales, b.id, { confirmed: true, fields, duplicateDecision: "CREATE_ANYWAY" });
    expect(created.status).toBe("CREATED");
    expect(await counts(b.org.id)).toEqual([2, 2]);
  });
});

describe("who may do it, and isolation (FIG-1154)", () => {
  it("needs the right to create leads and contacts and to attach files", async () => {
    const { org } = await setup();
    const finance = await createTestContext(org.id, "FINANCE", "card.fin");
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "card.tech");
    for (const who of [finance, technical]) {
      await expect(startCardCapture(who, { name: "c.png", mimeType: "image/png", sizeBytes: 100 })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("keeps a capture to the person who took it, and to their organisation", async () => {
    const { org, sales } = await setup();
    const id = await capture(sales, png("achieng"));
    await extractCard(sales, id);
    const colleague = await createTestContext(org.id, "SALES", "card.colleague");
    await expect(getCardCapture(colleague, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(extractCard(colleague, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmCardCapture(colleague, id, { confirmed: true, fields: { name: "X Y", phone: "0722000111" } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(discardCardCapture(colleague, id)).rejects.toBeInstanceOf(NotFoundError);
    const other = await createTestOrganization("CardCross");
    const stranger = await createTestContext(other.id, "SALES", "card.stranger");
    await expect(getCardCapture(stranger, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmCardCapture(stranger, id, { confirmed: true, fields: { name: "X Y", phone: "0722000111" } })).rejects.toBeInstanceOf(NotFoundError);
    expect(await counts(org.id)).toEqual([0, 0]);
  });

  it("removes the photo when the card is discarded, and cannot then be confirmed", async () => {
    const { sales } = await setup();
    const id = await capture(sales, png("achieng"));
    await extractCard(sales, id);
    expect((await discardCardCapture(sales, id)).status).toBe("DISCARDED");
    expect((await adminDb.file.findFirstOrThrow({ where: { id: (await adminDb.cardCapture.findUniqueOrThrow({ where: { id } })).fileId } })).status).toBe("DELETED");
    await expect(confirmCardCapture(sales, id, { confirmed: true, fields: { name: "X Y", phone: "0722000111" } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("hides one organisation's captures from another, as the application role", async () => {
    const { org, sales } = await setup();
    await capture(sales, png("achieng"));
    const other = await createTestOrganization("CardRls");
    expect(await getUnscopedAppClientForTests().cardCapture.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
    await withOrgContext(other.id, async (tx) => expect(await tx.cardCapture.findMany({ where: { organizationId: org.id } })).toHaveLength(0));
    await withOrgContext(org.id, async (tx) => expect(await tx.cardCapture.count({ where: { organizationId: org.id } })).toBe(1));
  });
});

describe("camera attachments (FIG-1154)", () => {
  it("attaches a phone photo to a lead through the same upload pipeline: type, size and content are checked", async () => {
    const { org, sales } = await setup();
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: org.id } })).id, ownerMembershipId: sales.membershipId } });
    const bytes = jpeg("site");
    const { attachment } = await addAttachment(sales, "lead", lead.id, { name: "site.jpg", mimeType: "image/jpeg", sizeBytes: bytes.length, title: "Site photo" });
    await driver.putObject(attachment.file.storageKey, bytes, { contentType: "image/jpeg" });
    expect((await completeAttachment(sales, attachment.id)).file.status).toBe("READY");
    expect((await listAttachments(sales, "lead", lead.id)).map((a) => a.title)).toEqual(["Site photo"]);
    // A photo format the pipeline does not accept is refused up front (the phone converts HEIC to JPEG).
    await expect(addAttachment(sales, "lead", lead.id, { name: "site.heic", mimeType: "image/heic", sizeBytes: 100 })).rejects.toBeInstanceOf(ValidationError);
    // A "photo" that is not one is refused when completed.
    const fake = await addAttachment(sales, "lead", lead.id, { name: "fake.jpg", mimeType: "image/jpeg", sizeBytes: 12 });
    await driver.putObject(fake.attachment.file.storageKey, Buffer.from("hello, world"), { contentType: "image/jpeg" });
    await expect(completeAttachment(sales, fake.attachment.id)).rejects.toThrow();
  });
});

describe("reading card text (fixtures)", () => {
  it("finds each field, takes the extractor's own fields over the heuristics, and lists missing ones as unsure", () => {
    const full = readCard({ text: CARDS.achieng! });
    expect(full.unsure).toEqual([]);
    const own = readCard({ text: CARDS.achieng!, fields: { name: "A. Otieno", phone: "+254700000000" } });
    expect(own.fields).toMatchObject({ name: "A. Otieno", phone: "+254700000000", email: "achieng@lakeview.co.ke" });
    const none = readCard({ text: "" });
    expect(none.unsure).toEqual(["name", "phone", "email"]);
    const twoNumbers = readCard({ text: "Jane Doe\nSales Director\n+254 711 111 111\n+254 722 222 222\njane@x.co.ke" });
    expect(twoNumbers.fields.phone).toBe("+254 711 111 111");
    expect(twoNumbers.unsure).toContain("phone");
  });

  it("reads a card through a vision model client, and ignores a reply that is not JSON", async () => {
    const reply = (text: string) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });
    const ok = await createVisionCardExtractor(reply('{"text":"Jane Doe","name":"Jane Doe","email":"jane@x.co.ke","phone":"","company":"","title":"","website":""}'), "m").extract({ bytes: png("x"), mimeType: "image/png" });
    expect(ok.fields).toMatchObject({ name: "Jane Doe", email: "jane@x.co.ke" });
    expect((await createVisionCardExtractor(reply("I cannot read this."), "m").extract({ bytes: png("x"), mimeType: "image/png" })).text).toBe("");
  });
});
