"use client";

import { useState, useTransition } from "react";
import { createTranslator, formatDateFor, formatMomentFor, formatMoneyFor, type ClientLocale } from "@/lib/clientText";
import { signQuoteAction, type SignActionResult } from "./actions";

/**
 * The client signing page (Q2, FIG-1186, FIG-1189): mobile first, English or Swahili, a name, one tick and one button. The language starts as
 * the language of the document that was sent; the person may switch, and the wording they saw when they signed is what the record keeps.
 */
interface PageData {
  organisationName: string;
  quoteNumber: string;
  version: number;
  company: string;
  currency: string;
  validUntil: string;
  terms: string | null;
  lines: { description: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  documentLanguage: ClientLocale;
  recipientEmail: string;
}

export type SignState =
  | { status: "ok"; page: PageData }
  | { status: "signed"; page: PageData; signature: { signerName: string; signedAt: string; language: ClientLocale; reference: string } }
  | { status: "expired"; organisationName: string; language: ClientLocale };

export function LiveSign({ token, state }: { token: string; state: SignState }) {
  const initial: ClientLocale = state.status === "expired" ? state.language : state.page.documentLanguage;
  const [lang, setLang] = useState<ClientLocale>(initial);
  const tr = createTranslator(lang);
  const t = tr.t;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ signerName: string; signedAt: string; reference: string } | null>(state.status === "signed" ? { ...state.signature } : null);
  const [pending, startTransition] = useTransition();

  const langBar = (
    <div className="sgn__bar">
      <span className="sgn__brand">{state.status === "expired" ? state.organisationName : state.page.organisationName}</span>
      <div className="sgn__lang" role="group" aria-label={t("sign.language")}>
        <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
        <button type="button" aria-pressed={lang === "sw"} onClick={() => setLang("sw")} lang="sw">SW</button>
      </div>
    </div>
  );

  if (state.status === "expired") {
    return (
      <main className="sgn__wrap" lang={lang}>
        {langBar}
        <div className="sgn__card" role="alert">
          <h1 className="sgn__h1">{t("sign.expiredTitle")}</h1>
          <p className="sgn__muted">{t("sign.expiredBody", { organisation: state.organisationName })}</p>
        </div>
      </main>
    );
  }

  const { page } = state;
  const money = (n: number) => formatMoneyFor(lang, n, page.currency);
  const nameOk = name.replace(/[^\p{L}]/gu, "").length >= 2;
  const ok = nameOk && agreed;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setProblem(null);
    if (!ok) return;
    startTransition(async () => {
      const res: SignActionResult = await signQuoteAction(token, { signerName: name, signerEmail: email || undefined, consent: agreed, language: lang });
      if (res.ok) setDone({ signerName: res.signerName, signedAt: res.signedAt, reference: res.reference });
      else if (res.code === "ALREADY_ANSWERED") setProblem(t("sign.invalidBody"));
      else if (res.code === "EXPIRED") setProblem(t("sign.expiredBody", { organisation: page.organisationName }));
      else setProblem(t("sign.error"));
    });
  }

  return (
    <main className="sgn__wrap" lang={lang} data-screen-label="Client e-signature">
      {langBar}
      <section className="sgn__card" aria-labelledby="sgn-title">
        <h1 className="sgn__h1" id="sgn-title">{t("sign.title", { number: page.quoteNumber })}</h1>
        <p className="sgn__muted">{t("sign.for", { company: page.company })} · {t("sign.valid", { date: formatDateFor(lang, page.validUntil) })}</p>
        <table className="sgn__table">
          <thead>
            <tr><th scope="col">{t("sign.item")}</th><th scope="col" className="sgn__num">{t("sign.qty")}</th><th scope="col" className="sgn__num">{t("sign.amount")}</th></tr>
          </thead>
          <tbody>
            {page.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="sgn__num">{l.quantity}</td><td className="sgn__num">{money(l.lineTotal)}</td></tr>
            ))}
          </tbody>
        </table>
        {page.discountAmount > 0 ? (
          <>
            <div className="sgn__muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{t("sign.subtotal")}</span><span>{money(page.subtotal)}</span></div>
            <div className="sgn__muted" style={{ display: "flex", justifyContent: "space-between" }}><span>{t("sign.discount", { pct: page.discountPercent })}</span><span>−{money(page.discountAmount)}</span></div>
          </>
        ) : null}
        <div className="sgn__total"><span>{t("sign.total")}</span><span>{money(page.total)}</span></div>
        {page.terms ? <p className="sgn__muted">{page.terms}</p> : null}
      </section>

      {done ? (
        <section className="sgn__card" aria-live="polite">
          <div className="sgn__notice">
            <strong>{t("sign.signedTitle")}</strong>
            <div className="sgn__sig">{done.signerName}</div>
            <div>{t("sign.signedBy", { name: done.signerName, time: formatMomentFor(lang, new Date(done.signedAt)) })}</div>
          </div>
          <p className="sgn__muted">{t("sign.audit")}</p>
          <p className="sgn__muted">{t("sign.seal", { seal: done.reference })}</p>
        </section>
      ) : (
        <form className="sgn__card" noValidate onSubmit={submit}>
          <label className="sgn__label">
            {t("sign.name")}
            <input className="sgn__input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} />
          </label>
          <div className="sgn__sig" aria-hidden="true">{name}</div>
          <label className="sgn__label">
            {t("sign.email")}
            <input className="sgn__input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} />
          </label>
          <label className="sgn__check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <span>{t("sign.consent")}</span>
          </label>
          {tried && !ok ? <span className="sgn__error" role="alert">{t("sign.needName")}</span> : null}
          {problem ? <span className="sgn__error" role="alert">{problem}</span> : null}
          {tr.fellBack.size > 0 ? <p className="sgn__muted">{t("doc.fallbackNote")}</p> : null}
          <button className="sgn__btn" type="submit" disabled={pending}>{pending ? t("sign.signing") : t("sign.button")}</button>
        </form>
      )}
    </main>
  );
}
