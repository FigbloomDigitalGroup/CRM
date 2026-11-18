"use client";

import { Lock } from "lucide-react";
import { useState } from "react";
import { Button, Input, LoadingState, useMember, useToast } from "@/ui";
import { QueryFailure } from "../../featureUnavailable";
import { describeError, useCreatePipeline, usePipelines, useSaveStageRules, type PipelineStageView } from "../commercial/api";
import { Switch } from "../settings/kit";
import { EditorFrame, recordAudit } from "./kit";
import { validatePipelineName } from "./model";

/**
 * Pipelines and stage rules (S6#2, FIG-1174) on `GET/POST /pipelines` and `PUT /pipelines/{id}/stages/{stageId}/rules`. Separate pipelines per
 * business line, each with its own stages, and the rules that stop a deal moving into a stage. A rule refuses a move and says why; it never moves a
 * deal for anyone (hard rule 9). "Closed Lost needs a reason" is always on. A change is explained before it is saved and audited by the server.
 */

/** The two rules this editor switches. A "required fields" rule keeps its fields and is only shown. */
const SWITCHABLE = [
  { type: "QUOTE_REQUIRED", label: "Needs a valid quote", detail: "Stops the move until an approved or sent quote is valid." },
  { type: "APPROVAL_REQUIRED", label: "Needs Management approval", detail: "Stops the move until Management approves it." },
] as const;
type Switchable = (typeof SWITCHABLE)[number]["type"];

const ruleOn = (s: PipelineStageView, type: Switchable) => s.rules.some((r) => r.type === type && r.enabled);
const keyOf = (stageId: string, type: Switchable) => `${stageId}:${type}`;

export function PipelinesEditor() {
  const { userName, can, orgSlug } = useMember();
  const toast = useToast();
  const q = usePipelines(orgSlug);
  const saveRules = useSaveStageRules();
  const create = useCreatePipeline();
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const mayEdit = can("configuration.manage");
  if (q.isLoading) return <LoadingState label="Loading pipelines" />;
  if (q.error || !q.data) return <QueryFailure error={q.error} area="Pipelines" onRetry={() => void q.refetch()} />;

  const pipelines = q.data.items;
  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ p, s })));
  const valueOf = (s: PipelineStageView, type: Switchable) => changes[keyOf(s.id, type)] ?? ruleOn(s, type);
  const dirtyKeys = Object.keys(changes).filter((k) => {
    const [id, type] = k.split(":") as [string, Switchable];
    const s = stages.find((x) => x.s.id === id)?.s;
    return s ? changes[k] !== ruleOn(s, type) : false;
  });
  const impact = dirtyKeys.map((k) => {
    const [id, type] = k.split(":") as [string, Switchable];
    const s = stages.find((x) => x.s.id === id)!.s;
    const label = SWITCHABLE.find((r) => r.type === type)!.label.toLowerCase();
    return changes[k]
      ? `${s.name}: from now a move into it is refused until the deal ${label.replace("needs", "has")}. Deals already past it stay where they are.`
      : `${s.name}: deals will move in without the “${label}” check.`;
  });
  const nameError = name ? validatePipelineName(name, pipelines.map((p) => p.name)) : null;

  async function onSave() {
    const touched = new Set(dirtyKeys.map((k) => k.split(":")[0]!));
    try {
      let said = "";
      for (const { p, s } of stages.filter((x) => touched.has(x.s.id))) {
        const keep = s.rules.filter((r) => r.type !== "QUOTE_REQUIRED" && r.type !== "APPROVAL_REQUIRED").map((r) => ({ type: r.type, enabled: r.enabled, ...(r.fields ? { fields: r.fields } : {}) }));
        const wanted = SWITCHABLE.filter((r) => valueOf(s, r.type)).map((r) => ({ type: r.type, enabled: true }));
        const res = await saveRules.mutateAsync({ params: { orgSlug, pipelineId: p.id, stageId: s.id }, body: { rules: [...keep, ...wanted] } });
        said = res.impact;
      }
      recordAudit("Pipelines", "Stage rules changed", impact.join(" "), userName);
      setChanges({});
      if (said) toast.show({ message: said, tone: "info" });
    } catch (e) {
      toast.show({ message: describeError(e).body, tone: "danger" });
    }
  }

  const pill = (s: PipelineStageView) =>
    s.rules
      .filter((r) => r.enabled)
      .map((r) => (
        <span key={r.id} className="fb-set-pill fb-set-pill--warn"><Lock size={11} aria-hidden="true" /> {r.label}</span>
      ));

  return (
    <EditorFrame
      area="Pipelines"
      title="Pipelines & stage rules"
      description="Separate pipelines per business line, each with its own stages and probabilities."
      release="v1.1"
      dirty={dirtyKeys.length > 0}
      errors={[]}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management changes pipelines"}
      onDiscard={() => setChanges({})}
      onSave={() => void onSave()}
    >
      <div className="fb-sp-pipes">
        {pipelines.map((p) => (
          <section key={p.id} className={`fb-sp-pipe${p.isDefault ? " fb-sp-pipe--default" : ""}`} aria-label={`${p.name} pipeline`}>
            <div className="fb-sp-pipe__head"><strong>{p.name}</strong>{p.isDefault ? <span className="fb-set-pill fb-set-pill--ok">Default</span> : null}{!p.isActive ? <span className="fb-set-pill">Switched off</span> : null}</div>
            <p className="fb-set-muted">{p.serviceIds.length ? `${p.serviceIds.length} service${p.serviceIds.length === 1 ? "" : "s"}` : "No services assigned"}</p>
            <ol className="fb-sp-stages">
              {p.stages.filter((s) => s.isActive).map((s) => (
                <li key={s.id}>
                  <span className="fb-set-dot" aria-hidden="true" />
                  <span className="fb-sp-stages__name">{s.name}</span>
                  <span className="fb-set-muted">{s.probability === null ? "" : `${s.probability}%`}</span>
                  {pill(s)}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <h3 className="fb-set-panel__title">Stage rules</h3>
      {pipelines.map((p) => (
        <div key={p.id} role="group" aria-label={`Rules for ${p.name}`}>
          {pipelines.length > 1 ? <div className="fb-com-eyebrow">{p.name}</div> : null}
          {p.stages
            .filter((s) => s.isActive && !s.isLost)
            .map((s) =>
              SWITCHABLE.map((r) => (
                <div key={`${s.id}-${r.type}`} className="fb-sp-toggle">
                  <Switch checked={valueOf(s, r.type)} label={`${s.name}: ${r.label}`} disabled={!mayEdit} onChange={(on) => setChanges({ ...changes, [keyOf(s.id, r.type)]: on })} />
                  <div>
                    <div className="fb-com-strong">{s.name}: {r.label}</div>
                    <div className="fb-set-muted">{r.detail}</div>
                  </div>
                </div>
              )),
            )}
        </div>
      ))}
      <div className="fb-sp-toggle">
        <Switch checked disabled label="Closed Lost needs a reason" disabledReason="This rule is always on" onChange={() => undefined} />
        <div>
          <div className="fb-com-strong">Closed Lost needs a reason</div>
          <div className="fb-set-muted">Always on. Keeps the lost-reasons report honest.</div>
        </div>
      </div>
      <p className="fb-set-muted">Rules stop a move and say why. They never move a deal for you.</p>

      {mayEdit ? (
        <fieldset className="fb-sp-add">
          <legend className="fb-com-eyebrow">New pipeline</legend>
          <Input label="Name" value={name} error={nameError ?? undefined} onChange={(e) => setName(e.target.value)} />
          <Button
            disabled={create.isPending}
            disabledReason={!name.trim() ? "Give the pipeline a name" : nameError ?? undefined}
            onClick={() =>
              create
                .mutateAsync({
                  params: { orgSlug },
                  body: { name: name.trim(), stages: [{ name: "Lead in", probability: 10 }, { name: "Closed Won", probability: 100, kind: "WON" }, { name: "Closed Lost", probability: 0, kind: "LOST" }] },
                })
                .then(
                  () => {
                    toast.show({ message: "Pipeline added. Add its stages and services next.", tone: "success" });
                    setName("");
                  },
                  (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
                )
            }
          >
            Add pipeline
          </Button>
        </fieldset>
      ) : null}
    </EditorFrame>
  );
}
