"use client";

import { Copy, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, LoadingState, useApiMutation, useApiQuery, useMember, useToast } from "@/ui";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { Switch } from "../settings/kit";
import { EditorFrame } from "./kit";
import { applyChoices, choicesFor, validateFormChoices, type FieldChoice, type SubmissionView, type WebFormView } from "./webFormsModel";

/**
 * Web forms (S6#2, FIG-1174), on `GET/POST/PATCH /web-forms` (B6.19, docs/WEB_FORMS.md): a hosted enquiry form for figbloom.co.ke or a landing page.
 * Submissions become leads with an owner (the existing assignment rules); a form never moves a stage or sets a discount. Name is always on, and a form
 * needs an email or a phone. The form address copies as plain text and the preview shows exactly the fields chosen. Only Management edits forms.
 */
interface Draft {
  name: string;
  published: boolean;
  choices: FieldChoice[];
}

export function WebFormsEditor() {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const list = useApiQuery("getWebForms", { params: { orgSlug } });
  const create = useApiMutation("postWebForms", { invalidate: [["getWebForms"]] });
  const [pick, setPick] = useState<string | null>(null);
  const mayEdit = can("configuration.manage");

  if (list.isLoading) return <LoadingState label="Loading web forms" />;
  if (list.error || !list.data) return <QueryFailure error={list.error} area="Web forms" onRetry={() => void list.refetch()} />;

  const forms = (list.data as unknown as { items: WebFormView[] }).items;
  const form = forms.find((f) => f.id === pick) ?? forms[0];

  async function add() {
    try {
      const made = (await create.mutateAsync({ params: { orgSlug }, body: { name: forms.length ? `Web form ${forms.length + 1}` : "Website enquiry" } } as never)) as unknown as WebFormView;
      setPick(made.id);
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
    }
  }

  if (!form) {
    return (
      <EmptyState
        title="No web forms yet"
        body="A web form lets visitors send an enquiry that becomes a lead with an owner."
        action={mayEdit ? <Button variant="primary" onClick={() => void add()}><Plus size={15} aria-hidden="true" /> Create a form</Button> : undefined}
      />
    );
  }
  return <FormEditor key={form.id} form={form} forms={forms} onPick={setPick} onNew={() => void add()} />;
}

function FormEditor({ form, forms, onPick, onNew }: { form: WebFormView; forms: WebFormView[]; onPick: (id: string) => void; onNew: () => void }) {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const mayEdit = can("configuration.manage");
  const patch = useApiMutation("patchWebFormsByFormId", { invalidate: [["getWebForms"]] });
  const rotate = useApiMutation("postWebFormsByFormIdRotateKey", { invalidate: [["getWebForms"]] });
  const subs = useApiQuery("getWebFormsByFormIdSubmissions", { params: { orgSlug, formId: form.id }, query: { pageSize: "8" } });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rotating, setRotating] = useState(false);

  const savedChoices = choicesFor(form.fields);
  const current: Draft = draft ?? { name: form.name, published: form.status === "PUBLISHED", choices: savedChoices };
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify({ name: form.name, published: form.status === "PUBLISHED", choices: savedChoices });
  const added = current.choices.filter((c) => c.on && !savedChoices.find((s) => s.key === c.key)?.on).map((c) => c.label);
  const removed = current.choices.filter((c) => !c.on && savedChoices.find((s) => s.key === c.key)?.on).map((c) => c.label);
  const wasPublished = form.status === "PUBLISHED";
  const impact = [
    ...(added.length ? [`The form will ask for ${added.join(", ")}.`] : []),
    ...(removed.length ? [`The form will stop asking for ${removed.join(", ")}. Enquiries already received keep what they have.`] : []),
    ...(current.published !== wasPublished ? [current.published ? "The form goes live: submissions become leads." : "The form is switched off: visitors get no form and nothing new comes in."] : []),
    ...(current.name !== form.name ? [`The form is renamed “${current.name}”.`] : []),
  ];
  const errors = [...validateFormChoices(current.choices), ...(current.name.trim() ? [] : ["Give the form a name."])];
  const address = `${typeof window === "undefined" ? "" : window.location.origin}/api/public/orgs/${orgSlug}/forms/${form.publicKey}/submissions`;

  async function onSave() {
    try {
      await patch.mutateAsync({ params: { orgSlug, formId: form.id }, body: { name: current.name.trim(), status: current.published ? "PUBLISHED" : "DRAFT", fields: applyChoices(form.fields, current.choices) } } as never);
      setDraft(null);
      return true;
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
      return false;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      toast.show({ message: "Copied to clipboard", tone: "success" });
    } catch {
      toast.show({ message: "Could not copy. Select the address and copy it by hand.", tone: "danger" });
    }
  }

  async function newKey() {
    try {
      await rotate.mutateAsync({ params: { orgSlug, formId: form.id } } as never);
      toast.show({ message: "New form address created. Update the website that uses this form.", tone: "success" });
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
    }
    setRotating(false);
  }

  const submissions = (subs.data as unknown as { items?: SubmissionView[] } | undefined)?.items ?? [];

  return (
    <EditorFrame
      area="WebForms"
      title="Web forms"
      description="A hosted enquiry form for figbloom.co.ke or a landing page. Submissions become leads with an owner."
      release="v1.1"
      dirty={dirty}
      errors={errors}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management edits web forms"}
      actions={
        <span style={{ display: "inline-flex", gap: 8 }}>
          {forms.length > 1 ? (
            <select className="fb-input" aria-label="Choose a form" value={form.id} onChange={(e) => onPick(e.target.value)}>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : null}
          <Button disabled={!mayEdit} onClick={onNew}><Plus size={15} aria-hidden="true" /> New form</Button>
        </span>
      }
      onDiscard={() => setDraft(null)}
      onSave={onSave}
    >
      <div className="fb-sp-twocol">
        <div className="fb-sp-stack">
          <input className="fb-input" value={current.name} aria-label="Form name" readOnly={!mayEdit} onChange={(e) => setDraft({ ...current, name: e.target.value })} />
          <div className="fb-sp-toggle">
            <Switch checked={current.published} label="Published" disabled={!mayEdit} onChange={(published) => setDraft({ ...current, published })} />
            <span>{current.published ? "Published" : "Draft: the form is not live"}</span>
          </div>
          <h3 className="fb-set-panel__title">Fields on the form</h3>
          {current.choices.map((c, i) => (
            <div key={c.key} className="fb-sp-toggle">
              <Switch checked={c.on} label={c.label} disabled={c.locked || !mayEdit} disabledReason={c.locked ? "Every enquiry needs this" : undefined} onChange={(on) => setDraft({ ...current, choices: current.choices.map((x, j) => (j === i ? { ...x, on } : x)) })} />
              <span>{c.label}</span>
              {c.note ? <span className="fb-set-muted">{c.note}</span> : null}
            </div>
          ))}
          <div className="fb-com-eyebrow">Form address</div>
          <div className="fb-set-keyrow">
            <code className="fb-set-code" aria-label="Form address">{address}</code>
            <Button onClick={() => void copy()}><Copy size={15} aria-hidden="true" /> Copy address</Button>
            <Button disabled={!mayEdit} onClick={() => setRotating(true)}><RefreshCw size={15} aria-hidden="true" /> New address</Button>
          </div>
          <div className="fb-com-eyebrow">Recent submissions</div>
          {subs.isLoading ? <LoadingState label="Loading submissions" lines={2} /> : null}
          {subs.error ? <p className="fb-set-muted">The submission log could not be loaded.</p> : null}
          {subs.data && submissions.length === 0 ? <p className="fb-set-muted">No submissions yet.</p> : null}
          {submissions.length ? (
            <ul aria-label="Recent submissions">
              {submissions.map((s) => (
                <li key={s.id}>
                  <strong>{s.outcome === "ACCEPTED" ? "Lead created" : "Not accepted"}</strong> · {s.explanation ?? s.outcome}
                  {s.duplicateWarning ? " Already known to us." : ""} <span className="fb-set-muted">· {new Date(s.at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="fb-sp-preview" aria-label="Live preview">
          <div className="fb-com-eyebrow">Live preview · as it appears on the website</div>
          <div className="fb-sp-preview__form">
            <strong>Talk to us about your project</strong>
            {current.choices.filter((f) => f.on).map((f) => <input key={f.key} className="fb-input" placeholder={f.label} aria-label={`${f.label} (preview)`} readOnly />)}
            <button type="button" className="fb-btn fb-btn--primary" tabIndex={-1}>Send enquiry</button>
            <span className="fb-set-muted">We use your details only to reply to this enquiry.</span>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={rotating}
        onClose={() => setRotating(false)}
        title="Create a new form address?"
        body={<p>The old address stops working at once. The website that uses this form must be updated with the new one.</p>}
        confirmLabel="Create new address"
        onConfirm={() => void newKey()}
      />
    </EditorFrame>
  );
}
