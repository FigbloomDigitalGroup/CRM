"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, EmptyState, Input, Select, Textarea } from "../..";
import { describeError } from "../../errors";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, useReport } from "./kit";
import { ReferenceList, type RefValue } from "./ReferenceData";

/* Message templates ------------------------------------------------------------------------------------------------------------ */

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
}

const SAMPLE: Record<string, string> = { "contact.firstName": "Amara", "contact.lastName": "Osei", "contact.fullName": "Amara Osei", "contact.email": "amara@example.co.ke", "contact.jobTitle": "Operations manager", "company.name": "Brookside Dairy", "company.website": "brookside.example", "owner.name": "Dev Sales", "sender.name": "Dev Sales" };
const fill = (text: string) => text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (m, k: string) => SAMPLE[k] ?? m);

/**
 * Message templates (S5#2, FIG-1109): reusable emails for Send and log email. A template in use is hidden, not deleted, so old messages keep their
 * wording; a hidden one leaves the pickers. The preview fills the merge fields with a sample person.
 */
export function MessageTemplates() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getEmailTemplates", { params: { orgSlug }, query: { includeInactive: "true" } });
  const items = asArray<Template>(q.data?.items);
  const fields = asArray<string>(q.data?.mergeFields);
  const [picked, setPicked] = useState<string | "new" | null>(null);
  const current = picked === "new" ? null : (items.find((t) => t.id === picked) ?? items[0] ?? null);
  const creating = picked === "new";
  return (
    <>
      <Panel
        title="Message templates"
        description="Reusable emails for sending and logging. Merge fields fill in the person’s details when the message is written."
        actions={<Button variant="primary" onClick={() => setPicked("new")}>New template</Button>}
      />
      <Gate q={q} area="Message templates">
        {items.length === 0 && !creating ? (
          <EmptyState title="No templates yet" body="Write the messages you send again and again once, then pick them when you send." action={<Button variant="primary" onClick={() => setPicked("new")}>New template</Button>} />
        ) : (
          <div className="fb-set-split">
            <ul className="fb-set-list" aria-label="Templates" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((t) => (
                <li key={t.id}>
                  <button type="button" aria-current={!creating && current?.id === t.id ? "true" : undefined} onClick={() => setPicked(t.id)}>
                    <span style={{ display: "block", fontWeight: 600 }}>{t.name}{t.isActive ? "" : " (hidden)"}</span>
                    <span className="fb-set-muted">{t.subject}</span>
                  </button>
                </li>
              ))}
            </ul>
            <TemplateEditor key={creating ? "new" : (current?.id ?? "none")} template={creating ? null : current} fields={fields} onSaved={(id) => setPicked(id)} />
          </div>
        )}
      </Gate>
    </>
  );
}

function TemplateEditor({ template, fields, onSaved }: { template: Template | null; fields: string[]; onSaved: (id: string) => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const [form, setForm] = useState({ name: template?.name ?? "", subject: template?.subject ?? "", body: template?.body ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getEmailTemplates"] });

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      if (template) {
        await api.call("patchEmailTemplatesByTemplateId", { params: { orgSlug, templateId: template.id }, body: form });
        onSaved(template.id);
      } else {
        const made = await api.call("postEmailTemplates", { params: { orgSlug }, body: form });
        onSaved(made.id);
      }
      report.ok("Template saved.");
      await refresh();
    } catch (e) {
      setErrors(Object.fromEntries(describeError(e).fieldErrors.map((f) => [f.path, f.message])));
      report.fail(e, "The template did not save");
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!template) return;
    try {
      await api.call("patchEmailTemplatesByTemplateId", { params: { orgSlug, templateId: template.id }, body: { isActive: !template.isActive } });
      report.ok(template.isActive ? "Template hidden. It stays on messages already sent." : "Template is back in the pickers.");
      await refresh();
    } catch (e) {
      report.fail(e, "That did not change");
    }
  }

  return (
    <Panel>
      <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors["name"]} />
      <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} error={errors["subject"]} />
      <Textarea label="Message" rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} error={errors["body"]} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="fb-set-muted">Insert:</span>
        {fields.map((f) => (
          <Button key={f} size="sm" variant="secondary" onClick={() => setForm({ ...form, body: `${form.body}{{${f}}}` })}>{`{{${f}}}`}</Button>
        ))}
      </div>
      <div>
        <span className="fb-set-muted" style={{ textTransform: "uppercase", fontSize: 10.5, letterSpacing: "0.08em" }}>Preview · Amara Osei</span>
        <div className="fb-set-preview" aria-label="Preview" style={{ marginTop: 6 }}>{form.subject ? <strong>{fill(form.subject)}{"\n"}</strong> : null}{fill(form.body)}</div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {template ? <Button variant="ghost" onClick={() => void toggle()}>{template.isActive ? "Hide template" : "Show template"}</Button> : null}
        <Button variant="primary" loading={busy} disabledReason={form.name && form.subject && form.body ? undefined : "A name, subject and message are needed."} onClick={() => void save()}>Save template</Button>
      </div>
    </Panel>
  );
}

/* Tags ------------------------------------------------------------------------------------------------------------------------- */

interface TagRow {
  id: string;
  name: string;
  colour: string;
}

/**
 * Tags (S5#2, FIG-1109): hide, don't delete. A hidden tag cannot be added to a record and leaves the pickers; records that already carry it keep it.
 * Two tags that mean the same thing can be merged, which moves every record to the one you keep.
 */
export function TagManager() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getTags", { params: { orgSlug }, query: { includeHidden: "true" } });
  const colours = new Map(asArray<TagRow>(q.data?.items).map((t) => [t.id, t.colour]));
  return (
    <Panel title="Tags" description="Labels people put on leads, contacts, companies and deals. Hidden tags stay on the records that already carry them.">
      <ReferenceList
        kind="tags"
        noun="tag"
        addLabel="New tag"
        decorate={(v) => {
          const c = colours.get(v.id);
          return <span className="fb-set-tag" style={{ background: c ? `${c}22` : "var(--surface-3)", color: "var(--text)", border: `1px solid ${c ?? "var(--border)"}` }}>{v.name}</span>;
        }}
        extraEdit={(v, done) => <TagColour tag={v} colour={colours.get(v.id) ?? "#275B3A"} done={done} />}
      />
    </Panel>
  );
}

function TagColour({ tag, colour, done }: { tag: RefValue; colour: string; done: () => void }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const [value, setValue] = useState(colour);
  useEffect(() => setValue(colour), [colour]);
  const save = useApiMutation("patchTagsByTagId", { onSuccess: () => { report.ok("Colour saved."); done(); }, onError: (e) => report.fail(e, "The colour did not save") });
  return (
    <div className="fb-set-inline" style={{ marginTop: 12 }}>
      <Input label="Colour" type="color" value={value} onChange={(e) => setValue(e.target.value)} style={{ padding: 2, maxWidth: 80 }} />
      <Button onClick={() => save.mutate({ params: { orgSlug, tagId: tag.id }, body: { colour: value } })}>Save colour</Button>
    </div>
  );
}

/* Custom fields ---------------------------------------------------------------------------------------------------------------- */

interface FieldDef {
  id: string;
  entityType: string;
  section: string;
  key: string;
  label: string;
  fieldType: string;
  options: { value: string; label: string }[] | null;
  helpText: string | null;
  required: boolean;
  requiredOnQualify: boolean;
  serviceId: string | null;
  isActive: boolean;
}

const ENTITY: [string, string][] = [["LEAD", "Leads"], ["CONTACT", "Contacts"], ["COMPANY", "Companies"], ["DEAL", "Deals"]];
const TYPES: [string, string][] = [["TEXT", "Text"], ["NUMBER", "Number"], ["DATE", "Date"], ["SELECT", "Pick one"], ["MULTISELECT", "Pick several"], ["BOOLEAN", "Yes or no"]];
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 50);

/**
 * Custom fields (S5#2, FIG-1109): extra questions on leads, contacts, companies and deals. Required fields are only enforced when a lead is qualified,
 * never at quick capture. A hidden field leaves the forms and stays on the records that have a value. Who may see a field follows who may see the record
 * it sits on; the API has no separate per-role switch for fields in V1, so none is offered here.
 */
export function CustomFields() {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const q = useApiQuery("getCustomFields", { params: { orgSlug }, query: { includeInactive: "true" } });
  const ref = useApiQuery("getReferenceData", { params: { orgSlug } });
  const fields = asArray<FieldDef>(q.data?.items);
  const [editing, setEditing] = useState<FieldDef | "new" | null>(null);
  const services = asArray<{ id: string; name: string }>(ref.data?.services);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getCustomFields"] });

  async function patch(f: FieldDef, body: object, done: string) {
    try {
      await api.call("patchCustomFieldsByFieldId", { params: { orgSlug, fieldId: f.id }, body: body as never });
      report.ok(done);
    } catch (e) {
      report.fail(e, "The field did not change");
    } finally {
      await refresh();
    }
  }

  return (
    <>
      <Panel flush title="Custom fields" description="Extra questions on your records. Required fields are only enforced when a lead is qualified, never at quick capture." actions={<Button variant="primary" onClick={() => setEditing("new")}>New field</Button>}>
        <Gate q={q} area="Custom fields">
          {fields.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">No custom fields yet.</span></div> : (
            <div className="fb-set-tablewrap">
              <table className="fb-set-table">
                <thead><tr><th scope="col">Field</th><th scope="col">Applies to</th><th scope="col">Type</th><th scope="col">Service</th><th scope="col">Required</th><th scope="col"><span className="fb-sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.id} style={{ opacity: f.isActive ? 1 : 0.65 }}>
                      <td style={{ fontWeight: 600 }}>{f.label}{f.isActive ? "" : <span className="fb-set-pill" style={{ marginLeft: 8 }}>Hidden</span>}</td>
                      <td>{ENTITY.find(([k]) => k === f.entityType)?.[1] ?? f.entityType}{f.section === "QUALIFICATION" ? " · qualification" : ""}</td>
                      <td>{TYPES.find(([k]) => k === f.fieldType)?.[1] ?? f.fieldType}</td>
                      <td style={{ color: "var(--text-2)" }}>{services.find((s) => s.id === f.serviceId)?.name ?? "All"}</td>
                      <td><Checkbox label={<span className="fb-sr-only">{`${f.label} is required`}</span>} checked={f.requiredOnQualify || f.required} onChange={(e) => void patch(f, f.section === "QUALIFICATION" ? { requiredOnQualify: e.target.checked } : { required: e.target.checked }, `${f.label} ${e.target.checked ? "is now required" : "is optional"}.`)} /></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Button size="sm" onClick={() => setEditing(f)} aria-label={`Edit ${f.label}`}>Edit</Button>{" "}
                        <Button size="sm" variant="ghost" aria-label={`${f.isActive ? "Hide" : "Show"} ${f.label}`} onClick={() => void patch(f, { isActive: !f.isActive }, f.isActive ? `${f.label} hidden. It stays on records that have a value.` : `${f.label} is back on the forms.`)}>{f.isActive ? "Hide" : "Show"}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Gate>
      </Panel>
      {editing ? <FieldDialog field={editing === "new" ? null : editing} services={services} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} /> : null}
    </>
  );
}

function FieldDialog({ field, services, onClose, onSaved }: { field: FieldDef | null; services: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const report = useReport();
  const [form, setForm] = useState({
    entityType: field?.entityType ?? "LEAD",
    label: field?.label ?? "",
    fieldType: field?.fieldType ?? "TEXT",
    options: (field?.options ?? []).map((o) => o.label).join("\n"),
    helpText: field?.helpText ?? "",
    required: field?.required ?? false,
    requiredOnQualify: field?.requiredOnQualify ?? false,
    qualification: field?.section === "QUALIFICATION",
    serviceId: field?.serviceId ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const picks = form.fieldType === "SELECT" || form.fieldType === "MULTISELECT";
  const options = form.options.split("\n").map((s) => s.trim()).filter(Boolean).map((label) => ({ label, value: slug(label) || label }));

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      if (field) {
        await api.call("patchCustomFieldsByFieldId", { params: { orgSlug, fieldId: field.id }, body: { label: form.label, helpText: form.helpText || null, required: form.required, requiredOnQualify: form.requiredOnQualify, serviceId: form.serviceId || null, ...(picks ? { options } : {}) } });
      } else {
        await api.call("postCustomFields", { params: { orgSlug }, body: { entityType: form.entityType as "LEAD", key: slug(form.label), label: form.label, fieldType: form.fieldType as "TEXT", helpText: form.helpText || null, required: form.required, section: form.qualification && form.entityType === "LEAD" ? "QUALIFICATION" : "GENERAL", requiredOnQualify: form.requiredOnQualify, serviceId: form.serviceId || null, ...(picks ? { options } : {}) } });
      }
      report.ok(field ? "Field saved." : "Field added.");
      onSaved();
    } catch (e) {
      setErrors(Object.fromEntries(describeError(e).fieldErrors.map((f) => [f.path.replace(/^body\./, ""), f.message])));
      report.fail(e, "The field did not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={field ? `Edit ${field.label}` : "New custom field"} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabledReason={form.label.trim() ? undefined : "Give the field a label."} onClick={() => void save()}>Save field</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Input label="Label" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} error={errors["label"] ?? errors["key"]} />
        <Select label="Applies to" value={form.entityType} disabledReason={field ? "A field stays on the kind of record it was made for." : undefined} onChange={(e) => setForm({ ...form, entityType: e.target.value })} options={ENTITY.map(([v, l]) => ({ value: v, label: l }))} />
        <Select label="Type" value={form.fieldType} disabledReason={field ? "The type cannot change once records have values." : undefined} onChange={(e) => setForm({ ...form, fieldType: e.target.value })} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} />
        {picks ? <Textarea label="Choices" rows={4} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} help="One choice per line." error={errors["options"]} /> : null}
        <Input label="Help text" value={form.helpText} onChange={(e) => setForm({ ...form, helpText: e.target.value })} />
        <Select label="Only for service" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })} placeholder="All services" options={services.map((s) => ({ value: s.id, label: s.name }))} />
        {form.entityType === "LEAD" && !field ? <Checkbox label="A qualification question (asked while qualifying a lead)" checked={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.checked })} /> : null}
        <Checkbox label="Required" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
        {form.entityType === "LEAD" ? <Checkbox label="Required to qualify a lead" checked={form.requiredOnQualify} onChange={(e) => setForm({ ...form, requiredOnQualify: e.target.checked })} /> : null}
      </div>
    </Dialog>
  );
}
