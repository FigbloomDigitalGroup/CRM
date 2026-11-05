"use client";

import { Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button } from "../../components/basics";
import { Input, Select, Textarea } from "../../components/forms";
import { useToast } from "../../components/toast";
import { useMember } from "../../data/member";
import { demoScreensEnabled } from "../../demo/enabled";
import { Panel } from "../settings/kit";
import { LoadingState } from "../../components/states";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { useForgetDevice, useMyTwoStep, useSetTwoStepPolicy, useTwoStepPolicy } from "./api";
import type { DemoDataRequest } from "./demo/data";
import { orgSideDemo, useOrgSideDemo } from "./demo/store";

/** Until these sections are wired to the API (M13/M14) a production build says so instead of showing sample records. */
function NotYet({ name }: { name: string }) {
  return (
    <Panel title={name} description="This section arrives with the V1.1 release. It is not available in your organisation yet." />
  );
}

const REQUEST_TYPES: DemoDataRequest["type"][] = ["Data export", "Data deletion", "Tenant offboarding"];

const STATUS_TONE = { Received: "info", "In review": "warning", Approved: "info", Completed: "success", Rejected: "neutral" } as const;

/**
 * OS6, Settings › Data requests (FIG-1166): the organisation asks Figbloom for a file export, a deletion or offboarding and watches the status.
 * Filing it only sends a request; nothing is deleted here (deletion and offboarding need two platform admins, see PL6). Demo data.
 */
export function DataRequests() {
  return demoScreensEnabled() ? <DataRequestsDemo /> : <NotYet name="Data requests" />;
}

function DataRequestsDemo() {
  const demo = useOrgSideDemo();
  const toast = useToast();
  const { orgSlug } = useMember();
  const [type, setType] = useState<DemoDataRequest["type"]>("Data export");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();

  function submit() {
    if (!subject.trim()) {
      setError("Say what the request is about");
      return;
    }
    setError(undefined);
    orgSideDemo.fileRequest(type, subject.trim());
    toast.show({ message: "Request sent to Figbloom. You’ll see status changes here.", tone: "success" });
    setSubject("");
    setNotes("");
  }

  return (
    <div className="fb-set__body" data-screen-label="OS6 Settings › Data requests">
      
      <Panel title="Data requests" description="Ask Figbloom to export, delete or offboard data. A person from Figbloom confirms the request with you first; deletion and offboarding need a second platform admin to approve.">
        <div className="fb-os-form">
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value as DemoDataRequest["type"])} options={REQUEST_TYPES.map((t) => ({ value: t, label: t }))} />
          <Input label="What is it about?" required value={subject} error={error} onChange={(e) => setSubject(e.target.value)} placeholder="Leads and deals (CSV), or a person’s name" />
          <div className="fb-os-form__wide">
            <Textarea label="Notes for Figbloom" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <div>
          <Button variant="primary" onClick={submit}>
            Send request
          </Button>
        </div>
      </Panel>
      <Panel title="Your requests" flush>
        {demo.dataRequests.length === 0 ? <p className="fb-set-muted" style={{ padding: "0 22px 18px" }}>No requests yet.</p> : null}
        {demo.dataRequests.map((r) => (
          <div key={r.id} className="fb-set-row">
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">
                {r.type} · {r.subject}
              </div>
              <div className="fb-set-row__meta">
                Received {r.received} · due {r.due}
              </div>
            </div>
            <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
          </div>
        ))}
      </Panel>
      <p className="fb-set-muted">
        Want to see the screen your people get while the workspace is paused?{" "}
        <button
          type="button"
          className="fb-btn fb-btn--link"
          onClick={() => {
            document.cookie = "fb_demo_suspended=1; path=/; max-age=3600; samesite=lax";
            window.location.assign(`/o/${orgSlug}/suspended`);
          }}
        >
          Preview the suspended screen
        </button>
      </p>
    </div>
  );
}

/** Settings › Support access history (FIG-1192): every time Figbloom Support asked to look, who, why, what they opened and how it ended. */
export function SupportHistory() {
  return demoScreensEnabled() ? <SupportHistoryDemo /> : <NotYet name="Support access history" />;
}

function SupportHistoryDemo() {
  const demo = useOrgSideDemo();
  const tone = (s: string) => (s === "Active" ? "warning" : s === "Denied" ? "danger" : s.startsWith("Pending") ? "warning" : "neutral");
  return (
    <div className="fb-set__body" data-screen-label="Settings › Support access history">
      
      <Panel title="Support access history" description="Only Management sees this. Figbloom Support can never see inside the workspace without an approved, time-limited request, and you can end a session at any time.">
        <div className="fb-set-tablewrap">
          <table className="fb-table">
            <thead>
              <tr>
                {["When", "Who", "Why", "Scope", "Pages viewed", "Status", "Ended by"].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demo.support.map((s) => (
                <tr key={s.id}>
                  <td>{s.at}</td>
                  <td>Figbloom Support ({s.by})</td>
                  <td>
                    {s.reason} · {s.ticket}
                  </td>
                  <td>
                    {s.scope} · {s.mins} min
                  </td>
                  <td>{s.pages?.length ? s.pages.join(", ") : "—"}</td>
                  <td>
                    <Badge tone={tone(s.status)}>{s.status}</Badge>
                  </td>
                  <td>{s.endedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
