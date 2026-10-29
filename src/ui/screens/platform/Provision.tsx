"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_LISTS } from "./demo/data";
import { ReleaseTag } from "./kit";
import { applyWizardField, EMPTY_WIZARD, emailIsInvited, SLUG_MESSAGES, slugState, WIZARD_STEPS, wizardStepError, type WizardForm } from "./logic";
import { usePlatform } from "./store";

const TIMEZONES = ["Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam", "Africa/Kigali"];
const CURRENCIES = ["KES", "UGX", "TZS", "USD"];

/** PL3 Provision organisation: name, region, first admin, defaults, keys, review, done. Provisioning is all-or-nothing (a failed seed creates nothing). */
export function ProvisionWizard() {
  const { state, dispatch, toast } = usePlatform();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(EMPTY_WIZARD);
  const [lists, setLists] = useState<Record<string, string[]>>(() => Object.fromEntries(Object.entries(DEFAULT_LISTS).map(([k, v]) => [k, [...v]])));
  const [keys, setKeys] = useState({ web: true, mail: false });
  const [simFail, setSimFail] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  const taken = state.orgs.map((o) => o.slug);
  const slug = slugState(form.slug, taken);
  const set = (k: keyof WizardForm) => (v: string) => {
    setForm((f) => applyWizardField(f, k, v));
    setError("");
  };

  function next() {
    const err = wizardStepError(step, form, taken);
    if (err) return setError(err);
    if (step === 5) {
      if (simFail) {
        setSimFail(false);
        return setError("Seeding the default lists failed. Nothing was created; it’s safe to retry.");
      }
      const res = dispatch({ type: "provision", form, lists, keys });
      if (!res.ok) return setError(res.message);
      setCreatedId(res.id ?? null);
    }
    setError("");
    setStep(step + 1);
  }

  const itemCount = Object.values(lists).reduce((n, x) => n + x.length, 0);
  const review: [string, string][] = [
    ["Name", form.name], ["Slug", form.slug], ["Time zone", form.tz], ["Currency", form.cur], ["First admin", `${form.email} (Management)`],
    ["Default lists", `${itemCount} items in 6 lists`], ["Keys", [keys.web && "Website", keys.mail && "Inbound email"].filter(Boolean).join(", ") || "Later"],
  ];
  const slugColor = slug === "empty" ? "var(--pl-text-3)" : slug === "ok" ? "var(--pl-primary-text)" : "var(--pl-red)";

  return (
    <>
      <Link href="/platform/organisations" className="fb-pl-back">
        <ArrowLeft size={15} aria-hidden="true" />
        Organisations
      </Link>
      <div className="fb-pl-title-row">
        <h1 className="fb-pl-h1">Provision organisation</h1>
        <ReleaseTag release="V1.1" />
      </div>
      
      <ol className="fb-pl-steps" aria-label="Steps">
        {[...WIZARD_STEPS, "Done"].map((l, i) => (
          <li key={l} className="fb-pl-step" aria-current={i === step ? "step" : undefined} data-done={i < step}>
            <span className="fb-pl-step-n">{i < step ? "✓" : i + 1}</span>
            {l}
          </li>
        ))}
      </ol>

      <section className="fb-pl-wizard">
        {step === 0 ? (
          <>
            <label className="fb-pl-field">
              <span className="fb-pl-label">Organisation name</span>
              <input className="fb-pl-input" value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Kilimani Property Group" style={{ height: 42 }} />
            </label>
            <label className="fb-pl-field">
              <span className="fb-pl-label">Slug</span>
              <input className="fb-pl-input fb-pl-mono" value={form.slug} onChange={(e) => set("slug")(e.target.value)} style={{ height: 42, fontSize: 13 }} aria-describedby="pl-slug-msg" />
              <span id="pl-slug-msg" className="fb-pl-small" style={{ fontWeight: 600, color: slugColor }}>{SLUG_MESSAGES[slug]}</span>
            </label>
          </>
        ) : null}
        {step === 1 ? (
          <div className="fb-pl-two">
            <label className="fb-pl-field">
              <span className="fb-pl-label">Time zone</span>
              <select className="fb-pl-select" value={form.tz} onChange={(e) => set("tz")(e.target.value)} style={{ height: 42 }}>
                {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="fb-pl-field">
              <span className="fb-pl-label">Default currency</span>
              <select className="fb-pl-select" value={form.cur} onChange={(e) => set("cur")(e.target.value)} style={{ height: 42 }}>
                {CURRENCIES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        {step === 2 ? (
          <label className="fb-pl-field">
            <span className="fb-pl-label">First admin’s email</span>
            <input className="fb-pl-input" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@company.co.ke" style={{ height: 42 }} aria-describedby="pl-email-msg" />
            <span id="pl-email-msg" className="fb-pl-small" style={{ color: emailIsInvited(form.email) ? "var(--pl-red)" : "var(--pl-text-3)" }}>
              {emailIsInvited(form.email) ? "Already invited to another organisation." : "They get a Management role invite. Management is the organisation admin."}
            </span>
          </label>
        ) : null}
        {step === 3 ? (
          <>
            <p className="fb-pl-muted2" style={{ margin: 0, fontSize: 13.5 }}>The organisation starts with these lists. Edit any of them now; Management can change them later.</p>
            {Object.entries(lists).map(([name, items]) => (
              <div key={name} className="fb-pl-list-box">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 14 }}>{name}</strong>
                  <span className="fb-pl-muted fb-pl-small">{items.length} items</span>
                </div>
                <div className="fb-pl-chips">
                  {items.map((it, i) => (
                    <span key={`${it}-${i}`} className="fb-pl-chip">
                      {it}
                      <button type="button" aria-label={`Remove ${it} from ${name}`} onClick={() => setLists((l) => ({ ...l, [name]: items.filter((_, j) => j !== i) }))}>
                        <X size={11} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : null}
        {step === 4 ? (
          <>
            {([["web", "Create the website key now", "For the website enquiry form. Can be created later in the organisation’s settings."], ["mail", "Create the inbound email key now", "Forward-to address for enquiries."]] as const).map(([k, l, d]) => (
              <label key={k} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={keys[k]} onChange={() => setKeys((x) => ({ ...x, [k]: !x[k] }))} style={{ width: 17, height: 17, marginTop: 2, accentColor: "#7650b0" }} />
                <span>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{l}</span>
                  <span className="fb-pl-muted2" style={{ display: "block", fontSize: 12.5 }}>{d}</span>
                </span>
              </label>
            ))}
          </>
        ) : null}
        {step === 5 ? (
          <>
            <dl className="fb-pl-dl" style={{ fontSize: 14, gap: "10px 18px" }}>
              {review.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <label className="fb-pl-check fb-pl-muted2" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={simFail} onChange={() => setSimFail((x) => !x)} />
              Make seeding fail
            </label>
          </>
        ) : null}
        {step === 6 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
            <div className="fb-pl-done-icon"><CheckCircle2 size={24} aria-hidden="true" /></div>
            <h2 style={{ fontSize: 20 }}>{form.name} is ready</h2>
            <p className="fb-pl-muted2" style={{ margin: 0, fontSize: 14 }}>
              Invite sent to <strong>{form.email}</strong> as Management. Status: <strong>Pending acceptance</strong> (expires in 7 days).
            </p>
            <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
              <code className="fb-pl-code">https://crm.figbloom.co.ke/invite/{form.slug}-7Kx2</code>
              <button type="button" className="fb-pl-btn" onClick={() => toast("Invite link copied")}>Copy link</button>
            </div>
            <button type="button" className="fb-pl-btn fb-pl-btn--primary" onClick={() => createdId && router.push(`/platform/organisations/${createdId}`)}>
              Open organisation
            </button>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="fb-pl-alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        {step < 6 ? (
          <div className="fb-pl-wizard-nav">
            <button type="button" className="fb-pl-btn" disabled={step === 0} onClick={() => { setStep(Math.max(0, step - 1)); setError(""); }}>Back</button>
            <button type="button" className="fb-pl-btn fb-pl-btn--primary" onClick={next}>{step === 5 ? "Create organisation" : "Continue"}</button>
          </div>
        ) : null}
      </section>
    </>
  );
}
