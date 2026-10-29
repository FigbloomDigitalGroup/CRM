"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { Button, Input, useMember } from "@/ui";
import { Switch } from "../settings/kit";
import { dealsPastRule, pipelines as seedPipelines, stageRules as seedRules } from "./demo/data";
import { EditorFrame, recordAudit } from "./kit";
import { stageRuleImpact, validatePipelineName, type StageRule } from "./model";

/**
 * Pipelines and stage rules (S6#2, FIG-1174). Separate pipelines per business line, each with its own stages and probabilities, and the rules
 * that stop a deal moving. A rule refuses a move and says why; it never moves a deal for anyone (hard rule 9). "Closed Lost needs a reason" is
 * always on. Changes are explained before saving and audited.
 */
export function PipelinesEditor() {
  const { userName, can } = useMember();
  const [saved, setSaved] = useState<StageRule[]>(seedRules);
  const [rules, setRules] = useState<StageRule[]>(seedRules);
  const [list, setList] = useState(seedPipelines);
  const [name, setName] = useState("");
  const [services, setServices] = useState("");
  const nameError = name ? validatePipelineName(name, list.map((p) => p.name)) : null;
  const dirty = JSON.stringify(rules) !== JSON.stringify(saved);
  const mayEdit = can("configuration.manage");

  return (
    <EditorFrame
      area="Pipelines"
      title="Pipelines & stage rules"
      description="Separate pipelines per business line, each with its own stages and probabilities."
      release="v1.1"
      dirty={dirty}
      errors={[]}
      impact={stageRuleImpact(saved, rules, dealsPastRule)}
      disabledReason={mayEdit ? undefined : "Only Management changes pipelines"}
      onDiscard={() => setRules(saved)}
      onSave={() => {
        recordAudit("Pipelines", "Stage rules changed", stageRuleImpact(saved, rules, dealsPastRule).join(" "), userName);
        setSaved(rules);
      }}
    >
      <div className="fb-sp-pipes">
        {list.map((p) => (
          <section key={p.name} className={`fb-sp-pipe${p.isDefault ? " fb-sp-pipe--default" : ""}`} aria-label={`${p.name} pipeline`}>
            <div className="fb-sp-pipe__head"><strong>{p.name}</strong>{p.isDefault ? <span className="fb-set-pill fb-set-pill--ok">Default</span> : null}</div>
            <p className="fb-set-muted">{p.services}</p>
            <ol className="fb-sp-stages">
              {p.stages.map(([stage, prob]) => {
                const gate = stage === "Proposal Sent" && rules[0]?.on ? "Needs a quote" : stage === "Closed Won" && rules[1]?.on ? "Needs signed quote" : stage === "Site survey" ? "Needs survey notes" : "";
                return (
                  <li key={stage}>
                    <span className="fb-set-dot" aria-hidden="true" />
                    <span className="fb-sp-stages__name">{stage}</span>
                    <span className="fb-set-muted">{prob}</span>
                    {gate ? <span className="fb-set-pill fb-set-pill--warn"><Lock size={11} aria-hidden="true" /> {gate}</span> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      <h3 className="fb-set-panel__title">Stage rules</h3>
      {rules.map((r, i) => (
        <div key={r.key} className="fb-sp-toggle">
          <Switch
            checked={r.on}
            label={r.label}
            disabled={r.locked || !mayEdit}
            disabledReason={r.locked ? "This rule is always on" : undefined}
            onChange={(on) => setRules(rules.map((x, j) => (j === i ? { ...x, on } : x)))}
          />
          <div>
            <div className="fb-com-strong">{r.label}</div>
            <div className="fb-set-muted">{r.detail}</div>
          </div>
        </div>
      ))}
      <p className="fb-set-muted">Rules stop a move and say why. They never move a deal for you.</p>

      <fieldset className="fb-sp-add">
        <legend className="fb-com-eyebrow">New pipeline</legend>
        <Input label="Name" value={name} error={nameError ?? undefined} onChange={(e) => setName(e.target.value)} />
        <Input label="Services" value={services} onChange={(e) => setServices(e.target.value)} />
        <Button
          disabledReason={!name.trim() ? "Give the pipeline a name" : nameError ?? undefined}
          onClick={() => {
            setList([...list, { name: name.trim(), isDefault: false, services: services.trim() || "No services yet", stages: [["Lead in", "10%"], ["Closed Won", "100%"], ["Closed Lost", "0%"]] }]);
            recordAudit("Pipelines", "Pipeline added", name.trim(), userName);
            setName("");
            setServices("");
          }}
        >
          Add pipeline
        </Button>
      </fieldset>
    </EditorFrame>
  );
}
