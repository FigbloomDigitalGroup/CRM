"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Input, useMember } from "@/ui";
import { formatKes } from "../commercial/quoteMath";
import { saveCatalogue, useDemoStore } from "../commercial/demo/store";
import { EditorFrame, recordAudit } from "./kit";
import { validateCatalogueItem } from "./model";

/**
 * Service catalogue (S6#2, FIG-1174): products and services with list prices, used by the quote builder. Cost and margin are shown and editable
 * only with `deals.margin`; for everyone else those columns do not exist. A price change never alters a quote already sent (the version froze its
 * prices when it was sent).
 */
export function CatalogueEditor() {
  const { can, userName } = useMember();
  const store = useDemoStore();
  const [draft, setDraft] = useState<typeof store.catalogue | null>(null);
  const [adding, setAdding] = useState({ name: "", unit: "", price: "", cost: "" });
  const rows = draft ?? store.catalogue;
  const showCost = can("deals.margin");
  const mayEdit = can("catalogue.manage");
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(store.catalogue);

  const errors = rows.flatMap((r) => validateCatalogueItem(r, showCost));
  const changed = rows.filter((r) => store.catalogue.find((c) => c.id === r.id)?.price !== r.price || !store.catalogue.some((c) => c.id === r.id));
  const sentUsing = store.quotes.filter((q) => q.status === "Sent" || q.status === "Signed").length;
  const impact = [
    ...changed.map((r) => {
      const old = store.catalogue.find((c) => c.id === r.id);
      return old ? `${r.name}: ${formatKes(old.price)} → ${formatKes(r.price)}.` : `${r.name} is added to the catalogue at ${formatKes(r.price)}.`;
    }),
    ...(changed.length ? [`New and draft quotes use the new prices. ${sentUsing} quote${sentUsing === 1 ? "" : "s"} already sent keep the price the client saw.`] : []),
  ];

  const set = (id: string, patch: Partial<(typeof rows)[number]>) => setDraft(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

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
      onSave={() => {
        saveCatalogue(rows);
        recordAudit("Catalogue", "Catalogue changed", `${changed.length} item${changed.length === 1 ? "" : "s"} updated`, userName);
        setDraft(null);
      }}
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
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>per {r.unit}</td>
                <td className="fb-com-num">
                  <input className="fb-input fb-com-targetinput" type="number" min={0} value={r.price} readOnly={!mayEdit} aria-label={`Price for ${r.name}`} onChange={(e) => set(r.id, { price: Number(e.target.value) })} />
                </td>
                {showCost ? <td className="fb-com-num">{formatKes(r.cost)}</td> : null}
                {showCost ? <td className="fb-com-num">{r.price ? `${Math.round(((r.price - r.cost) / r.price) * 100)}%` : "—"}</td> : null}
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
              setDraft([...rows, { id: `new${rows.length + 1}`, name: adding.name.trim(), unit: adding.unit.trim() || "unit", price: Number(adding.price), cost: Number(adding.cost) || 0 }]);
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
