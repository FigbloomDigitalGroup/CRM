"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Input, LoadingState, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, kes, useCatalogue, useCreateCatalogueItem, useUpdateCatalogueItem, type CatalogueItemView } from "../commercial/api";
import { EditorFrame, recordAudit } from "./kit";
import { validateCatalogueItem } from "./model";

/**
 * Service catalogue (S6#2, FIG-1174) on `GET/POST/PATCH /catalogue`: products and services with list prices, used by the quote builder. Cost and
 * margin are shown and editable only with `deals.margin`; the API sends them as null otherwise, and those columns then do not exist. A price change
 * never alters a quote already made (a line freezes its price when it is added).
 */
interface Row {
  id: string;
  name: string;
  unit: string;
  price: number;
  cost: number | null;
  isNew?: boolean;
}

const toRow = (c: CatalogueItemView): Row => ({ id: c.id, name: c.name, unit: c.unit, price: c.price, cost: c.cost });

export function CatalogueEditor() {
  const { can, userName, orgSlug } = useMember();
  const toast = useToast();
  const q = useCatalogue(orgSlug);
  const create = useCreateCatalogueItem();
  const update = useUpdateCatalogueItem();
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState({ name: "", unit: "", price: "", cost: "" });

  if (q.isLoading) return <LoadingState label="Loading the catalogue" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="The catalogue" onRetry={() => void q.refetch()} />;

  const saved = q.data.items.map(toRow);
  const rows = draft ?? saved;
  const showCost = can("deals.margin") && q.data.items.every((i) => !i.costMasked);
  const mayEdit = can("catalogue.manage");
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const errors = rows.flatMap((r) => validateCatalogueItem({ ...r, cost: r.cost ?? 0 }, showCost));
  const changed = rows.filter((r) => r.isNew || saved.find((c) => c.id === r.id)?.price !== r.price || (showCost && saved.find((c) => c.id === r.id)?.cost !== r.cost));
  const impact = [
    ...changed.map((r) => {
      const old = saved.find((c) => c.id === r.id);
      return old ? `${r.name}: ${kes(old.price)} → ${kes(r.price)}.` : `${r.name} is added to the catalogue at ${kes(r.price)}.`;
    }),
    ...(changed.length ? ["New and draft quotes use the new prices. Quotes already sent keep the price the client saw."] : []),
  ];

  const set = (id: string, patch: Partial<Row>) => setDraft(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function onSave() {
    try {
      for (const r of changed) {
        if (r.isNew) {
          await create.mutateAsync({ params: { orgSlug }, body: { name: r.name, unit: r.unit, price: r.price, ...(showCost && r.cost !== null ? { cost: r.cost } : {}) } });
        } else {
          await update.mutateAsync({ params: { orgSlug, itemId: r.id }, body: { price: r.price, ...(showCost && r.cost !== null ? { cost: r.cost } : {}) } });
        }
      }
      recordAudit("Catalogue", "Catalogue changed", `${changed.length} item${changed.length === 1 ? "" : "s"} updated`, userName);
      setDraft(null);
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
    }
  }

  return (
    <EditorFrame
      area="Catalogue"
      title="Service catalogue"
      description="Products and services with list prices, used by the quote builder."
      release="v1.1"
      dirty={dirty}
      errors={errors}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management manages the catalogue"}
      onDiscard={() => setDraft(null)}
      onSave={() => void onSave()}
    >
      <div className="fb-set-tablewrap">
        <table className="fb-com-table">
          <caption className="fb-sr-only">Service catalogue</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Unit</th>
              <th scope="col" className="fb-com-num">List price (KES)</th>
              {showCost ? <th scope="col" className="fb-com-num">Cost</th> : null}
              {showCost ? <th scope="col" className="fb-com-num">Margin</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={showCost ? 5 : 3}>No items yet. Add the first one below.</td></tr> : null}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>per {r.unit}</td>
                <td className="fb-com-num">
                  <input className="fb-input fb-com-targetinput" type="number" min={0} value={r.price} readOnly={!mayEdit} aria-label={`Price for ${r.name}`} onChange={(e) => set(r.id, { price: Number(e.target.value) })} />
                </td>
                {showCost ? <td className="fb-com-num">{r.cost === null ? "—" : kes(r.cost)}</td> : null}
                {showCost ? <td className="fb-com-num">{r.price && r.cost !== null ? `${Math.round(((r.price - r.cost) / r.price) * 100)}%` : "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mayEdit ? (
        <fieldset className="fb-sp-add">
          <legend className="fb-com-eyebrow">New item</legend>
          <Input label="Name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <Input label="Per" value={adding.unit} placeholder="unit, month, project" onChange={(e) => setAdding({ ...adding, unit: e.target.value })} />
          <Input label="List price" type="number" min={0} value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} />
          {showCost ? <Input label="Cost" type="number" min={0} value={adding.cost} onChange={(e) => setAdding({ ...adding, cost: e.target.value })} /> : null}
          <Button
            disabledReason={!adding.name.trim() || !Number(adding.price) ? "Enter a name and a price" : undefined}
            onClick={() => {
              setDraft([...rows, { id: `new${rows.length + 1}`, isNew: true, name: adding.name.trim(), unit: adding.unit.trim() || "unit", price: Number(adding.price), cost: showCost && adding.cost !== "" ? Number(adding.cost) : null }]);
              setAdding({ name: "", unit: "", price: "", cost: "" });
            }}
          >
            <Plus size={15} aria-hidden="true" /> Add to the list
          </Button>
        </fieldset>
      ) : null}
      <p className="fb-set-muted">{showCost ? "Cost and margin are visible to Management only." : "Cost and margin are hidden for your role."} Price changes don’t alter quotes already sent.</p>
    </EditorFrame>
  );
}
