"use client";

import { useState } from "react";
import { TEXT, canSign, kes, totalOf, type Lang, type SigningQuote } from "./demoSigning";

/**
 * The client signing page (Q2, FIG-1193): mobile first, English or Swahili, a name, one tick and one button, so a phone user signs in well under a
 * minute. Three states from the design: unsigned, signed (with the audit note) and deposit requested (only when the quote carries one). The
 * demo marks itself on the page; signing here changes nothing outside this tab.
 */
export function SignClient({ quote }: { quote: SigningQuote | null }) {
  const [lang, setLang] = useState<Lang>("en");
  const [name, setName] = useState(quote?.contact ?? "");
  const [agreed, setAgreed] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(quote?.signedAt ?? null);
  const [tried, setTried] = useState(false);
  const t = TEXT[lang];
  const locale = lang === "sw" ? "sw-KE" : "en-KE";

  const langBar = (
    <div className="sgn__bar">
      <span className="sgn__brand">FigBloom Digital Group</span>
      <div className="sgn__lang" role="group" aria-label={t.lang}>
        <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
        <button type="button" aria-pressed={lang === "sw"} onClick={() => setLang("sw")} lang="sw">SW</button>
      </div>
    </div>
  );

  if (!quote) {
    return (
      <main className="sgn__wrap">
        {langBar}
        <div className="sgn__card" role="alert">
          <h1 className="sgn__h1">{t.invalidTitle}</h1>
          <p className="sgn__muted">{t.invalidBody}</p>
        </div>
      </main>
    );
  }

  const sub = quote.lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const discount = Math.round((sub * quote.discountPct) / 100);
  const total = totalOf(quote.lines, quote.discountPct);
  const date = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const ok = canSign(name, agreed);

  return (
    <main className="sgn__wrap" data-screen-label="Client e-signature">
      {langBar}
      <section className="sgn__card" aria-labelledby="sgn-title">
        <h1 className="sgn__h1" id="sgn-title">{t.title(quote.no)}</h1>
        <p className="sgn__muted">
          {t.for(quote.company)} · {t.valid(new Date(quote.validUntil).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }))}
        </p>
        <table className="sgn__table">
          <thead>
            <tr><th scope="col">{t.item}</th><th scope="col" className="sgn__num">{t.qty}</th><th scope="col" className="sgn__num">{t.amount}</th></tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.name}><td>{l.name}</td><td className="sgn__num">{l.qty}</td><td className="sgn__num">{kes(l.qty * l.unit)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="sgn__muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{t.subtotal}</span><span>{kes(sub)}</span></div>
        <div className="sgn__muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{t.discount(quote.discountPct)}</span><span>−{kes(discount)}</span></div>
        <div className="sgn__total"><span>{t.total}</span><span>{kes(total)}</span></div>
        <p className="sgn__muted">{quote.terms}</p>
      </section>

      {signedAt !== null ? (
        <section className="sgn__card" aria-live="polite">
          <div className="sgn__notice">
            <strong>{t.signedTitle}</strong>
            <div className="sgn__sig">{quote.signer ?? name}</div>
            <div>{t.signedBy(quote.signer ?? name, date(signedAt))}</div>
          </div>
          <p className="sgn__muted">{t.audit}</p>
          {quote.state === "deposit" && quote.depositAmount ? (
            <div className="sgn__notice sgn__notice--warn"><strong>{t.depositTitle}</strong><div>{t.depositBody(kes(quote.depositAmount))}</div></div>
          ) : null}
        </section>
      ) : (
        <form
          className="sgn__card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (ok) setSignedAt(new Date().toISOString());
          }}
        >
          <label className="sgn__label">
            {t.name}
            <input className="sgn__input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <div className="sgn__sig" aria-hidden="true">{name}</div>
          <label className="sgn__check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <span>{t.agree}</span>
          </label>
          {tried && !ok ? <span className="sgn__error" role="alert">{t.needName}</span> : null}
          <button className="sgn__btn" type="submit" aria-disabled={!ok || undefined}>{t.sign}</button>
        </form>
      )}
    </main>
  );
}
