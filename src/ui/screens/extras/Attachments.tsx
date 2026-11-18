"use client";

import { useMemo, useRef, useState } from "react";
import { Dialog } from "../../components/overlays";
import { useToast } from "../../components/toast";
import { describeError } from "../../errors";
import { newIdempotencyKey, putSignedUpload } from "../../data/client";
import { useMember } from "../../data/member";
import { Icon } from "../leads/icons";
import { useFormatters } from "../leads/data";
import { useDeferred, useExtras, useRecordRead } from "./hooks";
import { ATTACHMENT_ACCEPT, ATTACHMENT_RULE, MIME_BY_EXTENSION, extensionOf, formatSize, refuseFile } from "./kinds";
import { Unavailable } from "./Unavailable";
import type { ExtrasKind } from "./RecordExtras";

interface AttachmentRow {
  id: string;
  title?: string | null;
  shared: boolean;
  uploadedByMembershipId: string;
  createdAt: string;
  file: { id: string; name: string; sizeBytes: number; mimeType: string; status: string };
}

const TONES: Record<string, [string, string]> = {
  pdf: ["var(--red-soft)", "var(--red)"],
  xlsx: ["var(--primary-soft)", "var(--primary-text)"],
  csv: ["var(--primary-soft)", "var(--primary-text)"],
  png: ["var(--blue-soft)", "var(--blue)"],
  jpg: ["var(--blue-soft)", "var(--blue)"],
  jpeg: ["var(--blue-soft)", "var(--blue)"],
  webp: ["var(--blue-soft)", "var(--blue)"],
  gif: ["var(--blue-soft)", "var(--blue)"],
};
const toneOf = (ext: string): [string, string] => TONES[ext] ?? ["var(--surface-3)", "var(--text-2)"];
const IMAGE = /^image\//;

interface Preview {
  name: string;
  ext: string;
  size: string;
  mime: string;
  url: string;
}

/** Attachments (X1): upload through the API's signed-link flow, scan status, preview and download by short-lived link, delete with Undo. */
export function AttachmentsSection({ kind, id, archived }: { kind: ExtrasKind; id: string; archived: boolean }) {
  const member = useMember();
  const { ops, params, call, refresh } = useExtras(kind, id);
  const toast = useToast();
  const defer = useDeferred();
  const fmt = useFormatters();
  const input = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  // While a file is still being scanned the list checks again every two seconds, so "Scanning…" turns into Preview by itself.
  const q = useRecordRead<{ items: AttachmentRow[] }>(ops.attachments, params, {
    refetchInterval: (query: { state: { data?: { items: AttachmentRow[] } } }) => (query.state.data?.items?.some((r) => r.file.status === "UPLOADING") ? 2000 : false),
  });
  const rows = useMemo(() => (q.data?.items ?? []).filter((r) => !hidden.includes(r.id)), [q.data, hidden]);

  const canUpload = member.can("attachments.manage") && !archived;
  const canManageAll = member.can("configuration.manage");

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setFailure(null);
    for (const file of Array.from(files)) {
      const refused = refuseFile(file);
      if (refused) {
        setFailure(refused);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const ext = extensionOf(file.name);
        const started = await call(ops.addAttachment, {
          body: { name: file.name, mimeType: MIME_BY_EXTENSION[ext] ?? file.type, sizeBytes: file.size },
          idempotencyKey: newIdempotencyKey(),
        });
        await putSignedUpload(started.upload, file);
        await call("postAttachmentsByAttachmentIdComplete", { params: { orgSlug: member.orgSlug, attachmentId: started.attachment.id } });
        await refresh(ops.attachments);
        toast.show({ message: `${file.name} uploaded and scanned.` });
      } catch (error) {
        const d = describeError(error);
        setFailure(`${file.name} wasn’t uploaded: ${d.kind === "validation" || d.kind === "conflict" ? d.body : "something went wrong on our side."} Nothing else changed.`);
        await refresh(ops.attachments);
      } finally {
        setUploading((u) => u.filter((n, i) => i !== u.indexOf(file.name)));
      }
    }
    if (input.current) input.current.value = "";
  }

  async function open(row: AttachmentRow) {
    try {
      const link = await call("getAttachmentsByAttachmentIdDownload", { params: { orgSlug: member.orgSlug, attachmentId: row.id } });
      setPreview({ name: row.file.name, ext: extensionOf(row.file.name).toUpperCase().slice(0, 4), size: formatSize(row.file.sizeBytes), mime: row.file.mimeType, url: link.download.url });
    } catch (error) {
      toast.show({ tone: "danger", message: `The file could not be opened. ${describeError(error).body}` });
    }
  }

  function remove(row: AttachmentRow) {
    setHidden((h) => [...h, row.id]);
    defer({
      key: `att:${row.id}`,
      message: `${row.file.name} deleted.`,
      commit: async () => {
        await call("deleteAttachmentsByAttachmentId", { params: { orgSlug: member.orgSlug, attachmentId: row.id } });
        await refresh(ops.attachments);
        setHidden((h) => h.filter((x) => x !== row.id));
      },
      onUndo: () => setHidden((h) => h.filter((x) => x !== row.id)),
      onFail: (message) => {
        setHidden((h) => h.filter((x) => x !== row.id));
        toast.show({ tone: "danger", message: `${row.file.name} was not deleted. ${message}` });
      },
    });
  }

  const count = rows.length;
  return (
    <section className="fb-xsec fb-xsec--wide fb-xsec--flush" aria-labelledby={`xatt-${id}`}>
      <div className="fb-xsec__bar">
        <h2 id={`xatt-${id}`} className="fb-xsec__title">
          <Icon name="paperclip" size={16} />Attachments<span className="fb-xsec__count">{count}</span>
        </h2>
        {canUpload ? (
          <div className="fb-xrow">
            <input ref={input} type="file" multiple hidden accept={ATTACHMENT_ACCEPT} aria-label="Choose files to upload" onChange={(e) => void upload(e.target.files)} />
            <button type="button" className="fb-xbtn fb-xbtn--primary" onClick={() => input.current?.click()}>
              <Icon name="upload" size={14} />Upload
            </button>
          </div>
        ) : null}
      </div>
      {canUpload ? <p className="fb-xhint">{ATTACHMENT_RULE}</p> : null}
      {failure ? (
        <div role="alert" className="fb-xalert">
          <Icon name="alert" size={15} />
          <span className="fb-xalert__text">{failure}</span>
          <button type="button" className="fb-xalert__x" onClick={() => setFailure(null)}>Dismiss</button>
        </div>
      ) : null}
      {q.isError ? (
        <div className="fb-xpad"><Unavailable what="Files" error={q.error} noun={ops.noun} /></div>
      ) : (
        <>
          {uploading.map((name, i) => (
            <div key={`${name}-${i}`} className="fb-xfile" role="status">
              <span className="fb-xfile__ext" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>{extensionOf(name).toUpperCase().slice(0, 4)}</span>
              <div className="fb-xfile__main">
                <div className="fb-xfile__name">{name}</div>
                <div className="fb-xfile__meta">Uploading…</div>
              </div>
            </div>
          ))}
          {rows.map((r) => {
            const ext = extensionOf(r.file.name);
            const [bg, fg] = toneOf(ext);
            const mine = r.uploadedByMembershipId === member.membershipId;
            const scan = r.file.status === "UPLOADING";
            const blocked = r.file.status === "QUARANTINED";
            const ready = r.file.status === "READY";
            const canDelete = canUpload && (mine || canManageAll);
            return (
              <div key={r.id} className="fb-xfile">
                <span className="fb-xfile__ext" style={{ background: bg, color: fg }} aria-hidden="true">{ext.toUpperCase().slice(0, 4)}</span>
                <div className="fb-xfile__main">
                  <div className="fb-xfile__name">{r.title || r.file.name}</div>
                  <div className="fb-xfile__meta">
                    {formatSize(r.file.sizeBytes)}
                    {mine ? " · You" : ""} · {fmt.when(r.createdAt)}
                    {kind === "deal" && !r.shared ? <> · <span className="fb-xfile__restricted">Only people who can see the deal value</span></> : null}
                  </div>
                </div>
                {scan ? <span className="fb-xscan"><Icon name="shield" size={12} />Scanning…</span> : null}
                {blocked ? <span className="fb-xscan fb-xscan--bad"><Icon name="alert" size={12} />Blocked by the scan</span> : null}
                {ready ? (
                  <button type="button" className="fb-xbtn fb-xbtn--sm" aria-label={`Preview ${r.file.name}`} onClick={() => void open(r)}>Preview</button>
                ) : null}
                {canDelete ? (
                  <button type="button" className="fb-xicon" aria-label={`Delete ${r.file.name}`} onClick={() => remove(r)}>
                    <Icon name="archive" size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {!q.isLoading && count === 0 && uploading.length === 0 ? (
            <div className="fb-xpad fb-xempty">No files yet. Contracts, site photos and briefs live here, visible to the roles that can see this record.</div>
          ) : null}
        </>
      )}
      <Dialog
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.name ?? "Preview"}
        actions={
          preview ? (
            <>
              <a className="fb-xbtn" href={preview.url} download={preview.name} target="_blank" rel="noopener noreferrer">
                <Icon name="download" size={14} />Download
              </a>
              <button type="button" className="fb-xbtn" onClick={() => setPreview(null)}>Close</button>
            </>
          ) : null
        }
      >
        {preview ? (
          <div className="fb-xpreview">
            {IMAGE.test(preview.mime) ? (
              <img src={preview.url} alt={preview.name} className="fb-xpreview__img" />
            ) : (
              <>
                <span className="fb-xpreview__ext">{preview.ext}</span>
                <span>Preview of {preview.name} · {preview.size}</span>
              </>
            )}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
