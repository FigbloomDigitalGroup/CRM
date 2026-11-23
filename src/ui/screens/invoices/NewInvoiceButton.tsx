"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "../../components/basics";
import { useMember } from "../../data/member";
import { NewInvoiceDialog } from "./NewInvoiceDialog";

/**
 * The "New invoice" button of the Invoices page (UC-R8). Shown only to roles that hold `invoices.create`; the quick create entry in the navigation
 * opens the page with `?new=1`, which opens the dialog straight away. A created invoice opens in the page's drawer.
 */
export function NewInvoiceButton() {
  const { orgSlug, can } = useMember();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(params?.get("new") === "1");
  if (!can("invoices.create")) return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>New invoice</Button>
      {open ? <NewInvoiceDialog onClose={() => setOpen(false)} onCreated={(id) => router.push(`/o/${orgSlug}/invoices?invoice=${id}`)} /> : null}
    </>
  );
}
