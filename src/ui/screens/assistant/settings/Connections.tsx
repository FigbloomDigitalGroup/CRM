"use client";

import { Calendar, Check, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/basics";
import { ConfirmDialog } from "../../../components/overlays";
import { useToast } from "../../../components/toast";
import { useMember } from "../../../data/member";
import { DemoNotice } from "../../../demo/DemoBadge";
import { Panel } from "../../settings/kit";

type Kind = "email" | "calendar";

interface Def {
  kind: Kind;
  title: string;
  detail: string;
  steps: string[];
  cta: string[];
  consent: string;
}

const DEFS: Def[] = [
  {
    kind: "email",
    title: "Google Workspace or Microsoft 365 mail",
    detail: "Emails to and from known contacts are added to their timeline.",
    steps: ["Choose provider", "Sign in and allow access", "Pick what to sync (only known contacts)", "Run first sync"],
    cta: ["Choose provider", "Sign in with Google", "Save sync rules", "Start sync"],
    consent: "You will sign in with your provider. Figbloom asks to read mail only to and from people already in your contacts, and never sends mail from your account. You can disconnect at any time and the access is revoked.",
  },
  {
    kind: "calendar",
    title: "Calendar",
    detail: "Meetings with contacts appear as activities; CRM tasks can appear in your calendar.",
    steps: ["Choose calendar", "Allow access", "Two-way or one-way", "Done"],
    cta: ["Choose calendar", "Allow access", "Save", "Finish"],
    consent: "You will sign in with your provider. Figbloom asks to read your meetings and, if you choose two-way, to add CRM tasks to your calendar. You can disconnect at any time.",
  },
];

const key = (org: string) => `figbloom-demo-connections:${org}`;

/**
 * Settings, Email and calendar (S6#2, FIG-1175): connect and disconnect a mailbox and a calendar. The sign-in with the provider is simulated on demo
 * data: every step is real UI and nothing leaves the device. FIG-807 and FIG-808 supply the OAuth in M13 (docs/RESTRUCTURE_LOG.md). Every
 * connection is the person's own and can be disconnected here.
 */
export function Connections() {
  const { orgSlug } = useMember();
  const toast = useToast();
  const [done, setDone] = useState<Record<Kind, number>>({ email: 0, calendar: 0 });
  const [provider, setProvider] = useState("Google Workspace");
  const [consent, setConsent] = useState<Kind | null>(null);
  const [disconnect, setDisconnect] = useState<Kind | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key(orgSlug));
      const saved = raw ? (JSON.parse(raw) as Partial<Record<Kind, number>>) : null;
      if (saved) setDone({ email: saved.email ?? 0, calendar: saved.calendar ?? 0 });
    } catch {
      /* blocked storage */
    }
  }, [orgSlug]);

  function commit(next: Record<Kind, number>) {
    setDone(next);
    try {
      localStorage.setItem(key(orgSlug), JSON.stringify(next));
    } catch {
      /* the demo state lasts until the page closes */
    }
  }

  function advance(def: Def) {
    const n = done[def.kind];
    // The step that sends the person to their provider asks first.
    if (n === 1 && consent === null) {
      setConsent(def.kind);
      return;
    }
    const next = { ...done, [def.kind]: n + 1 };
    commit(next);
    if (n + 1 >= def.steps.length) toast.show({ message: `${def.title} connected.` });
  }

  return (
    <div className="fb-set-cols" style={{ maxWidth: "none", gridTemplateColumns: "1fr" }}>
      <DemoNotice what="Email and calendar connections" />
      <div className="fb-set-cards">
        {DEFS.map((def) => {
          const n = done[def.kind];
          const connected = n >= def.steps.length;
          const Icon = def.kind === "email" ? Mail : Calendar;
          return (
            <Panel key={def.kind} title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><Icon size={18} aria-hidden="true" />{def.title}</span>} description={def.detail}>
              {n === 0 && def.kind === "email" ? (
                <fieldset className="fb-set-code" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, border: 0 }}>
                  <legend className="fb-sr-only">Provider</legend>
                  {["Google Workspace", "Microsoft 365"].map((p) => (
                    <label key={p} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="radio" name="provider" checked={provider === p} onChange={() => setProvider(p)} /> {p}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <ol className="fb-conn-steps" aria-label={`${def.title}: steps`}>
                {def.steps.map((s, i) => (
                  <li key={s} data-state={i < n ? "done" : i === n ? "now" : "todo"}>
                    <span className="fb-conn-steps__mark" aria-hidden="true">
                      {i < n ? <Check size={12} /> : i + 1}
                    </span>
                    {s}
                    {i < n ? <span className="fb-sr-only"> (done)</span> : null}
                  </li>
                ))}
              </ol>
              <div className="fb-set-panel__actions">
                {connected ? (
                  <>
                    <span className="fb-set-pill fb-set-pill--ok">Connected{def.kind === "email" ? ` · ${provider}` : ""}</span>
                    <Button onClick={() => setDisconnect(def.kind)}>Disconnect</Button>
                  </>
                ) : (
                  <Button variant="primary" onClick={() => advance(def)}>
                    {def.cta[n]}
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <ConfirmDialog
        open={consent !== null}
        onClose={() => setConsent(null)}
        title="Allow Figbloom to connect?"
        body={DEFS.find((d) => d.kind === consent)?.consent ?? ""}
        confirmLabel="Allow"
        onConfirm={() => {
          const def = DEFS.find((d) => d.kind === consent)!;
          setConsent(null);
          commit({ ...done, [def.kind]: done[def.kind] + 1 });
        }}
      />
      <ConfirmDialog
        open={disconnect !== null}
        onClose={() => setDisconnect(null)}
        title="Disconnect?"
        body="Figbloom stops reading from this account and the access is revoked. What was already added to timelines stays."
        confirmLabel="Disconnect"
        onConfirm={() => {
          const kind = disconnect!;
          setDisconnect(null);
          commit({ ...done, [kind]: 0 });
          toast.show({ message: "Disconnected. Access was revoked." });
        }}
      />
    </div>
  );
}
