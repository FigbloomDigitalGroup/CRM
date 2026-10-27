"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { contactName, contactOf, leadName, useFormatters, useReference, type LeadDetail } from "./data";
import { Icon } from "./icons";
import { ModalShell } from "./overlay";

interface DuplicateHit {
  entityType: string;
  id: string;
  label: string;
  confidence: string;
  reasons: { type: string; detail: string }[];
}

/**
 * Convert to a deal (L3): shows what comes along (company, contact, timeline), asks only for what is missing, and warns about duplicates
 * without ever blocking. The deal starts in the first pipeline stage; the lead page and its history stay.
 */
export function ConvertDialog({ leadId, onClose, onDone }: { leadId: string; onClose: () => void; onDone: () => void }) {
  const { orgSlug, can } = useMember();
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const ref = useReference();
  const fmt = useFormatters();
  const leadQ = useApiQuery("getLeadsByLeadId", { params: { orgSlug, leadId } });
  const lead = leadQ.data as (LeadDetail & { company?: { id: string; name: string } | null }) | undefined;
  const timelineQ = useApiQuery("getActivities", { params: { orgSlug }, query: { leadId, pageSize: "1" } as never });
  const timelineCount = (timelineQ.data as { total?: number } | undefined)?.total ?? 0;

  const [companyName, setCompanyName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [value, setValue] = useState("");
  const [close, setClose] = useState(() => fmt.isoDate(new Date(Date.now() + 30 * 864e5)));
  const [duplicates, setDuplicates] = useState<DuplicateHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = lead?.company ?? null;
  const contact = lead ? contactOf(lead) : null;
  const name = lead ? leadName(lead) : "this lead";

  useEffect(() => {
    if (!lead) return;
    setCompanyName((c) => c || lead.company?.name || "");
    setServiceId((s) => s || ((lead.serviceInterestId as string | null) ?? ""));
  }, [lead]);

  // The duplicate check is a courtesy: whatever it finds, the conversion can go ahead.
  useEffect(() => {
    if (!lead) return;
    let alive = true;
    api
      .call("postLeadsCheckDuplicates", {
        params: { orgSlug },
        body: { companyId: lead.companyId || undefined, contactEmail: contact?.email || undefined, contactPhone: contact?.phone || undefined },
        idempotencyKey: newIdempotencyKey(),
      })
      .then((r) => {
        if (alive) setDuplicates(((r.duplicates ?? []) as DuplicateHit[]).filter((d) => d.id !== lead.id));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lead?.id]);

  async function convert() {
    if (!lead) return;
    setBusy(true);
    setError(null);
    try {
      const deal = await api.call("postLeadsByLeadIdConvert", {
        params: { orgSlug, leadId },
        idempotencyKey: newIdempotencyKey(),
        body: {
          ...(company ? { companyId: company.id } : { newCompany: { name: companyName.trim() } }),
          ...(serviceId ? { serviceId } : {}),
          ...(value.trim() ? { value: value.trim() } : {}),
          ...(close ? { expectedCloseDate: close } : {}),
        },
      });
      toast.show({ message: `${name} converted to a deal`, undo: undefined });
      onDone();
      if (can("deals.view.all") || can("deals.view.own")) router.push(`/o/${orgSlug}/deals/${(deal as { id: string }).id}`);
    } catch (err) {
      const d = describeError(err);
      setError(d.fieldErrors.length ? d.fieldErrors.map((f) => f.message).join(" ") : d.body);
    } finally {
      setBusy(false);
    }
  }

  const needsCompany = !company;
  const invalid = needsCompany && !companyName.trim();
  return (
    <ModalShell
      title={`Convert ${name} to a deal`}
      intro={
        <>
          The deal starts in <strong>{ref.loaded ? "Solution Presented" : "the first stage"}</strong>. {timelineCount} timeline item{timelineCount === 1 ? "" : "s"} and open tasks come with it.
        </>
      }
      onClose={onClose}
      label="Convert to deal"
      footer={
        <>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={busy || invalid || !lead} onClick={convert}>
            <Icon name="arrow-circle" size={16} />
            Convert to deal
          </button>
        </>
      }
    >
      <div className="fb-ld-tiles">
        <div className="fb-ld-tile">
          <div className="fb-ld-eyebrow">COMPANY</div>
          <div className="fb-ld-tile__name">{company?.name ?? (companyName || name)}</div>
          <div className="fb-ld-tile__note" style={{ color: company ? "var(--primary-text)" : "var(--orange-text)" }}>
            {company ? "Existing company found · linked" : "No match found · will be created"}
          </div>
        </div>
        <div className="fb-ld-tile">
          <div className="fb-ld-eyebrow">CONTACT</div>
          <div className="fb-ld-tile__name">{contact ? contactName(contact) : "No contact yet"}</div>
          <div className="fb-ld-tile__note" style={{ color: "var(--text-3)" }}>
            {contact ? "Existing contact · becomes primary contact" : "Add one later from the deal"}
          </div>
        </div>
      </div>

      {duplicates.length ? (
        <div role="status" className="fb-ld-dup">
          <Icon name="alert" size={17} />
          <div>
            <strong>Heads-up:</strong> this looks like it already exists. You can still convert.
            <ul>
              {duplicates.slice(0, 3).map((d) => (
                <li key={d.entityType + d.id}>
                  {d.label} <span style={{ opacity: 0.8 }}>({d.entityType}, {d.confidence} match)</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {needsCompany ? (
        <label className="fb-ld-field">
          <span>Company name (created on convert)</span>
          <input className="fb-ld-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>
      ) : null}
      <label className="fb-ld-field">
        <span>Service</span>
        <select className="fb-ld-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Not decided yet</option>
          {ref.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="fb-ld-twocol">
        {/* The person converting owns the new deal, and an owner always sees its value (docs/MASKING.md), so the field is always theirs to fill. */}
        <label className="fb-ld-field">
          <span>Value (KES)</span>
          <input className="fb-ld-input" type="number" min="0" inputMode="decimal" placeholder="Can be added later" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="fb-ld-field">
          <span>Expected close</span>
          <input className="fb-ld-input" type="date" value={close} onChange={(e) => setClose(e.target.value)} />
        </label>
      </div>
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </ModalShell>
  );
}
