"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button, useMember, useToast } from "@/ui";
import { Switch } from "../settings/kit";
import { formFields as seed } from "./demo/data";
import { EditorFrame, recordAudit } from "./kit";
import { embedCode, validateForm, type FormField } from "./model";

/**
 * Web forms (S6#2, FIG-1174): a hosted enquiry form for figbloom.co.ke or a landing page. Submissions become leads with an owner. Name and email
 * are always on. The embed code copies as plain text and the preview shows exactly the fields chosen.
 */
export function WebFormsEditor() {
  const { userName, can } = useMember();
  const toast = useToast();
  const [saved, setSaved] = useState<FormField[]>(seed);
  const [fields, setFields] = useState<FormField[]>(seed);
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const added = fields.filter((f) => f.on && !saved.find((s) => s.key === f.key)?.on).map((f) => f.label);
  const removed = fields.filter((f) => !f.on && saved.find((s) => s.key === f.key)?.on).map((f) => f.label);
  const impact = [
    ...(added.length ? [`The form will ask for ${added.join(", ")}.`] : []),
    ...(removed.length ? [`The form will stop asking for ${removed.join(", ")}. Enquiries already received keep what they have.`] : []),
    ...(added.length || removed.length ? ["The embed code does not change; the live form updates within a minute."] : []),
  ];
  const mayEdit = can("configuration.manage");

  async function copy() {
    try {
      await navigator.clipboard.writeText(embedCode());
      toast.show({ message: "Copied to clipboard", tone: "success" });
    } catch {
      toast.show({ message: "Could not copy. Select the code and copy it by hand.", tone: "danger" });
    }
  }

  return (
    <EditorFrame
      area="WebForms"
      title="Web forms"
      description="A hosted enquiry form for figbloom.co.ke or a landing page. Submissions become leads with an owner."
      release="v1.1"
      dirty={dirty}
      errors={validateForm(fields)}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management edits web forms"}
      onDiscard={() => setFields(saved)}
      onSave={() => {
        recordAudit("WebForms", "Web form changed", impact[0] ?? "Fields updated", userName);
        setSaved(fields);
      }}
    >
      <div className="fb-sp-twocol">
        <div className="fb-sp-stack">
          <h3 className="fb-set-panel__title">Fields on the form</h3>
          {fields.map((f, i) => (
            <div key={f.key} className="fb-sp-toggle">
              <Switch checked={f.on} label={f.label} disabled={f.locked || !mayEdit} disabledReason={f.locked ? "Every enquiry needs this" : undefined} onChange={(on) => setFields(fields.map((x, j) => (j === i ? { ...x, on } : x)))} />
              <span>{f.label}</span>
              {f.note ? <span className="fb-set-muted">{f.note}</span> : null}
            </div>
          ))}
          <div className="fb-com-eyebrow">Embed code</div>
          <div className="fb-set-keyrow">
            <code className="fb-set-code" aria-label="Embed code">{embedCode()}</code>
            <Button onClick={() => void copy()}><Copy size={15} aria-hidden="true" /> Copy code</Button>
          </div>
        </div>
        <div className="fb-sp-preview" aria-label="Live preview">
          <div className="fb-com-eyebrow">Live preview · as it appears on figbloom.co.ke</div>
          <div className="fb-sp-preview__form">
            <strong>Talk to us about your project</strong>
            {fields.filter((f) => f.on).map((f) => <input key={f.key} className="fb-input" placeholder={f.label} aria-label={`${f.label} (preview)`} readOnly />)}
            <button type="button" className="fb-btn fb-btn--primary" tabIndex={-1}>Send enquiry</button>
            <span className="fb-set-muted">We use your details only to reply to this enquiry.</span>
          </div>
        </div>
      </div>
    </EditorFrame>
  );
}
