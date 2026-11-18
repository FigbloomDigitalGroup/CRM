"use client";

import Link from "next/link";
import { useState } from "react";
import { describeError } from "../../errors";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { useReference } from "../leads/data";
import { ModalShell } from "../leads/overlay";
import type { CompanyRow } from "./data";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Most companies one action will turn into leads (each is one save, so a very long run is better split). */
export const MAX_COMPANIES_TO_LEADS = 100;

interface Outcome {
  company: string;
  state: "created" | "skipped" | "failed";
  note?: string;
}

/**
 * Turns the companies picked in the list into leads (Sales request, 18 Nov 2026: a list of schools was imported as companies and was meant to be leads).
 * Each company becomes one lead linked to it. A company with no contact yet gets one from its own email and phone, so the lead has someone to call.
 * A company that already has a lead is skipped, so running it twice never doubles anything. It uses the ordinary lead save, so the permission, the
 * owner (the person running it) and the audit trail are the ones a lead created by hand has.
 */
export function CompaniesToLeadsDialog({ companies, onClose, onDone }: { companies: CompanyRow[]; onClose: () => void; onDone: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const ref = useReference();
  const [statusId, setStatusId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [temp, setTemp] = useState<"HOT" | "WARM" | "COLD">("WARM");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Outcome[] | null>(null);

  const status = statusId || ref.statusByKey("NEW")?.id || ref.statuses[0]?.id || "";

  async function run() {
    if (!status) return;
    setRunning(true);
    setDone(0);
    const out: Outcome[] = [];
    for (const c of companies) {
      try {
        // A company that already has a lead is left alone.
        const existing = await api.call("listLeads", { params: { orgSlug }, query: { q: c.name, pageSize: 50 } } as never);
        const has = ((existing as { items?: { companyId: string | null }[] }).items ?? []).some((l) => l.companyId === c.id);
        if (has) {
          out.push({ company: c.name, state: "skipped", note: "already has a lead" });
        } else {
          const email = c.email && EMAIL_RE.test(c.email.trim()) ? c.email.trim() : undefined;
          const phone = c.phone?.split(/\s*(?:\/|;|,)\s*/)[0]?.trim().slice(0, 40) || undefined;
          const noContacts = (c._count?.contacts ?? 0) === 0;
          const res = (await api.call("createLead", {
            params: { orgSlug },
            body: {
              leadStatusId: status,
              companyId: c.id,
              temperature: temp,
              ...(sourceId ? { leadSourceId: sourceId } : {}),
              ...(serviceId ? { serviceInterestId: serviceId } : {}),
              ...(noContacts && (email || phone) ? { contact: { name: c.name.slice(0, 120), email, phone } } : {}),
            },
            idempotencyKey: newIdempotencyKey(),
          } as never)) as { contactReused?: boolean };
          out.push({ company: c.name, state: "created", note: noContacts && (email || phone) ? "contact added from the company's email and phone" : undefined });
          void res;
        }
      } catch (e) {
        out.push({ company: c.name, state: "failed", note: describeError(e).body });
      }
      setDone(out.length);
    }
    setResults(out);
    setRunning(false);
    onDone();
  }

  const created = results?.filter((r) => r.state === "created").length ?? 0;
  const skipped = results?.filter((r) => r.state === "skipped") ?? [];
  const failed = results?.filter((r) => r.state === "failed") ?? [];

  return (
    <ModalShell
      title={results ? "Leads created" : `Create leads from ${companies.length} ${companies.length === 1 ? "company" : "companies"}`}
      intro={results ? undefined : "Each company becomes one lead linked to it, owned by you. A company that already has a lead is skipped."}
      onClose={running ? () => undefined : onClose}
      dismissible={!running}
      label="Create leads from companies"
      footer={
        results ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
              Close
            </button>
            <Link href={`/o/${orgSlug}/leads`} className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={onClose}>
              Open leads
            </Link>
          </>
        ) : (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" disabled={running} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={running || !status || companies.length === 0} onClick={() => void run()}>
              {running ? `Creating ${done} of ${companies.length}…` : `Create ${companies.length} ${companies.length === 1 ? "lead" : "leads"}`}
            </button>
          </>
        )
      }
    >
      {results ? (
        <div className="fb-cu-result" aria-live="polite">
          <p>
            <strong>{created}</strong> {created === 1 ? "lead" : "leads"} created
            {skipped.length ? `, ${skipped.length} skipped (already had a lead)` : ""}
            {failed.length ? `, ${failed.length} could not be created` : ""}.
          </p>
          {failed.length ? (
            <ul>
              {failed.map((f) => (
                <li key={f.company}>
                  {f.company}: {f.note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="fb-cu-form">
          <label className="fb-ld-field">
            <span>Lead status</span>
            <select className="fb-ld-select" value={status} onChange={(e) => setStatusId(e.target.value)} disabled={running}>
              {ref.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fb-ld-field">
            <span>Source</span>
            <select className="fb-ld-select" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={running}>
              <option value="">Not known</option>
              {ref.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fb-ld-field">
            <span>Service interest</span>
            <select className="fb-ld-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={running}>
              <option value="">Not decided yet</option>
              {ref.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fb-ld-field">
            <span>Temperature</span>
            <select className="fb-ld-select" value={temp} onChange={(e) => setTemp(e.target.value as "HOT" | "WARM" | "COLD")} disabled={running}>
              <option value="HOT">Hot</option>
              <option value="WARM">Warm</option>
              <option value="COLD">Cold</option>
            </select>
          </label>
          <p className="fb-ld-hint">A company with no contact gets one from its own email and phone, when it has them.</p>
        </div>
      )}
    </ModalShell>
  );
}
