"use client";

import { Building2, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Dialog, LoadingState, useMember } from "@/ui";
import { useRefData } from "../deals/data";
import { NewDealDrawer } from "../deals/NewDealDrawer";
import { kes, useCompanyOpenDeals, useCustomerSearch } from "./api";
import type { CustomerDealRow } from "./api";

const firstLine = (text: string | null | undefined) => (text ?? "").split(/\r?\n/)[0]!.trim();

/**
 * New quote (design QI2, UC-R4, FIG-1777): who is it for, which deal, then the existing builder. A quote keeps its deal, so choosing a customer is
 * only a shortcut to the right deal: no deal means a new one is made first (the same New deal drawer, with the customer already chosen).
 * The builder's "Start a quote" then creates the quote on that deal (an idempotent create).
 */
export function NewQuoteDialog({ onClose }: { onClose: () => void }) {
  const { orgSlug, can } = useMember();
  const router = useRouter();
  const [step, setStep] = useState<0 | 1>(0);
  const [text, setText] = useState("");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const customers = useCustomerSearch(orgSlug, text.trim(), step === 0);
  const deals = useCompanyOpenDeals(orgSlug, step === 1 && company ? company.id : null);
  const ref = useRefData();
  const open = (id: string) => {
    onClose();
    router.push(`/o/${orgSlug}/quotes/${id}`);
  };

  if (creating && company) {
    return <NewDealDrawer ref_={ref.data} defaultCompany={company} onClose={() => setCreating(false)} onCreated={open} />;
  }

  const list = customers.data?.items ?? [];
  const dealList = deals.data?.items ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={step === 0 ? "Who is this quote for?" : "Which deal is it for?"}
      actions={
        <>
          <Button onClick={() => (step === 0 ? onClose() : (setStep(0), setDealId(null)))}>{step === 0 ? "Cancel" : "Back"}</Button>
          {step === 1 ? (
            <Button variant="primary" disabled={!dealId} disabledReason={!dealId ? "Choose a deal first." : undefined} onClick={() => dealId && open(dealId)}>
              Continue to the quote builder
            </Button>
          ) : null}
        </>
      }
    >
      <ol className="fb-com-steps" aria-label="Steps">
        {["Customer", "Deal", "Builder"].map((l, i) => (
          <li key={l} aria-current={i === step ? "step" : undefined} className={i === step ? "is-now" : i < step ? "is-done" : ""}>{i < step ? "✓ " : `${i + 1} `}{l}</li>
        ))}
      </ol>
      {step === 0 ? (
        <div className="fb-com-picker">
          <input type="search" className="fb-input" aria-label="Search customers" placeholder="Search customers" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          {customers.isLoading ? <LoadingState label="Loading customers" /> : null}
          {customers.error ? <p role="alert" className="fb-com-bad">Customers could not be loaded. Try again in a moment.</p> : null}
          {!customers.isLoading && !customers.error && list.length === 0 ? <p className="fb-com-empty">{text ? "No customer matches." : "No customers yet. Add one under Customers first."}</p> : null}
          <ul className="fb-com-picklist">
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="fb-com-pick" onClick={() => (setCompany(c), setStep(1), setDealId(null))}>
                  <Building2 size={16} aria-hidden="true" />
                  <span className="fb-com-strong">{c.name}</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="fb-com-picker">
          <p className="fb-com-muted">{company?.name}</p>
          {deals.isLoading ? <LoadingState label="Loading deals" /> : null}
          {deals.error ? <p role="alert" className="fb-com-bad">Deals could not be loaded. Try again in a moment.</p> : null}
          {!deals.isLoading && !deals.error && dealList.length === 0 ? <p className="fb-com-empty">This customer has no open deal you can quote on.</p> : null}
          <ul className="fb-com-picklist" role="radiogroup" aria-label="Deals">
            {dealList.map((d) => (
              <li key={d.id}>
                <button type="button" role="radio" aria-checked={dealId === d.id} className={`fb-com-pick${dealId === d.id ? " is-on" : ""}`} onClick={() => setDealId(d.id)}>
                  <span>
                    <span className="fb-com-strong">{dealTitle(d)}</span>
                    <span className="fb-com-muted"> {dealMeta(d)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {can("deals.create") ? (
            <button type="button" className="fb-com-linkbtn" onClick={() => setCreating(true)}>
              + Create a new deal for this customer
            </button>
          ) : (
            <p className="fb-com-muted">Your role cannot create deals. Ask the deal's owner or Management to create one.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

const dealTitle = (d: CustomerDealRow) => firstLine(d.notes) || d.service?.name || "Deal";
/** The stage, and the value only when the API did not mask it (rule 7). */
const dealMeta = (d: CustomerDealRow) =>
  [d.pipelineStage?.name, d.valueMasked || d.value === null || d.value === undefined ? null : kes(Number(d.value), d.currency)].filter(Boolean).join(" · ");
