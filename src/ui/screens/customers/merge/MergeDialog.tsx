"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../../../errors";
import { useToast } from "../../../components/toast";
import { useApi, useApiQuery } from "../../../data/hooks";
import { useMember } from "../../../data/member";
import { newIdempotencyKey } from "../../../data/client";
import { Icon } from "../../leads/icons";
import { ModalShell } from "../../leads/overlay";
import { useCustomerReference, useDebounced } from "../data";

export type MergeKind = "company" | "contact" | "lead";

export interface MergeDialogProps {
  kind: MergeKind;
  /** The record the person opened the dialog from. Either side can be the one that is kept; this one is kept to start with. */
  id: string;
  onClose?: () => void;
  /** Called with the id of the record that survived, once the merge is saved. The dialog stays open (with Undo) until the person closes it. */
  onMerged?: (survivorId: string) => void;
  /** Called when a merge is undone inside the dialog, so the page behind it can forget the survivor. */
  onUndone?: () => void;
}

interface FieldDef {
  key: string;
  label: string;
}

/** The fields a person may choose between (the API's `MERGE_FIELDS`). */
const COMPANY_FIELDS: FieldDef[] = [
  { key: "name", label: "Name" },
  { key: "industry", label: "Industry" },
  { key: "website", label: "Website" },
  { key: "location", label: "Location" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "notes", label: "Notes" },
  { key: "lifecycleStateId", label: "Lifecycle" },
  { key: "ownerMembershipId", label: "Owner" },
];
const CONTACT_FIELDS: FieldDef[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "jobTitle", label: "Job title" },
  { key: "department", label: "Department" },
  { key: "notes", label: "Notes" },
  { key: "ownerMembershipId", label: "Owner" },
];

interface Rec {
  id: string;
  name: string;
  meta: string;
  archived: boolean;
  values: Record<string, string | null>;
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const str = (v: unknown): string | null => (blank(v) ? null : String(v));

/** The directory searches each field for the whole text, so "Wanjiru Kamau" would match nothing; ask for the longest word and keep the rows that hold every word. */
const longestWord = (text: string): string => text.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? text;
const matchesAllWords = (text: string, parts: unknown[]): boolean => {
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  return text.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

type Side = "A" | "B";
type Choice = "keep" | "other";

/**
 * Merge duplicates (C4, FIG-1097): choose the other record, choose which one is kept, choose the value for every field that differs, read the
 * preview of the result, and confirm. Nothing is deleted: the other record is archived with a pointer to the one kept, its contacts, deals,
 * tasks and timeline move across, the merge is written to the audit log, and it can be undone for a short time (the server's window).
 *
 * Companies and contacts are merged by the API. A lead has no merge route in the V1 contract (a likely duplicate is flagged when a lead is
 * captured, and a conversion links to an existing company), so for a lead the dialog explains that instead of offering a button that cannot work.
 */
export function MergeDialog(props: MergeDialogProps) {
  const { kind, onClose } = props;
  const close = () => onClose?.();
  if (kind === "lead") {
    return (
      <ModalShell
        title="Merge duplicates"
        intro="Leads are not merged in this release."
        onClose={close}
        label="Merge duplicates"
        footer={
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={close}>
            Got it
          </button>
        }
      >
        <div className="fb-cu-result" role="note">
          A likely duplicate is flagged when a lead is captured, and converting a lead links it to the company you already have, so nothing is lost. To tidy duplicates that
          already exist, merge the <strong>company</strong> or the <strong>contact</strong> they belong to; leads and deals follow it across.
        </div>
      </ModalShell>
    );
  }
  return <RecordMerge {...props} kind={kind} />;
}

function RecordMerge({ kind, id, onClose, onMerged, onUndone }: MergeDialogProps & { kind: "company" | "contact" }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const ref = useCustomerReference();
  const fields = kind === "company" ? COMPANY_FIELDS : CONTACT_FIELDS;
  const noun = kind === "company" ? "company" : "contact";

  const [otherId, setOtherId] = useState<string | null>(null);
  const [keep, setKeep] = useState<Side>("A");
  const [picks, setPicks] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mergeRecordId: string; undoExpiresAt: string | null; winner: string; loser: string; winnerId: string; loserId: string } | null>(null);
  const [undone, setUndone] = useState(false);
  const [q, setQ] = useState("");
  const typed = useDebounced(q.trim(), 300);

  const toRec = (raw: Record<string, unknown> | undefined): Rec | null => {
    if (!raw) return null;
    const values: Record<string, string | null> = {};
    for (const f of fields) values[f.key] = str(raw[f.key]);
    if (kind === "company") {
      const contacts = ((raw.contacts as unknown[] | undefined) ?? []).filter((c) => !(c as { archivedAt?: unknown }).archivedAt).length;
      const state = ref.states.find((s) => s.id === raw.lifecycleStateId)?.name;
      const owner = ref.ownerName(raw.ownerMembershipId as string | null);
      return {
        id: String(raw.id),
        name: String(raw.name ?? ""),
        meta: [str(raw.industry), `${contacts} contact${contacts === 1 ? "" : "s"}`, state, owner ? `owner ${owner}` : "no owner"].filter(Boolean).join(" · "),
        archived: Boolean(raw.archivedAt),
        values,
      };
    }
    const company = (raw.company as { name?: string } | null | undefined)?.name;
    const owner = ref.ownerName(raw.ownerMembershipId as string | null);
    return {
      id: String(raw.id),
      name: [raw.firstName, raw.lastName].filter(Boolean).join(" "),
      meta: [str(raw.jobTitle), company ?? "No company", owner ? `owner ${owner}` : "no owner"].filter(Boolean).join(" · "),
      archived: Boolean(raw.archivedAt),
      values,
    };
  };

  const aQ = useApiQuery(kind === "company" ? "getCompaniesByCompanyId" : "getContactsByContactId", { params: (kind === "company" ? { orgSlug, companyId: id } : { orgSlug, contactId: id }) as never });
  const bQ = useApiQuery(kind === "company" ? "getCompaniesByCompanyId" : "getContactsByContactId", { params: (kind === "company" ? { orgSlug, companyId: otherId ?? "" } : { orgSlug, contactId: otherId ?? "" }) as never }, { enabled: Boolean(otherId) });
  const A = useMemo(() => toRec(aQ.data as Record<string, unknown> | undefined), [aQ.data, ref.states, ref.members]);
  const B = useMemo(() => toRec(bQ.data as Record<string, unknown> | undefined), [bQ.data, ref.states, ref.members]);

  // Candidates: companies that look like this one (the duplicate check), then whatever the search finds.
  const [suggested, setSuggested] = useState<{ id: string; label: string; meta: string }[]>([]);
  useEffect(() => {
    if (kind !== "company" || !A) return;
    let live = true;
    api
      .call("postCompaniesCheckDuplicates", { params: { orgSlug }, body: { name: A.values.name ?? undefined, email: A.values.email ?? undefined, phone: A.values.phone ?? undefined }, idempotencyKey: newIdempotencyKey() } as never)
      .then((res) => {
        const list = ((res as { possibleDuplicates?: { id: string; name: string; industry?: string | null; location?: string | null }[] }).possibleDuplicates ?? []).filter((c) => c.id !== id);
        if (live) setSuggested(list.map((c) => ({ id: c.id, label: c.name, meta: [c.industry, c.location].filter(Boolean).join(" · ") || "Possible duplicate" })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, orgSlug, kind, A, id]);

  const searchQ = useApiQuery(
    kind === "company" ? "listCompanyDirectory" : "listContactDirectory",
    { params: { orgSlug }, query: { q: kind === "contact" ? longestWord(typed) : typed, pageSize: kind === "contact" ? "25" : "8" } } as never,
    { enabled: typed.length >= 2 && !otherId },
  );
  const found = ((searchQ.data as { items?: Record<string, unknown>[] } | undefined)?.items ?? [])
    .filter((r) => r.id !== id && !r.archivedAt)
    .filter((r) => kind !== "contact" || matchesAllWords(typed, [r.firstName, r.lastName, r.email, r.phone, (r.company as { name?: string } | null | undefined)?.name]))
    .map((r) => ({
      id: String(r.id),
      label: kind === "company" ? String(r.name) : [r.firstName, r.lastName].filter(Boolean).join(" "),
      meta: kind === "company" ? [str(r.industry), str(r.location)].filter(Boolean).join(" · ") : [str(r.email), str(r.phone)].filter(Boolean).join(" · "),
    }));
  const candidates = typed.length >= 2 ? found : suggested;

  const kept = keep === "A" ? A : B;
  const other = keep === "A" ? B : A;

  // A new pair (or a swap) starts from the safe default: the kept record's value, unless it is blank and the other has one.
  useEffect(() => {
    if (!kept || !other) return;
    const next: Record<string, Choice> = {};
    for (const f of fields) next[f.key] = blank(kept.values[f.key]) && !blank(other.values[f.key]) ? "other" : "keep";
    setPicks(next);
  }, [kept?.id, other?.id]);

  const display = (rec: Rec, f: FieldDef): string => {
    const v = rec.values[f.key];
    if (v === null) return "—";
    if (f.key === "ownerMembershipId") return ref.ownerName(v) ?? "Team member";
    if (f.key === "lifecycleStateId") return ref.states.find((s) => s.id === v)?.name ?? v;
    return v;
  };

  const differing = fields.filter((f) => kept && other && (kept.values[f.key] ?? null) !== (other.values[f.key] ?? null));
  const result = (f: FieldDef): string => (kept && other ? display(picks[f.key] === "other" ? other : kept, f) : "—");

  async function confirm() {
    if (!kept || !other) return;
    setBusy(true);
    setError(null);
    try {
      const body = { intoCompanyId: kept.id, intoContactId: kept.id, fields: Object.fromEntries(fields.map((f) => [f.key, picks[f.key] === "other" ? "loser" : "winner"])) };
      const res =
        kind === "company"
          ? await api.call("postCompaniesByCompanyIdMerge", { params: { orgSlug, companyId: other.id }, body: { intoCompanyId: body.intoCompanyId, fields: body.fields }, idempotencyKey: newIdempotencyKey() } as never)
          : await api.call("postContactsByContactIdMerge", { params: { orgSlug, contactId: other.id }, body: { intoContactId: body.intoContactId, fields: body.fields }, idempotencyKey: newIdempotencyKey() } as never);
      const r = res as { mergeRecordId?: string; undoExpiresAt?: string | null };
      await qc.invalidateQueries();
      setDone({ mergeRecordId: r.mergeRecordId ?? "", undoExpiresAt: r.undoExpiresAt ?? null, winner: kept.name, loser: other.name, winnerId: kept.id, loserId: other.id });
      toast.show({ tone: "success", message: `Merged. ${other.name} was archived and its history moved to ${kept.name}.` });
      onMerged?.(kept.id);
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!done?.mergeRecordId) return;
    setBusy(true);
    try {
      await api.call("postMergesByMergeIdUndo", { params: { orgSlug, mergeId: done.mergeRecordId }, idempotencyKey: newIdempotencyKey() } as never);
      await qc.invalidateQueries();
      setUndone(true);
      toast.show({ tone: "success", message: `Merge undone. ${done.loser} is back.` });
      onUndone?.();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  const loadError = aQ.isError ? describeError(aQ.error) : null;
  const intro = `Contacts, deals, tasks and timelines move to the ${noun} you keep. The other is archived, not deleted.`;

  if (done) {
    const mins = done.undoExpiresAt ? Math.max(0, Math.round((new Date(done.undoExpiresAt).getTime() - Date.now()) / 60000)) : null;
    return (
      <ModalShell
        title={undone ? "Merge undone" : "Merged"}
        intro={undone ? `${done.loser} is active again and everything has been put back.` : `${done.loser} was archived and its history moved to ${done.winner}. The merge is in the audit log.`}
        onClose={() => onClose?.()}
        label="Merge duplicates"
        footer={
          <>
            {!undone && done.mergeRecordId ? (
              <button type="button" className="fb-ld-btn fb-ld-btn--lg" disabled={busy} onClick={undo}>
                <Icon name="restore" size={15} />
                Undo merge
              </button>
            ) : null}
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={() => onClose?.()}>
              Done
            </button>
          </>
        }
      >
        {!undone && mins !== null ? <p className="fb-ld-footnote">You can undo this for about {mins <= 1 ? "a minute" : `${mins} minutes`}. After that the merge stays.</p> : null}
        {error ? (
          <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
            <div>{error}</div>
          </div>
        ) : null}
      </ModalShell>
    );
  }

  return (
    <ModalShell
      title="Merge duplicates"
      intro={intro}
      onClose={() => onClose?.()}
      label="Merge duplicates"
      footer={
        <>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => onClose?.()}>
            Cancel
          </button>
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={!kept || !other || busy || kept.archived || other.archived} onClick={confirm}>
            {busy ? "Merging…" : "Merge into selected"}
          </button>
        </>
      }
    >
      {loadError ? (
        <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
          <div>{loadError.body}</div>
        </div>
      ) : !A ? (
        <div className="fb-cu-skel" style={{ height: 80 }} aria-busy="true" />
      ) : !otherId ? (
        <>
          <div className="fb-ld-field">
            <span>Which {noun} is the duplicate?</span>
            <div className="fb-cu-search" style={{ flex: "1 1 auto" }}>
              <span className="fb-cu-search__icon">
                <Icon name="search" size={16} />
              </span>
              <input type="search" aria-label={`Search for the duplicate ${noun}`} placeholder={kind === "company" ? "Search name, email or phone" : "Search name, email or phone"} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="fb-cu-picker" role="list" aria-label={typed.length >= 2 ? "Search results" : "Possible duplicates"}>
            {candidates.map((c) => (
              <div key={c.id} role="listitem">
                <button type="button" className="fb-cu-pick" style={{ width: "100%" }} onClick={() => setOtherId(c.id)}>
                  <div className="fb-cu-pick__name">{c.label}</div>
                  <div className="fb-cu-pick__meta">{c.meta || (typed.length >= 2 ? "" : "Possible duplicate")}</div>
                </button>
              </div>
            ))}
            {candidates.length === 0 ? <div className="fb-cu-empty">{typed.length >= 2 ? (searchQ.isLoading ? "Searching…" : `No ${noun} matches “${typed}”.`) : `Type at least two letters to look for the duplicate. Likely duplicates of ${A.name} show here first.`}</div> : null}
          </div>
        </>
      ) : !B ? (
        bQ.isError ? (
          <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
            <div>{describeError(bQ.error).body}</div>
          </div>
        ) : (
          <div className="fb-cu-skel" style={{ height: 80 }} aria-busy="true" />
        )
      ) : (
        <>
          <div className="fb-cu-merge" role="group" aria-label="Choose the record to keep">
            {(
              [
                ["A", A, "THIS RECORD"],
                ["B", B, "POSSIBLE DUPLICATE"],
              ] as const
            ).map(([side, rec, tag]) => (
              <button key={side} type="button" className="fb-cu-keep" aria-pressed={keep === side} onClick={() => setKeep(side)}>
                <div className="fb-cu-keep__tag">{tag}{keep === side ? " · KEPT" : ""}</div>
                <div className="fb-cu-keep__name">{rec.name}</div>
                <div className="fb-cu-keep__meta">{rec.meta}</div>
              </button>
            ))}
          </div>
          <button type="button" className="fb-ld-btn fb-ld-btn--link" style={{ alignSelf: "flex-start" }} onClick={() => setOtherId(null)}>
            Choose a different {noun}
          </button>

          {differing.length ? (
            <div className="fb-cu-fields" role="table" aria-label="Field by field">
              <div className="fb-cu-fields__row fb-cu-fields__head" role="row">
                <div role="columnheader">FIELD</div>
                <div role="columnheader">KEEP ({kept?.name})</div>
                <div role="columnheader">TAKE FROM ({other?.name})</div>
              </div>
              {differing.map((f) => (
                <div key={f.key} className="fb-cu-fields__row" role="row">
                  <div className="fb-cu-fields__label" role="rowheader">{f.label}</div>
                  <div role="cell">
                    <button type="button" className="fb-cu-choice" aria-pressed={picks[f.key] !== "other"} aria-label={`${f.label}: keep ${display(kept!, f)}`} onClick={() => setPicks((p) => ({ ...p, [f.key]: "keep" }))}>
                      {display(kept!, f)}
                    </button>
                  </div>
                  <div role="cell">
                    <button type="button" className="fb-cu-choice" aria-pressed={picks[f.key] === "other"} aria-label={`${f.label}: take ${display(other!, f)}`} onClick={() => setPicks((p) => ({ ...p, [f.key]: "other" }))}>
                      {display(other!, f)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="fb-ld-footnote">Every field is the same on both records, so there is nothing to choose.</p>
          )}

          <div className="fb-cu-result" aria-live="polite">
            <strong>Result.</strong> {kept?.name} is kept
            {differing.length ? (
              <>
                {" "}with{" "}
                {differing.map((f, i) => (
                  <span key={f.key}>
                    {i > 0 ? ", " : ""}
                    {f.label.toLowerCase()} {result(f)}
                  </span>
                ))}
              </>
            ) : null}
            . {other?.name} is archived, never deleted, and everything linked to it moves to {kept?.name}.
          </div>
          {kept?.archived || other?.archived ? (
            <div role="alert" className="fb-ld-callout fb-ld-callout--warn">
              <div>One of these records is archived already. Restore it first, or choose another.</div>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
              <div>{error}</div>
            </div>
          ) : null}
        </>
      )}
    </ModalShell>
  );
}
