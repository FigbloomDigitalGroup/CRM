"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Operations } from "@/api-client";

export type InvoiceRow = Operations["listInvoices"]["response"]["items"][number];
export type InvoiceDetail = Operations["getInvoice"]["response"];
export type PaymentSummary = Operations["getPaymentSummary"]["response"];
export type InvoiceTotals = Operations["listInvoices"]["response"]["totals"];

/** One won deal in the tracker, with the fields the contract leaves loose written out (src/services/paymentService.ts is the source). */
export interface DealPaymentRow {
  dealId: string;
  state: "NOT_INVOICED" | "AWAITING_PAYMENT" | "OVERDUE" | "PAID_IN_FULL";
  companyId: string;
  companyName: string;
  serviceName: string | null;
  dealValue: string | null;
  currency: string;
  wonAt: string | null;
  invoiced: string;
  received: string;
  outstanding: string;
  invoiceCount: number;
  overdueInvoices: number;
  nextNote: { note: string; ownerMembershipId: string | null; nextOn: string | null } | null;
}

export interface PaymentRecord {
  id: string;
  amount: string;
  paidOn: string;
  methodLabel: string | null;
  reference: string | null;
  reversed: boolean;
  reversedAt: string | null;
  reversalReason: string | null;
}

/** Reads that a payment change makes stale, including Customer 360 (marking paid in full must show there at once). */
const STALE = new Set([
  "listInvoices",
  "getInvoice",
  "listWonDealPayments",
  "getPaymentSummary",
  "getCustomer360",
  "getCompaniesByCompanyId",
  "getCompanyLifecycle",
  "getDealPaymentNote",
  "listAuditLog",
]);

export function useRefreshPayments() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && STALE.has(q.queryKey[0]) });
  }, [qc]);
}
