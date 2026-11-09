"use client";

import { Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { Badge, Button } from "../../components/basics";
import { Select, Textarea } from "../../components/forms";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { Panel } from "../settings/kit";
import { LoadingState } from "../../components/states";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { useForgetDevice, useMyTwoStep, useSetTwoStepPolicy, useTwoStepPolicy } from "./api";

interface OrgRequest {
  id: string;
  kind: "EXPORT" | "DELETE";
  status: "SUBMITTED_TO_PLATFORM" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED";
  note: string | null;
  submittedAt: string;
  exportStatus: "NONE" | "PACKAGING" | "READY" | "FAILED" | "EXPIRED";
  exportExpiresAt: string | null;
  deleteAfter: string | null;
}

const KIND_LABEL = { EXPORT: "Data export", DELETE: "Organisation deletion" } as const;
const STATUS_LABEL: Record<OrgRequest["status"], string> = { SUBMITTED_TO_PLATFORM: "With Figbloom", APPROVED: "Approved", COMPLETED: "Completed", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const STATUS_TONE: Record<OrgRequest["status"], "info" | "warning" | "success" | "neutral"> = { SUBMITTED_TO_PLATFORM: "warning", APPROVED: "info", COMPLETED: "success", REJECTED: "neutral", CANCELLED: "neutral" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * OS6, Settings > Data requests (FIG-1166, wired to B6.09): Management asks Figbloom to export the whole organisation or to delete it, and follows the
 * status. Filing only hands the request to the platform queue; nothing is deleted here (deletion needs two platform admins). A ready export is
 * downloaded through a short-lived signed link.
 */
export function DataRequests() {
  const toast = useToast();
  const { orgSlug } = useMember();
  const api = useApi();
  const list = useApiQuery("listOrganisationDataRequests", { params: { orgSlug } });
  const submit = useApiMutation("submitOrganisationDataRequest", { invalidate: [["listOrganisationDataRequests"]] });
  const [kind, setKind] = useState<"EXPORT" | "DELETE">("EXPORT");
  const [notes, setNotes] = useState("");
  const fail = (e: unknown) => toast.show({ tone: "danger", message: describeError(e).body });
  const items = ((list.data as { items?: OrgRequest[] } | undefined)?.items ?? []).slice().reverse();

  function send() {
    submit.mutate(
      { params: { orgSlug }, body: { kind, ...(notes.trim() ? { note: notes.trim() } : {}) } },
      {
        onSuccess: () => {
          toast.show({ message: "Request sent to Figbloom. You will see status changes here.", tone: "success" });
          setNotes("");
        },
        onError: fail,
      },
    );
  }

  async function download(id: string) {
    try {
      const r = (await api.call("getPrivacyOrganisationRequestsByRequestIdDownload", { params: { orgSlug, requestId: id } } as never)) as { download?: { url?: string } };
      if (r.download?.url) window.location.assign(r.download.url);
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="fb-set__body" data-screen-label="OS6 Settings > Data requests">
      <Panel title="Data requests" description="Ask Figbloom to export or delete the whole organisation. A person from Figbloom confirms the request with you first; deletion needs a second platform admin to approve.">
        <div className="fb-os-form">
          <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value === "DELETE" ? "DELETE" : "EXPORT")} options={(["EXPORT", "DELETE"] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <div className="fb-os-form__wide">
            <Textarea label="Notes for Figbloom" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <div>
          <Button variant="primary" disabled={submit.isPending} onClick={send}>
            Send request
          </Button>
        </div>
      </Panel>
      <Panel title="Your requests" flush>
        {list.isPending ? <LoadingState label="Loading your requests" lines={2} /> : null}
        {list.isError ? <QueryFailure error={list.error} area="Your data requests" onRetry={() => void list.refetch()} /> : null}
        {list.data && items.length === 0 ? (
          <p className="fb-set-muted" style={{ padding: "0 22px 18px" }}>
            No requests yet.
          </p>
        ) : null}
        {items.map((r) => (
          <div key={r.id} className="fb-set-row">
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">
                {KIND_LABEL[r.kind]}
                {r.note ? ` · ${r.note}` : ""}
              </div>
              <div className="fb-set-row__meta">
                Sent {day(r.submittedAt)}
                {r.exportStatus === "PACKAGING" ? " · preparing the export" : ""}
                {r.exportStatus === "READY" && r.exportExpiresAt ? ` · download until ${day(r.exportExpiresAt)}` : ""}
                {r.exportStatus === "FAILED" ? " · the export failed, Figbloom will retry" : ""}
                {r.exportStatus === "EXPIRED" ? " · the download window has ended" : ""}
                {r.deleteAfter ? ` · deletion after ${day(r.deleteAfter)}` : ""}
              </div>
            </div>
            {r.exportStatus === "READY" ? (
              <Button size="sm" onClick={() => void download(r.id)}>
                Download
              </Button>
            ) : null}
            <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/**
 * S7#2, Settings › Two-step sign-in (FIG-1167, wired to FIG-1134): the organisation policy (`security.manage` turns it on or off) and your own
 * trusted devices. Turning the policy on needs your own two-step first and signs out members who have none; the API says so and the screen shows it.
 */
export function TwoStepSettings() {
  const toast = useToast();
  const { can } = useMember();
  const policy = useTwoStepPolicy();
  const mine = useMyTwoStep();
  const setPolicy = useSetTwoStepPolicy();
  const forget = useForgetDevice();
  const canManage = can("security.manage") || can("configuration.manage");
  const fail = (e: unknown) => toast.show({ tone: "danger", message: describeError(e).body });
  return (
    <div className="fb-set__body" data-screen-label="S7#2 Settings › Two-step sign-in">
      <div className="fb-set-cards">
        <Panel title="Policy">
          {policy.isPending ? <LoadingState label="Loading the policy" lines={2} /> : null}
          {policy.isError ? <QueryFailure error={policy.error} area="The two-step policy" onRetry={() => void policy.refetch()} /> : null}
          {policy.data ? (
            <label className="fb-os-check">
              <input
                type="checkbox"
                checked={policy.data.required}
                disabled={!canManage || setPolicy.isPending}
                onChange={(e) =>
                  setPolicy.mutate(e.target.checked, {
                    onSuccess: (r) =>
                      toast.show({
                        message: r.required
                          ? `Two-step sign-in is now required.${r.signedOut ? ` ${r.signedOut} member${r.signedOut === 1 ? "" : "s"} without it were signed out.` : ""}`
                          : "Two-step sign-in is no longer required. The change is recorded in the audit log.",
                        tone: "success",
                      }),
                    onError: fail,
                  })
                }
              />
              <span>
                <b>Require for everyone in this organisation</b>
                <span>
                  People without it set up are walked through enrolment at their next sign-in. Trusted devices skip the code for {policy.data.trustedDeviceDays} days.
                </span>
              </span>
            </label>
          ) : null}
          <div className="fb-prefs-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {mine.data && !mine.data.enabled ? (
              <Link className="fb-btn fb-btn--secondary" href="/two-step/setup">
                Set up an authenticator
              </Link>
            ) : null}
            {mine.data?.enabled ? <span className="fb-set-muted">Your two-step sign-in is on · {mine.data.backupCodesRemaining} backup codes left.</span> : null}
          </div>
        </Panel>
        <Panel title="Trusted devices" flush>
          {mine.isPending ? <LoadingState label="Loading your devices" lines={2} /> : null}
          {mine.isError ? <QueryFailure error={mine.error} area="Your trusted devices" onRetry={() => void mine.refetch()} /> : null}
          {mine.data && mine.data.trustedDevices.length === 0 ? (
            <p className="fb-set-muted" style={{ padding: "0 22px 18px" }}>
              No trusted devices. The next sign-in on any device asks for a code.
            </p>
          ) : null}
          {mine.data?.trustedDevices.map((d) => (
            <div key={d.id} className="fb-set-row">
              <Smartphone size={17} aria-hidden="true" />
              <div className="fb-set-row__main">
                <div className="fb-set-row__name">{d.label ?? "Unnamed device"}</div>
                <div className="fb-set-row__meta">
                  Trusted until {new Date(d.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · last used{" "}
                  {new Date(d.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  forget.mutate(d.id, {
                    onSuccess: () => toast.show({ message: `${d.label ?? "The device"} forgotten. It will ask for a code next time.` }),
                    onError: fail,
                  })
                }
              >
                Forget
              </Button>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
