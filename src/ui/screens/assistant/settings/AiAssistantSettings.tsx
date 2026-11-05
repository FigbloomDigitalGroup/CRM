"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { ErrorState, LoadingState } from "../../../components/states";
import { useToast } from "../../../components/toast";
import { useApiMutation } from "../../../data/hooks";
import { useMember } from "../../../data/member";
import { explainRollback } from "../../../data/hooks";
import { Panel, Switch } from "../../settings/kit";
import { useAssistantSettings, type AssistantSettingsDto } from "../api";

type OptionKey = "enabled" | "summaries" | "drafts" | "scoring" | "retention";

const OPTIONS: { key: OptionKey; label: string; detail: string; note?: string }[] = [
  { key: "enabled", label: "Ask Figbloom", detail: "Answers questions about records you can open, and drafts tasks or notes for you to confirm." },
  { key: "summaries", label: "Timeline summaries", detail: "A short summary at the top of long timelines.", note: "Saved now; summaries are not built yet." },
  { key: "drafts", label: "Message drafts", detail: "Suggests a reply using your templates. You edit and send." },
  { key: "scoring", label: "Lead score explanations", detail: "Shows why a lead scored high or low. The score itself is a simple, visible rule set.", note: "Saved now; explanations are not built yet." },
  { key: "retention", label: "Churn risk hints (V2)", detail: "Flags customers going quiet. Off until there is more history.", note: "Saved now; churn hints are not built yet." },
];

const valueOf = (s: AssistantSettingsDto, k: OptionKey) => (k === "enabled" ? s.enabled : s.options[k]);

/**
 * Settings, AI assistant (S6#2, FIG-1175): what Ask Figbloom may help with in this organisation, read from and saved to `/assistant/settings`
 * (docs/ASSISTANT.md). Turning "Ask Figbloom" off switches the panel off for everyone at once. Only Management (`ai.configure`) can change it;
 * everyone else sees the state with an explanation.
 */
export function AiAssistantSettings() {
  const { orgSlug } = useMember();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useAssistantSettings(true);
  const save = useApiMutation("putAssistantSettings", {
    onSuccess: (data) => qc.setQueryData(["getAssistantSettings", { orgSlug }, null], data),
  });

  if (q.isLoading) return <LoadingState label="Loading the assistant settings" lines={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} area="AI assistant settings" onRetry={() => void q.refetch()} />;
  const s = q.data as unknown as AssistantSettingsDto;

  function change(key: OptionKey, on: boolean) {
    const label = OPTIONS.find((o) => o.key === key)!.label;
    save.mutate(
      { params: { orgSlug }, body: { [key]: on } as never },
      {
        onSuccess: () => toast.show({ message: `${label} is ${on ? "on" : "off"} for your organisation.` }),
        onError: (e) => toast.show({ tone: "danger", message: explainRollback(e, label) }),
      },
    );
  }

  return (
    <div className="fb-set-cols" style={{ maxWidth: 760, gridTemplateColumns: "1fr" }}>
      {!s.providerConfigured ? (
        <div className="fb-set-note" role="status">
          <span>No assistant model is connected to this deployment yet, so Ask Figbloom cannot answer even when it is on. Ask whoever runs Figbloom to set it up.</span>
        </div>
      ) : null}
      <Panel title="AI assistant" description="What Ask Figbloom may help with in this organisation." flush>
        {OPTIONS.map((o) => (
          <div key={o.key} className="fb-set-row">
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">{o.label}</div>
              <div className="fb-set-row__desc">
                {o.detail}
                {o.note ? ` ${o.note}` : ""}
              </div>
            </div>
            <Switch
              checked={valueOf(s, o.key)}
              label={o.label}
              disabled={!s.canConfigure || save.isPending}
              disabledReason={!s.canConfigure ? "Only a Management member can change the assistant settings." : undefined}
              onChange={(on) => change(o.key, on)}
            />
          </div>
        ))}
      </Panel>
      <div className="fb-set-note">
        <Shield size={16} aria-hidden="true" />
        <span>
          The assistant only reads records the signed-in person can open, never sees hidden values or margins for roles without them, and asks before it changes anything. It never decides a stage, a discount or an approval.
          {` Each person may ask ${s.limits.perUser} questions a day; the organisation ${s.limits.perOrganisation}.`}
        </span>
      </div>
    </div>
  );
}
