"use client";

import { AlertTriangle, CheckCircle2, Info, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, ErrorState, Input, LoadingState, Select, describeError, useApi, useMember, useToast, useApiMutation, queryKeyFor } from "@/ui";
import { newIdempotencyKey, putSignedUpload } from "@/ui/data/client";
import { useProfileQuery } from "./hooks";
import { AVATAR_MAX_BYTES, AVATAR_MIN_PX, refuseAvatar, type ProfileView } from "./model";

type Message = { tone: "ok" | "bad" | "info"; text: string };

/** A square cut of the picture, in pixels of the picture itself, from a zoom (1 = the whole short side) and a position (0 to 1 each way). */
export function cropFor(width: number, height: number, zoom: number, px: number, py: number): { x: number; y: number; size: number } {
  const size = Math.max(1, Math.floor(Math.min(width, height) / Math.max(1, zoom)));
  return { x: Math.round((width - size) * Math.min(1, Math.max(0, px))), y: Math.round((height - size) * Math.min(1, Math.max(0, py))), size };
}

function CropPanel({ file, onCancel, onUse, busy }: { file: File; onCancel: () => void; onUse: (crop: { x: number; y: number; size: number }) => void; busy: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [px, setPx] = useState(0.5);
  const [py, setPy] = useState(0.5);
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setUnreadable(true);
    img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (unreadable) {
    return (
      <div className="fb-prefs__crop" role="alert">
        <p>That picture could not be read. Choose another file.</p>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    );
  }
  if (dims && Math.min(dims.w, dims.h) < AVATAR_MIN_PX) {
    return (
      <div className="fb-prefs__crop" role="alert">
        <p>That picture is too small. It needs to be at least {AVATAR_MIN_PX} pixels on its shorter side.</p>
        <Button onClick={onCancel}>Choose another</Button>
      </div>
    );
  }
  const crop = dims ? cropFor(dims.w, dims.h, zoom, px, py) : null;
  // The preview shows exactly the square that will be kept: the picture scaled so the square fills the frame, then shifted.
  const frame = 150;
  const scale = crop ? frame / crop.size : 1;
  return (
    <div className="fb-prefs__crop" data-testid="avatar-crop" role="group" aria-label="Crop your picture">
      <div className="fb-prefs__cropframe" aria-hidden="true" style={{ width: frame, height: frame }}>
        {url && dims && crop ? <img src={url} alt="" style={{ width: dims.w * scale, height: dims.h * scale, transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px)` }} /> : null}
        <span className="fb-prefs__cropring" />
      </div>
      <div className="fb-prefs__cropctl">
        <label className="fb-label">Zoom<input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
        <label className="fb-label">Move left or right<input type="range" min={0} max={1} step={0.05} value={px} disabled={zoom === 1 && dims !== null && dims.w <= dims.h} onChange={(e) => setPx(Number(e.target.value))} /></label>
        <label className="fb-label">Move up or down<input type="range" min={0} max={1} step={0.05} value={py} disabled={zoom === 1 && dims !== null && dims.h <= dims.w} onChange={(e) => setPy(Number(e.target.value))} /></label>
        <div className="fb-prefs__row">
          <Button variant="primary" loading={busy} disabled={!crop} onClick={() => crop && onUse(crop)}>Use this picture</Button>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export function ProfileTab() {
  const { orgSlug } = useMember();
  const { profile, isLoading, error, refetch } = useProfileQuery();
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ name: string; phone: string; timeZone: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const saveProfile = useApiMutation("updateMyProfile");
  const removeAvatar = useApiMutation("removeMyAvatar");
  const profileKey = queryKeyFor("getMyProfile", { params: { orgSlug } });

  useEffect(() => {
    if (profile && !form) setForm({ name: profile.name, phone: profile.phone ?? "", timeZone: profile.timeZone ?? "" });
  }, [profile, form]);

  if (isLoading) return <LoadingState label="Loading your profile" lines={5} />;
  if (error || !profile || !form) return <ErrorState error={error} area="Your profile" onRetry={() => void refetch()} />;

  function choose(file: File | undefined) {
    if (!file) return;
    const problem = refuseAvatar(file);
    if (problem) {
      setMessage({ tone: "bad", text: problem });
      setPicked(null);
    } else {
      setMessage(null);
      setPicked(file);
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function upload(crop: { x: number; y: number; size: number }) {
    if (!picked) return;
    setUploading(true);
    setMessage({ tone: "info", text: "Uploading…" });
    try {
      const started = (await api.call("createFileUpload", {
        params: { orgSlug },
        body: { purpose: "AVATAR", name: picked.name, mimeType: picked.type, sizeBytes: picked.size } as never,
        idempotencyKey: newIdempotencyKey(),
      })) as unknown as { file: { id: string }; upload: { url: string; method?: string; headers?: Record<string, string> } };
      await putSignedUpload(started.upload, picked);
      await api.call("completeFileUpload", { params: { orgSlug, fileId: started.file.id }, idempotencyKey: newIdempotencyKey() } as never);
      const next = (await api.call("setMyAvatar", { params: { orgSlug }, body: { fileId: started.file.id, crop } as never, idempotencyKey: newIdempotencyKey() })) as unknown as ProfileView;
      qc.setQueryData(profileKey, next);
      setPicked(null);
      setMessage({ tone: "ok", text: "Picture saved. It shows everywhere your name appears." });
      router.refresh();
    } catch (e) {
      const d = describeError(e);
      setMessage({
        tone: "bad",
        text: d.kind === "validation" || d.kind === "conflict" ? d.body : d.kind === "offline" ? "Upload failed. Check your connection and try again." : "Upload failed. Nothing changed. Try again in a moment.",
      });
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    try {
      const next = (await removeAvatar.mutateAsync({ params: { orgSlug } })) as unknown as ProfileView;
      qc.setQueryData(profileKey, next);
      setMessage(null);
      toast.show({ message: "Picture removed. Your initials show instead." });
      router.refresh();
    } catch (e) {
      setMessage({ tone: "bad", text: describeError(e).body });
    }
  }

  async function save() {
    setFieldErrors({});
    try {
      const next = (await saveProfile.mutateAsync({ params: { orgSlug }, body: { name: form!.name, phone: form!.phone.trim() === "" ? null : form!.phone, timeZone: form!.timeZone === "" ? null : form!.timeZone } as never })) as unknown as ProfileView;
      qc.setQueryData(profileKey, next);
      toast.show({ message: "Profile saved." });
      router.refresh();
    } catch (e) {
      const d = describeError(e);
      setFieldErrors(Object.fromEntries(d.fieldErrors.map((f) => [f.path, f.message])));
      toast.show({ tone: "danger", message: d.kind === "validation" ? "Fix the highlighted fields and save again." : d.body });
    }
  }

  const hasPicture = Boolean(profile.avatar.url);
  const zones = Array.from(new Set(["Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam", "Europe/London", profile.organizationTimeZone, profile.timeZone ?? ""].filter(Boolean)));
  const tzDiffers = profile.timeZone && profile.timeZone !== profile.organizationTimeZone;
  const Icon = message?.tone === "ok" ? CheckCircle2 : message?.tone === "bad" ? AlertTriangle : Info;

  return (
    <section className="fb-prefs__card fb-prefs__profile" aria-labelledby="prefs-profile" data-testid="prefs-profile">
      <h2 id="prefs-profile" className="fb-sr-only">Profile</h2>
      <div className="fb-prefs__avatarrow">
        <Avatar name={profile.name} src={profile.avatar.url} size={84} />
        <div className="fb-prefs__stack fb-prefs__stack--tight">
          <div className="fb-prefs__row">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png" className="fb-sr-only" aria-label="Choose a picture" data-testid="avatar-file" onChange={(e) => choose(e.target.files?.[0])} />
            <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Upload size={15} aria-hidden="true" />
              {hasPicture ? "Change picture" : "Upload picture"}
            </Button>
            {hasPicture ? <Button onClick={() => void remove()} loading={removeAvatar.isPending}>Remove</Button> : null}
          </div>
          <p className="fb-prefs__hint">JPG or PNG, up to {AVATAR_MAX_BYTES / 1024 / 1024} MB. Shown in the user menu, owner chips, timelines and comments. Without a picture, your initials show.</p>
        </div>
      </div>
      {message ? (
        <div role={message.tone === "bad" ? "alert" : "status"} className="fb-prefs__msg" data-tone={message.tone}>
          <Icon size={15} aria-hidden="true" />
          {message.text}
        </div>
      ) : null}
      {picked ? <CropPanel file={picked} busy={uploading} onCancel={() => { setPicked(null); setMessage(null); }} onUse={(c) => void upload(c)} /> : null}

      <div className="fb-prefs__fields">
        <Input label="Display name" required error={fieldErrors.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Phone" error={fieldErrors.phone} value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input label="Email" disabledReason="Managed by your organisation. Ask a Management member to change it." value={profile.email} readOnly />
        <Select
          label="Time zone"
          value={form.timeZone}
          options={[{ value: "", label: `Organisation’s (${profile.organizationTimeZone})` }, ...zones.filter((z) => z !== profile.organizationTimeZone).map((z) => ({ value: z, label: z }))]}
          error={fieldErrors.timeZone}
          help={tzDiffers ? `Your time zone differs from the organisation’s (${profile.organizationTimeZone}). Due times show in yours.` : undefined}
          onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
        />
        <Select label="Language" help="Kiswahili arrives in V2." disabled options={[{ value: "en", label: "English" }]} value="en" onChange={() => undefined} />
      </div>
      <Button variant="primary" onClick={() => void save()} loading={saveProfile.isPending}>Save profile</Button>
    </section>
  );
}
