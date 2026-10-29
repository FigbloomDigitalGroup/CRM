"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Globe, Inbox, Layers, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Dialog, Input, ReleaseTag, Textarea } from "../..";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, rel, useReport } from "./kit";

interface Entry {
  key: string;
  name: string;
  description: string;
  state: "CONNECTED" | "NOT_CONNECTED" | "PLANNED";
  release: "V1" | "V1.1" | "V2" | "LATER";
  stateReason: string;
  lastActivityAt: string | null;
  lastError: { at: string | null; message: string } | null;
  configurable: boolean;
}
interface WhatsApp {
  number: string | null;
  defaultMessage: string;
  templates: { key?: string; label: string; body: string }[];
}

const STATE = { CONNECTED: { label: "Connected", tone: "ok" }, NOT_CONNECTED: { label: "Not connected", tone: "" }, PLANNED: { label: "Planned", tone: "plan" } } as const;
const ICON: Record<string, React.ReactNode> = {
  WEBSITE: <Globe size={18} aria-hidden="true" />,
  INBOUND_EMAIL: <Inbox size={18} aria-hidden="true" />,
  WHATSAPP_CLICK_TO_CHAT: <MessageCircle size={18} aria-hidden="true" />,
};
const TAB: Record<string, string> = { WEBSITE: "website", INBOUND_EMAIL: "email" };

/**
 * Integrations (S6, FIG-1108): every integration with its real state (Connected, Not connected or Planned, derived from signals such as a submission that
 * was actually accepted), what to do next, and the click-to-chat settings. WhatsApp here is click-to-chat with a log prompt; API messaging is a later phase.
 */
export function Integrations() {
  const { orgSlug } = useMember();
  const q = useApiQuery("listIntegrations", { params: { orgSlug } });
  const entries = asArray<Entry>((q.data as unknown as { integrations?: unknown[] } | undefined)?.integrations);
  const [config, setConfig] = useState(false);
  return (
    <>
      <Panel title="Integrations" description="Connect the places enquiries and customer conversations already happen." />
      <Gate q={q} area="Integrations">
        <div className="fb-set-cards">
          {entries.map((e) => {
            const s = STATE[e.state];
            return (
              <article key={e.key} className="fb-set-panel" aria-label={e.name} style={{ padding: 18, gap: 10 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--surface-2)", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{ICON[e.key] ?? <Layers size={18} aria-hidden="true" />}</span>
                  <h3 style={{ margin: 0, fontSize: 14.5, flex: 1 }}>{e.name}</h3>
                  <span className={`fb-set-pill ${s.tone ? `fb-set-pill--${s.tone}` : ""}`}>{s.label}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.45, flex: 1 }}>{e.description}</p>
                <p className="fb-set-muted" style={{ margin: 0 }}>{e.stateReason}{e.lastActivityAt ? ` Last activity ${rel(e.lastActivityAt)}.` : ""}</p>
                {e.lastError ? <p className="fb-set-pill fb-set-pill--bad" style={{ whiteSpace: "normal", margin: 0 }}>Last problem: {e.lastError.message}</p> : null}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {e.state === "PLANNED" || !e.configurable ? (
                    <Button size="sm" disabledReason={e.state === "PLANNED" ? "Planned for a later release." : "Nothing to configure yet."}>{e.state === "PLANNED" ? "Planned" : "Connect"}</Button>
                  ) : TAB[e.key] ? (
                    <Link className="fb-btn fb-btn--secondary fb-btn--sm" href={`/o/${orgSlug}/settings?tab=${TAB[e.key]}`}>Manage</Link>
                  ) : (
                    <Button size="sm" onClick={() => setConfig(true)}>{e.key === "WHATSAPP_CLICK_TO_CHAT" ? "Configure" : "Manage"}</Button>
                  )}
                  {e.release !== "V1" && e.release !== "LATER" ? <ReleaseTag release={e.release === "V1.1" ? "v1.1" : "v2"} /> : null}
                </div>
              </article>
            );
          })}
        </div>
      </Gate>
      {config ? <WhatsAppDialog onClose={() => setConfig(false)} /> : null}
    </>
  );
}

function WhatsAppDialog({ onClose }: { onClose: () => void }) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getWhatsAppConfig", { params: { orgSlug } });
  return (
    <Dialog open onClose={onClose} title="WhatsApp click-to-chat">
      <Gate q={q} area="The WhatsApp settings" lines={3}>{q.data ? <WhatsAppForm initial={q.data as unknown as WhatsApp} onClose={onClose} /> : null}</Gate>
    </Dialog>
  );
}

function WhatsAppForm({ initial, onClose }: { initial: WhatsApp; onClose: () => void }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const qc = useQueryClient();
  const [number, setNumber] = useState(initial.number ?? "");
  const [message, setMessage] = useState(initial.defaultMessage);
  const [templates, setTemplates] = useState(initial.templates);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useApiMutation("updateWhatsAppConfig", {
    onSuccess: () => {
      report.ok("WhatsApp settings saved.");
      void qc.invalidateQueries({ queryKey: ["listIntegrations", { orgSlug }, null] });
      void qc.invalidateQueries({ queryKey: ["getWhatsAppConfig", { orgSlug }, null] });
      onClose();
    },
    onError: (e) => {
      const fe = (e as { envelope?: { fieldErrors?: { message: string }[] } }).envelope?.fieldErrors?.[0]?.message;
      setProblem(fe ?? "The settings did not save.");
    },
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0 }}>Records show a call and WhatsApp button; using one asks the person to log what happened. API messaging is a later phase.</p>
      <Input label="Organisation WhatsApp number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="0711 482 900" help="Any local form; it is stored with the country code. Empty turns click-to-chat off." />
      <Textarea label="Default message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      {templates.map((t, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <Input label={`Template ${i + 1} name`} value={t.label} onChange={(e) => setTemplates(templates.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
          <Textarea label="Message" rows={2} value={t.body} onChange={(e) => setTemplates(templates.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)))} />
          <div><Button size="sm" variant="ghost" onClick={() => setTemplates(templates.filter((_, k) => k !== i))}>Remove template</Button></div>
        </div>
      ))}
      <div><Button size="sm" onClick={() => setTemplates([...templates, { label: "", body: "" }])}>Add a template</Button></div>
      {problem ? <span className="fb-error" role="alert">{problem}</span> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => { setProblem(null); save.mutate({ params: { orgSlug }, body: { number: number.trim() || null, defaultMessage: message, templates } }); }}>Save</Button>
      </div>
    </div>
  );
}
