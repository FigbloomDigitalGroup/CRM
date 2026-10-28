"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { THEMES } from "@/preferences/catalogue";
import { Button, Checkbox, FormErrorSummary, Input, Select, fieldErrorMap } from "../..";
import { describeError } from "../../errors";
import { newIdempotencyKey, putSignedUpload } from "../../data/client";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, useReport } from "./kit";

const DAYS: [string, string][] = [["MON", "Mon"], ["TUE", "Tue"], ["WED", "Wed"], ["THU", "Thu"], ["FRI", "Fri"], ["SAT", "Sat"], ["SUN", "Sun"]];
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX = 2 * 1024 * 1024;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Organization profile (S1, AP9, FIG-1106): the basic profile and working hours, plus the shared look: the logo and display name everyone sees, the
 * default theme for new members and the lock that makes the whole organisation use one look. Text size, density and accessibility always stay personal.
 */
export function OrganisationProfile() {
  const { orgSlug } = useMember();
  const profile = useApiQuery("getProfile", { params: { orgSlug } });
  const look = useApiQuery("getOrganizationLook", { params: { orgSlug } });
  return (
    <>
      <Gate q={profile} area="The organisation profile">{profile.data ? <ProfileForm initial={profile.data} /> : null}</Gate>
      <Gate q={look} area="The shared look" lines={3}>{look.data ? <LookForm initial={look.data} /> : null}</Gate>
    </>
  );
}

function ProfileForm({ initial }: { initial: NonNullable<ReturnType<typeof useApiQuery<"getProfile">>["data"]> }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const [form, setForm] = useState({
    name: initial.name,
    phone: str(initial.phone),
    website: str(initial.website),
    address: str(initial.address),
    timezone: initial.timezone,
    workingDays: initial.workingDays,
    start: str(initial.workingHoursStart),
    end: str(initial.workingHoursEnd),
  });
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const timezones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return all.includes(initial.timezone) ? all : [initial.timezone, ...all];
  }, [initial.timezone]);
  const save = useApiMutation("patchProfile", {
    invalidate: [["getProfile", { orgSlug }, null]],
    onSuccess: () => {
      setErrors([]);
      report.ok("Organisation profile saved.");
    },
    onError: (e) => {
      setErrors(describeError(e).fieldErrors);
      report.fail(e, "The profile did not save");
    },
  });
  const map = fieldErrorMap(errors);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Panel title="Organization profile" description="Basic tenant profile, defaults and working hours. Used for display and anything that reads this organisation’s timezone, currency or hours.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            params: { orgSlug },
            body: { name: form.name, phone: form.phone || null, website: form.website || null, address: form.address || null, timezone: form.timezone, workingDays: form.workingDays, workingHoursStart: form.start || null, workingHoursEnd: form.end || null },
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <FormErrorSummary errors={errors} />
        <div className="fb-set-cols">
          <Input label="Organisation name" required value={form.name} onChange={(e) => set("name", e.target.value)} error={map["name"]} />
          <Input label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+254 711 482 900" error={map["phone"]} />
          <Input label="Website" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="figbloom.co.ke" error={map["website"]} />
          <Input label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Westlands, Nairobi" error={map["address"]} />
          <Select label="Timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} options={timezones.map((z) => ({ value: z, label: z }))} error={map["timezone"]} />
          <Input label="Default currency" value={initial.defaultCurrency} readOnly help="Set when the organisation was created." />
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="fb-label">Working days</legend>
          <div className="fb-set-days" style={{ marginTop: 8 }}>
            {DAYS.map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={form.workingDays.includes(key)}
                onChange={(e) => set("workingDays", e.target.checked ? [...form.workingDays, key] : form.workingDays.filter((d) => d !== key))}
              />
            ))}
          </div>
          {map["workingDays"] ? <span className="fb-error" role="alert">{map["workingDays"]}</span> : null}
        </fieldset>
        <div className="fb-set-cols" style={{ maxWidth: 420 }}>
          <Input label="Working hours start" type="time" value={form.start} onChange={(e) => set("start", e.target.value)} error={map["workingHoursStart"]} />
          <Input label="Working hours end" type="time" value={form.end} onChange={(e) => set("end", e.target.value)} error={map["workingHoursEnd"]} />
        </div>
        <div>
          <Button type="submit" variant="primary" loading={save.isPending}>Save changes</Button>
        </div>
      </form>
    </Panel>
  );
}

function LookForm({ initial }: { initial: NonNullable<ReturnType<typeof useApiQuery<"getOrganizationLook">>["data"]> }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const file = useRef<HTMLInputElement>(null);
  const [look, setLook] = useState(initial);
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => setLook(initial), [initial]);

  const update = useApiMutation("updateOrganizationLook", {
    onSuccess: (data) => {
      setLook(data);
      void qc.invalidateQueries({ queryKey: ["getOrganizationLook", { orgSlug }, null] });
    },
    onError: (e) => report.fail(e, "The shared look did not save"),
  });

  async function pickLogo(f: File | undefined) {
    if (!f) return;
    setLogoError(null);
    if (!LOGO_TYPES.includes(f.type)) return setLogoError("A logo has to be a PNG, JPG or WebP picture.");
    if (f.size > LOGO_MAX) return setLogoError("That picture is larger than 2 MB. Choose a smaller one.");
    setUploading(true);
    try {
      const started = await api.call("createFileUpload", { params: { orgSlug }, body: { purpose: "LOGO", name: f.name, mimeType: f.type, sizeBytes: f.size }, idempotencyKey: newIdempotencyKey() });
      await putSignedUpload(started.upload, f);
      await api.call("completeFileUpload", { params: { orgSlug, fileId: started.file.id } });
      update.mutate({ params: { orgSlug }, body: { logoFileId: started.file.id } }, { onSuccess: () => report.ok("Logo updated for everyone.") } as never);
    } catch (e) {
      setLogoError(`The logo was not uploaded. ${describeError(e).body}`);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  const initials = (look.shownName || "FB").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <Panel title="Logo, name and shared look" description="Shown in everyone’s top bar. Without a logo, the Figbloom mark is used. Logo and name only; no custom domains or re-skinning.">
      <div className="fb-set-keyrow" style={{ alignItems: "center", gap: 14 }}>
        <span className="fb-set-logo" aria-hidden="true">{look.logoUrl ? <img src={look.logoUrl} alt="" /> : initials}</span>
        <input ref={file} type="file" accept={LOGO_TYPES.join(",")} hidden aria-label="Logo file" onChange={(e) => void pickLogo(e.target.files?.[0])} />
        <Button loading={uploading} onClick={() => file.current?.click()}>{look.logoUrl ? "Replace logo" : "Upload logo"}</Button>
        {look.logoUrl ? (
          <Button variant="ghost" onClick={() => update.mutate({ params: { orgSlug }, body: { logoFileId: null } }, { onSuccess: () => report.ok("Logo removed. The Figbloom mark shows instead.") } as never)}>
            Remove
          </Button>
        ) : null}
      </div>
      {logoError ? <span className="fb-error" role="alert">{logoError}</span> : <span className="fb-help">PNG, JPG or WebP, up to 2 MB.</span>}
      <div className="fb-set-inline" style={{ maxWidth: 520 }}>
        <Input label="Name shown in the top bar" value={displayName} placeholder={look.name} onChange={(e) => setDisplayName(e.target.value)} help="Leave empty to use the organisation name." />
        <Button onClick={() => update.mutate({ params: { orgSlug }, body: { displayName: displayName.trim() || null } }, { onSuccess: () => report.ok("Name saved.") } as never)}>Save name</Button>
      </div>
      <div style={{ maxWidth: 320 }}>
        <Select
          label="Default theme for new members"
          value={look.defaultTheme}
          options={THEMES.map((t) => ({ value: t.key, label: t.label }))}
          onChange={(e) => { const key = e.target.value; update.mutate({ params: { orgSlug }, body: { defaultTheme: key } }, { onSuccess: () => report.ok(`New members start with ${THEMES.find((t) => t.key === key)?.label ?? "that theme"}.`) } as never); }}
        />
      </div>
      <Checkbox
        label={
          <>
            <strong>Allow members to personalise their appearance</strong>
            <span className="fb-help" style={{ display: "block" }}>
              When off, everyone sees the default theme and “Your organisation uses a shared look.” Text size, density and accessibility always stay personal.
            </span>
          </>
        }
        checked={look.allowPersonalisation}
        onChange={(e) => {
          const allow = e.target.checked;
          update.mutate({ params: { orgSlug }, body: { allowPersonalisation: allow } }, { onSuccess: () => report.ok(allow ? "Members can personalise again." : "Everyone now uses the shared look.") } as never);
        }}
      />
    </Panel>
  );
}
