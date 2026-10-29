"use client";

import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "../../../components/toast";
import { Panel, Switch } from "../../settings/kit";
import { DEFAULT_AI_SETTINGS, readAiSettings, writeAiSettings, type AiSettings } from "../demo/data";

const OPTIONS: { key: keyof AiSettings; label: string; detail: string }[] = [
  { key: "assist", label: "Ask Figbloom", detail: "Answers questions about records you can open, and drafts tasks or notes for you to confirm." },
  { key: "summaries", label: "Timeline summaries", detail: "A short summary at the top of long timelines." },
  { key: "drafts", label: "Message drafts", detail: "Suggests a reply using your templates. You edit and send." },
  { key: "scoring", label: "Lead score explanations", detail: "Shows why a lead scored high or low. The score itself is a simple, visible rule set." },
  { key: "retention", label: "Churn risk hints (V2)", detail: "Flags customers going quiet. Off until there is more history." },
];

/**
 * Settings, AI assistant (S6#2, FIG-1175): what Ask Figbloom may help with in this organisation. Turning "Ask Figbloom" off switches the panel off for
 * everyone at once (the panel then says so). Kept on this device for the demo; the organisation setting replaces it in M13.
 */
export function AiAssistantSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  useEffect(() => setSettings(readAiSettings()), []);

  function change(key: keyof AiSettings, on: boolean) {
    const next = { ...settings, [key]: on };
    setSettings(next);
    writeAiSettings(next);
    toast.show({ message: `${OPTIONS.find((o) => o.key === key)!.label} is ${on ? "on" : "off"} for your organisation.` });
  }

  return (
    <div className="fb-set-cols" style={{ maxWidth: 760, gridTemplateColumns: "1fr" }}>
      
      <Panel title="AI assistant" description="What Ask Figbloom may help with in this organisation." flush>
        {OPTIONS.map((o) => (
          <div key={o.key} className="fb-set-row">
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">{o.label}</div>
              <div className="fb-set-row__desc">{o.detail}</div>
            </div>
            <Switch checked={settings[o.key]} label={o.label} onChange={(on) => change(o.key, on)} />
          </div>
        ))}
      </Panel>
      <div className="fb-set-note">
        <Shield size={16} aria-hidden="true" />
        <span>The assistant only reads records the signed-in person can open, never sees hidden values or margins for roles without them, and asks before it changes anything. It never decides a stage, a discount or an approval.</span>
      </div>
    </div>
  );
}
