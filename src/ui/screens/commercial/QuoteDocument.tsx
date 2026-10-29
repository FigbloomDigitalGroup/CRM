import { BrandMark } from "@/app/_shared/BrandMark";
import { formatKes, quoteTotals, type CatalogueItem, type QuoteDoc } from "./quoteMath";

/**
 * The quote as the client receives it (Q1 "Quote document preview"). It shows what the client sees and nothing else: no cost, no margin, ever,
 * whoever is previewing, so the preview cannot leak what the builder masks.
 */
export function QuoteDocument({ quote, company, contact, catalogue }: { quote: QuoteDoc; company: string; contact: string; catalogue: readonly CatalogueItem[] }) {
  const totals = quoteTotals(quote.lines, catalogue, quote.discount);
  const valid = new Date(quote.validUntil).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
  return (
    <section className="fb-com-doc" data-screen-label="Quote document preview" aria-label={`Quote ${quote.no} document preview`}>
      <header className="fb-com-doc__head">
        <div className="fb-com-doc__brand">
          <span className="fb-com-doc__logo"><BrandMark className="brand-mark" /></span>
          <div>
            <div className="fb-com-strong">FigBloom Digital Group</div>
            <div className="fb-com-muted">Westlands, Nairobi · +254 711 482 900</div>
          </div>
        </div>
        <div className="fb-com-doc__meta">
          <div className="fb-com-doc__kind">QUOTE</div>
          <div>{quote.no} · v{quote.version}</div>
          <div className="fb-com-muted">Valid until {valid}</div>
        </div>
      </header>
      <div className="fb-com-doc__to">
        <div className="fb-com-eyebrow">Prepared for</div>
        <div className="fb-com-strong">{company}</div>
        <div className="fb-com-muted">{contact}</div>
      </div>
      <table className="fb-com-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="fb-com-num">Qty</th>
            <th scope="col" className="fb-com-num">Unit</th>
            <th scope="col" className="fb-com-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l) => {
            const item = catalogue.find((c) => c.id === l.cat);
            if (!item) return null;
            const price = l.price ?? item.price;
            return (
              <tr key={l.cat}>
                <td>{item.name}</td>
                <td className="fb-com-num">{l.qty}</td>
                <td className="fb-com-num">{formatKes(price)}</td>
                <td className="fb-com-num">{formatKes(price * l.qty)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="fb-com-sum fb-com-doc__totals">
        <div><dt>Subtotal</dt><dd>{formatKes(totals.subtotal)}</dd></div>
        <div><dt>Discount ({quote.discount}%)</dt><dd>−{formatKes(totals.discount)}</dd></div>
        <div className="fb-com-sum__total"><dt>Total (incl. VAT)</dt><dd>{formatKes(totals.total)}</dd></div>
      </dl>
      <p className="fb-com-muted">{quote.terms}</p>
      {quote.status === "Signed" ? (
        <div className="fb-com-doc__signed">
          <div>
            <div className="fb-com-doc__sig">{quote.signer}</div>
            <div className="fb-com-muted">Signed by {quote.signer}</div>
          </div>
          <span className="fb-com-pill fb-com-pill--ok">Signature verified · audit trail kept</span>
        </div>
      ) : null}
    </section>
  );
}
