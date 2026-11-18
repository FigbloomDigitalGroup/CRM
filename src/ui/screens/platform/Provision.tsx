"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReleaseTag } from "./kit";
import { applyWizardField, EMPTY_WIZARD, SLUG_MESSAGES, slugState, WIZARD_STEPS, wizardStepError, type WizardForm } from "./logic";
import { usePlatform } from "./store";

interface DefaultsPreview {
  timezone: string;
  defaultCurrency: string;
  firstUserRole: string;
  catalogues: Record<string, string[] | number>;
  note: string;
}
interface SlugCheck {
  available: boolean;
  message: string | null;
  suggestion: string | null;
}

const CATALOGUE_LABELS: Record<string, string> = {
  leadSources: "Lead sources",
  leadStatuses: "Lead statuses",
  pipelineStages: "Pipeline stages",
  customerLifecycleStates: "Customer lifecycle",
  lostReasons: "Lost reasons",
  services: "Services",
};

/** PL3 Provision organisation: name, first admin, the defaults it starts with, review, done. Provisioning is all-or-nothing (a failed seed creates nothing). */
export function ProvisionWizard() {
  const { state, actions, call } = usePlatform();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(EMPTY_WIZARD);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const defaults = useQuery({ queryKey: ["platform", "defaults-preview"], queryFn: () => call<DefaultsPreview>("GET", "/api/platform/organizations/defaults-preview"), enabled: step >= 2 });

  const taken = state.orgs.map((o) => o.slug);
  const slug = slugState(form.slug, taken);
  const set = (k: keyof WizardForm) => (v: string) => {
    setForm((f) => applyWizardField(f, k, v));
    setError("");
  };

  async function next() {
    const err = wizardStepError(step, form, taken);
    if (err) return setError(err);
    setBusy(true);
    try {
      if (step === 0) {
        try {
          const check = await call<SlugCheck>("GET", `/api/platform/organizations/slug-check?slug=${encodeURIComponent(form.slug.trim())}`);
          if (!check.available) {
            setError(`${check.message ?? "That slug can’t be used."}${check.suggestion ? ` Try ${check.suggestion}.` : ""}`);
            return;
          }
        } catch {
          // The check is a convenience; provisioning checks the slug again and says why if it is refused.
        }
      }
      if (step === 3) {
        const res = await actions.provision(form);
        if (!res.ok) return setError(res.message);
        setCreatedId(res.id ?? null);
      }
      setError("");
      setStep(step + 1);
    } finally {
      setBusy(false);
    }
  }

  const cats = defaults.data?.catalogues ?? {};
  const lists = Object.entries(CATALOGUE_LABELS).map(([k, label]) => [label, Array.isArray(cats[k]) ? (cats[k] as string[]) : []] as const);
  const review: [string, string][] = [
    ["Name", form.name], ["Slug", form.slug], ["First admin", `${form.ownerName} · ${form.email} (Management)`],
    ["Starts with", defaults.data ? `${defaults.data.timezone}, ${defaults.data.defaultCurrency}, default lists` : "default lists"],
  ];
  const slugColor = slug === "empty" ? "var(--pl-text-3)" : slug === "ok" ? "var(--pl-primary-text)" : "var(--pl-red)";
  const DONE = WIZARD_STEPS.length;

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
          <>
            <label className="fb-pl-field">
              <span className="fb-pl-label">First admin’s name</span>
              <input className="fb-pl-input" value={form.ownerName} onChange={(e) => set("ownerName")(e.target.value)} placeholder="e.g. Amina Yusuf" style={{ height: 42 }} />
            </label>
            <label className="fb-pl-field">
              <span className="fb-pl-label">First admin’s email</span>
              <input className="fb-pl-input" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@company.co.ke" style={{ height: 42 }} aria-describedby="pl-email-msg" />
              <span id="pl-email-msg" className="fb-pl-small" style={{ color: "var(--pl-text-3)" }}>They get a Management role invite. Management is the organisation admin.</span>
            </label>
          </>
        ) : null}
        {step === 2 ? (
          <>
            {defaults.isLoading ? <div role="status" aria-label="Loading defaults" className="fb-pl-skel" /> : null}
            {defaults.error ? <div role="alert" className="fb-pl-alert"><AlertTriangle size={16} aria-hidden="true" />The defaults couldn’t be loaded. You can still continue; the organisation starts with the standard lists.</div> : null}
            {defaults.data ? (
              <>
                <p className="fb-pl-muted2" style={{ margin: 0, fontSize: 13.5 }}>{defaults.data.note} Time zone {defaults.data.timezone}, currency {defaults.data.defaultCurrency}.</p>
                {lists.map(([name, items]) => (
                  <div key={name} className="fb-pl-list-box">
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong style={{ fontSize: 14 }}>{name}</strong>
                      <span className="fb-pl-muted fb-pl-small">{items.length} items</span>
                    </div>
                    <div className="fb-pl-chips">
                      {items.map((it) => <span key={it} className="fb-pl-chip">{it}</span>)}
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </>
        ) : null}
        {step === 3 ? (
          <dl className="fb-pl-dl" style={{ fontSize: 14, gap: "10px 18px" }}>
            {review.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {step === DONE ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
            <div className="fb-pl-done-icon"><CheckCircle2 size={24} aria-hidden="true" /></div>
            <h2 style={{ fontSize: 20 }}>{form.name} is ready</h2>
            <p className="fb-pl-muted2" style={{ margin: 0, fontSize: 14 }}>
              An invite was emailed to <strong>{form.email}</strong> as Management. Status: <strong>Pending acceptance</strong>.
            </p>
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
        {step < DONE ? (
          <div className="fb-pl-wizard-nav">
            <button type="button" className="fb-pl-btn" disabled={step === 0 || busy} onClick={() => { setStep(Math.max(0, step - 1)); setError(""); }}>Back</button>
            <button type="button" className="fb-pl-btn fb-pl-btn--primary" disabled={busy} onClick={() => void next()}>{step === 3 ? "Create organisation" : "Continue"}</button>
          </div>
        ) : null}
      </section>
    </>
  );
}
