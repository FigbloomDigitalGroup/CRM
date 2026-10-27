"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@/api-client";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { downloadText } from "./data";
import { Icon } from "./icons";
import { ModalShell } from "./overlay";

/** The row count above which an export needs Management's right or an approval (the organisation can change it; the server decides). */
export const EXPORT_APPROVAL_THRESHOLD = 500;

interface RunLike {
  id: string;
  status: string;
  totalRows: number;
}

/**
 * Export CSV (L3): small exports download at once. Above 500 rows the server wants either the bulk-export right (Management: the export
 * runs in the background) or an approval; this shows which applies, asks for the approval, and shows its status instead of failing.
 */
export function ExportDialog({ total, filters, onClose }: { total: number; filters: Record<string, string>; onClose: () => void }) {
  const { orgSlug, can } = useMember();
  const api = useApi();
  const toast = useToast();
  const needsApproval = total > EXPORT_APPROVAL_THRESHOLD;
  const bulk = can("export.bulk");
  const [phase, setPhase] = useState<"working" | "confirm" | "approval" | "started" | "failed">(needsApproval ? (bulk ? "confirm" : "approval") : "working");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunLike | null>(null);
  const ran = useRef(false);

  const approvalsQ = useApiQuery("listExportApprovals", { params: { orgSlug }, query: {} }, { enabled: needsApproval && !bulk, refetchInterval: needsApproval && !bulk ? 15_000 : false });
  const mine = ((approvalsQ.data?.items ?? []) as { id: string; entity?: string; status?: string; reason?: string | null; rowLimit?: number; createdAt?: string }[]).filter((a) => !a.entity || a.entity === "LEAD");
  const latest = mine[0];

  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;

  async function downloadNow() {
    try {
      const csv = (await api.call("getLeadsExport", { params: { orgSlug }, query: query as never })) as string;
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`leads-${stamp}.csv`, csv);
      toast.show({ message: `Exporting leads… leads-${stamp}.csv is downloading` });
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) {
        setPhase("approval");
        return;
      }
      setError(describeError(err).body);
      setPhase("failed");
    }
  }

  useEffect(() => {
    if (phase === "working" && !ran.current) {
      ran.current = true;
      void downloadNow();
    }
  }, []);

  async function startBackground() {
    setBusy(true);
    setError(null);
    try {
      const r = (await api.call("startExport", { params: { orgSlug }, body: { entity: "LEAD", filters: query }, idempotencyKey: newIdempotencyKey() })) as RunLike;
      setRun(r);
      setPhase("started");
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  async function requestApproval() {
    setBusy(true);
    setError(null);
    try {
      await api.call("requestExportApproval", { params: { orgSlug }, body: { entity: "LEAD", filters: query, reason: reason.trim() || undefined }, idempotencyKey: newIdempotencyKey() });
      toast.show({ message: "Asked Management to approve this export" });
      await approvalsQ.refetch();
    } catch (err) {
      setError(describeError(err).body);
    } finally {
      setBusy(false);
    }
  }

  const status = latest?.status?.toUpperCase();
  return (
    <ModalShell
      title={phase === "approval" ? "This export needs approval" : phase === "started" ? "Export started" : phase === "confirm" ? `Export ${total} leads` : phase === "failed" ? "We couldn’t export" : "Exporting leads…"}
      intro={
        phase === "approval"
          ? `Exports of more than ${EXPORT_APPROVAL_THRESHOLD} leads need Management's approval. This one has ${total}.`
          : phase === "confirm"
            ? `More than ${EXPORT_APPROVAL_THRESHOLD} leads run in the background so nothing slows down. You can keep working.`
            : undefined
      }
      onClose={onClose}
      label="Export leads"
      footer={
        phase === "confirm" ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={busy} onClick={startBackground}>
              <Icon name="download" size={16} />
              Start export
            </button>
          </>
        ) : phase === "approval" ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
              Close
            </button>
            {!status || status === "REJECTED" || status === "DECLINED" || status === "EXPIRED" || status === "USED" ? (
              <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={busy} onClick={requestApproval}>
                Ask for approval
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={onClose}>
            {phase === "working" ? "Cancel" : "Done"}
          </button>
        )
      }
    >
      {phase === "working" ? <div className="fb-ld-muted">Preparing your file…</div> : null}
      {phase === "started" && run ? (
        <div className="fb-ld-callout" role="status">
          <Icon name="check-circle" size={20} />
          <div>
            <strong>Your export is running.</strong>
            <small>
              {run.totalRows || total} leads, status {run.status.toLowerCase().replace("_", " ")}. When it finishes you can download it{" "}
              <a href={`/api/orgs/${orgSlug}/data-runs/${run.id}/download`} download>
                from here
              </a>
              .
            </small>
          </div>
        </div>
      ) : null}
      {phase === "approval" ? (
        <>
          {latest ? (
            <div className={`fb-ld-callout ${status === "APPROVED" ? "" : status === "PENDING" ? "fb-ld-callout--warn" : "fb-ld-callout--bad"}`} role="status">
              <Icon name={status === "APPROVED" ? "check-circle" : "clock"} size={20} />
              <div>
                <strong>{status === "PENDING" ? "Waiting for Management" : status === "APPROVED" ? "Approved" : `Request ${status?.toLowerCase() ?? "answered"}`}</strong>
                <small>
                  {status === "PENDING"
                    ? "Your request is with Management. You will get a notification when it is decided."
                    : status === "APPROVED"
                      ? "Management approved this export. Ask them to run it, or try again once your role allows it."
                      : "Ask again with a reason if you still need it."}
                </small>
              </div>
            </div>
          ) : (
            <label className="fb-ld-field">
              <span>Why do you need it? (optional)</span>
              <textarea className="fb-ld-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: quarterly review with the board" />
            </label>
          )}
        </>
      ) : null}
      {phase === "failed" ? <div role="alert" className="fb-ld-callout fb-ld-callout--bad"><Icon name="alert" size={20} /><div><strong>Nothing was exported.</strong><small>{error}</small></div></div> : null}
      {error && phase !== "failed" ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : null}
    </ModalShell>
  );
}
