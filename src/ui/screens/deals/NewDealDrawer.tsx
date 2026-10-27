"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useRefreshDeals } from "./data";
import type { RefData } from "./model";
import { SideDrawer } from "./SideDrawer";

/** The New deal drawer (design: CrmOverlays, `deal`). Most deals come from converting a lead; this is for a direct opportunity. */
export function NewDealDrawer({ ref_, onClose }: { ref_: RefData | undefined; onClose: () => void }) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshDeals();
  const companies = useApiQuery("getCompanies", { params: { orgSlug }, query: { pageSize: "100", sort: "name" } });
  const create = useApiMutation("postDeals");

  const openStages = (ref_?.stages ?? []).filter((s) => !s.isWon && !s.isLost);
  const [f, setF] = useState({ companyId: "", notes: "", serviceId: "", stageId: "", value: "", close: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const stageId = f.stageId || openStages[0]?.id || "";
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const list = ((companies.data as unknown as { items?: { id: string; name: string }[] } | undefined)?.items ?? []) as { id: string; name: string }[];

  async function save() {
    setError(null);
    setFieldErrors({});
    try {
      await create.mutateAsync({
        params: { orgSlug },
        body: {
          companyId: f.companyId,
          pipelineStageId: stageId,
          ...(f.serviceId ? { serviceId: f.serviceId } : {}),
          ...(f.value ? { value: Number(f.value), currency: "KES" } : {}),
          ...(f.close ? { expectedCloseDate: f.close } : {}),
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
        },
      });
      refresh();
      toast.show({ tone: "success", message: "Deal created." });
      onClose();
    } catch (e) {
      const d = describeError(e);
      setFieldErrors(Object.fromEntries(d.fieldErrors.map((x) => [x.path, x.message])));
      setError(d.kind === "validation" || d.kind === "conflict" || d.kind === "noAccess" ? d.body : "The deal was not created. Try again in a moment.");
    }
  }

  return (
    <SideDrawer
      title="New deal"
      sub="Most deals come from converting a lead. Use this for direct opportunities."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fb-btn fb-btn--secondary fb-dm__btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="fb-btn fb-btn--primary fb-dm__btn" disabled={!f.companyId || !stageId || create.isPending} onClick={() => void save()}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            Create deal
          </button>
        </>
      }
    >
      <label className="fb-dm__field">
        <span>
          Company <span className="fb-dd__req" aria-hidden="true">*</span>
        </span>
        <select className="fb-dm__input" value={f.companyId} required aria-required="true" aria-invalid={fieldErrors.companyId ? true : undefined} onChange={(e) => set("companyId", e.target.value)}>
          <option value="">{companies.isLoading ? "Loading companies…" : "Choose a company"}</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {fieldErrors.companyId ? <span className="fb-dm__error" role="alert">{fieldErrors.companyId}</span> : null}
      </label>
      <label className="fb-dm__field">
        <span>What are we selling?</span>
        <input className="fb-dm__input" value={f.notes} placeholder="e.g. CCTV for 3 branches" onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="fb-dm__grid2">
        <label className="fb-dm__field">
          <span>Service</span>
          <select className="fb-dm__input" value={f.serviceId} onChange={(e) => set("serviceId", e.target.value)}>
            <option value="">Not set</option>
            {(ref_?.services ?? []).filter((s) => s.isActive !== false).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fb-dm__field">
          <span>Stage</span>
          <select className="fb-dm__input" value={stageId} onChange={(e) => set("stageId", e.target.value)}>
            {openStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fb-dm__field">
          <span>Value (KES)</span>
          <input type="number" min="0" className="fb-dm__input" value={f.value} placeholder="0" onChange={(e) => set("value", e.target.value)} />
          {fieldErrors.value ? <span className="fb-dm__error" role="alert">{fieldErrors.value}</span> : null}
        </label>
        <label className="fb-dm__field">
          <span>Expected close</span>
          <input type="date" className="fb-dm__input" value={f.close} onChange={(e) => set("close", e.target.value)} />
        </label>
      </div>
      {error ? (
        <p role="alert" className="fb-dm__error">
          {error}
        </p>
      ) : null}
    </SideDrawer>
  );
}
