import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withIdempotency } from "../src/lib/idempotency";
import { createInvoice, getInvoice } from "../src/services/paymentService";
import { updateInvoiceNumbering } from "../src/services/invoiceSettingsService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createOpenDeal, createWonDeal } from "./helpers/stage3";

/**
 * UC-R8 (FIG-1779): create invoice. DB-backed (RLS, advisory lock). Auto-numbering is safe under concurrency, a typed number is unique ignoring
 * case, the deal must be won, terms are stored, and only roles with the create key may create.
 */
const base = { amount: 1000, issuedOn: "2026-11-01", dueOn: "2026-12-01" };

async function setup() {
  const org = await createTestOrganization("InvoiceCreate");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const finance = await createTestContext(org.id, "FINANCE");
  const sales = await createTestContext(org.id, "SALES");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const deal = await createWonDeal(org.id, sales, { value: 500000 });
  return { org, management, finance, sales, delivery, technical, deal };
}

async function issues(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("create invoice (UC-R8)", () => {
  it("lets Management and Finance create, and refuses Sales, Delivery and Restricted Technical", async () => {
    const w = await setup();
    const input = { ...base, number: "ROLE-1", companyId: w.deal.companyId };
    // Sales (24 Nov 2026): a DRAFT on an own won deal only; never without a deal, sent, on another's deal, or with payment fields.
    await expect(createInvoice(w.sales, input)).rejects.toBeInstanceOf(ValidationError);
    const salesInput = { ...base, number: "ROLE-S1", dealId: w.deal.id };
    const draft = (await createInvoice(w.sales, salesInput)) as Record<string, unknown>;
    expect(draft).toMatchObject({ number: "ROLE-S1", status: "DRAFT", salesDraftOnly: true });
    for (const k of ["paidAmount", "balance", "overdue", "payments"]) expect(draft).not.toHaveProperty(k);
    await expect(createInvoice(w.sales, { ...salesInput, number: "ROLE-S2", sent: true })).rejects.toBeInstanceOf(ValidationError);
    const others = await createWonDeal(w.org.id, w.management, { value: 100 });
    await expect(createInvoice(w.sales, { ...salesInput, number: "ROLE-S3", dealId: others.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvoice(w.delivery, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvoice(w.technical, input)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await createInvoice(w.finance, input)).number).toBe("ROLE-1");
    expect((await createInvoice(w.management, { ...input, number: "ROLE-2" })).number).toBe("ROLE-2");
  });

  it("asks for a number when auto-numbering is off, with the code NUMBER_REQUIRED", async () => {
    const w = await setup();
    expect((await issues(createInvoice(w.finance, { ...base, companyId: w.deal.companyId })))[0]).toMatchObject({ path: "number", code: "NUMBER_REQUIRED" });
  });

  it("numbers automatically from the prefix, one past the highest, ignoring numbers of another shape", async () => {
    const w = await setup();
    await updateInvoiceNumbering(w.management, { auto: true, prefix: "BILL-" });
    await createInvoice(w.finance, { ...base, number: "bill-0009", companyId: w.deal.companyId });
    await createInvoice(w.finance, { ...base, number: "BILL-LEGACY", companyId: w.deal.companyId });
    const a = await createInvoice(w.finance, { ...base, companyId: w.deal.companyId });
    const b = await createInvoice(w.finance, { ...base, number: "  ", companyId: w.deal.companyId });
    expect([a.number, b.number]).toEqual(["BILL-0010", "BILL-0011"]);
  });

  it("still uses a number typed by hand while auto-numbering is on", async () => {
    const w = await setup();
    await updateInvoiceNumbering(w.management, { auto: true, prefix: "INV-" });
    expect((await createInvoice(w.finance, { ...base, number: "CUSTOM-7", companyId: w.deal.companyId })).number).toBe("CUSTOM-7");
  });

  it("gives twelve invoices created at once twelve different numbers with no gaps", async () => {
    const w = await setup();
    await updateInvoiceNumbering(w.management, { auto: true, prefix: "INV-" });
    const made = await Promise.all(Array.from({ length: 12 }, () => createInvoice(w.finance, { ...base, companyId: w.deal.companyId })));
    const numbers = made.map((m) => m.number).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `INV-${String(i + 1).padStart(4, "0")}`).sort());
  });

  it("keeps numbers unique per organisation ignoring case, and lets another organisation reuse one", async () => {
    const w = await setup();
    await createInvoice(w.finance, { ...base, number: "Dup-1", companyId: w.deal.companyId });
    expect((await issues(createInvoice(w.finance, { ...base, number: "DUP-1", companyId: w.deal.companyId })))[0]).toMatchObject({ code: "DUPLICATE_INVOICE_NUMBER" });
    const other = await setup();
    expect((await createInvoice(other.finance, { ...base, number: "DUP-1", companyId: other.deal.companyId })).number).toBe("DUP-1");
  });

  it("keeps the rule that a deal must be won", async () => {
    const w = await setup();
    const open = await createOpenDeal(w.org.id, w.sales);
    expect((await issues(createInvoice(w.finance, { ...base, number: "OPEN-1", dealId: open.id })))[0]).toMatchObject({ code: "DEAL_NOT_WON" });
    expect((await createInvoice(w.finance, { ...base, number: "WON-1", dealId: w.deal.id })).dealId).toBe(w.deal.id);
  });

  it("stores the payment terms and the terms text, and leaves them empty when not given", async () => {
    const w = await setup();
    const made = await createInvoice(w.finance, { ...base, number: "TERMS-1", companyId: w.deal.companyId, paymentTermsDays: 30, terms: "Pay within 30 days by bank transfer." });
    const read = await getInvoice(w.finance, made.id);
    expect(read).toMatchObject({ paymentTermsDays: 30, terms: "Pay within 30 days by bank transfer." });
    const plain = await createInvoice(w.finance, { ...base, number: "TERMS-2", companyId: w.deal.companyId });
    expect(plain).toMatchObject({ paymentTermsDays: null, terms: null });
    expect((await issues(createInvoice(w.finance, { ...base, number: "TERMS-3", companyId: w.deal.companyId, paymentTermsDays: 400 })))[0]).toMatchObject({ path: "paymentTermsDays" });
  });

  it("creates once for one idempotency key, and the replay returns the same invoice", async () => {
    const w = await setup();
    await updateInvoiceNumbering(w.management, { auto: true, prefix: "INV-" });
    const body = { ...base, companyId: w.deal.companyId };
    const req = () => new Request("http://localhost/x", { method: "POST", headers: { "idempotency-key": "invoice-key-0001" } });
    const first = (await withIdempotency(w.finance, req(), body, () => createInvoice(w.finance, body))) as { id: string; number: string };
    // A replay is answered from the stored response, as the route would send it (header Idempotent-Replayed).
    const replay = (await withIdempotency(w.finance, req(), body, () => createInvoice(w.finance, body))) as Response;
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(((await replay.json()) as { id: string }).id).toBe(first.id);
    expect(await adminDb.invoice.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("still requires dueOn", async () => {
    const w = await setup();
    await expect(createInvoice(w.finance, { number: "NODUE", amount: 5, issuedOn: "2026-11-01", companyId: w.deal.companyId } as never)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lets only Management change the numbering setting, and validates the prefix", async () => {
    const w = await setup();
    await expect(updateInvoiceNumbering(w.finance, { auto: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await issues(updateInvoiceNumbering(w.management, { prefix: "bad prefix" })))[0]).toMatchObject({ code: "INVALID_INVOICE_PREFIX" });
    expect(await updateInvoiceNumbering(w.management, { auto: true, prefix: "FB-" })).toEqual({ auto: true, prefix: "FB-" });
    const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId: w.org.id, key: "invoices.settings" } } });
    expect(row?.value).toEqual({ auto: true, prefix: "FB-" });
  });
});
