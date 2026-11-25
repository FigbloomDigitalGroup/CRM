"use client";

import { useMemo, useState } from "react";
import { Badge, Banner, Select, useMember } from "@/ui";
import { Panel, Switch } from "../settings/kit";
import { CAPABILITIES, SCENARIOS } from "./demo/data";
import { drawerActions, homeTiles, lockedReason, previewNav, setSwitch } from "./salesAccessModel";

/**
 * Sales access (UC-C4, FIG-1789), on DEMO data: the 13 sales participation switches for one account and a live preview of the sidebar, the home tiles
 * and the lead and deal drawers. The sidebar comes from the real `buildNav`. Nothing is saved: the departments tables and the participation keys (UC-C1,
 * UC-C3) do not exist yet, and seven of the 13 keys are still to be added (docs/ROLES_ACCESS_SCREENS.md). Management only.
 */
export function SalesAccess() {
  const { can } = useMember();
  const mayEdit = can("configuration.manage");
  const [scenario, setScenario] = useState(SCENARIOS[1]!.id);
  const [on, setOn] = useState<number[]>(SCENARIOS[1]!.on);
  const current = SCENARIOS.find((s) => s.id === scenario)!;
  const nav = useMemo(() => previewNav(on), [on]);
  const tiles = useMemo(() => homeTiles(on), [on]);
  const drawers = useMemo(() => drawerActions(on), [on]);

  return (
    <Panel
      title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>Sales access <Badge tone="purple">Preview only</Badge></span>}
      description="Choose what an account may do in sales. The preview beside the switches shows the sidebar, home tiles and drawers that account would get."
    >
      <Banner tone="info" title="Preview only">Changes here are not saved yet. They show how the switches will work once organisation structure is switched on.</Banner>
      <div className="fb-rl-form">
        <Select
          label="Account"
          value={scenario}
          onChange={(e) => {
            const s = SCENARIOS.find((x) => x.id === e.target.value)!;
            setScenario(s.id);
            setOn(s.on);
          }}
          options={SCENARIOS.map((s) => ({ value: s.id, label: s.label }))}
        />
      </div>
      <div className="fb-rl-split">
        <div className="fb-rl-perms">
          <fieldset className="fb-rl-group">
            <legend>Sales participation for {current.account}</legend>
            {CAPABILITIES.map((c) => {
              const reason = lockedReason(c.n, on);
              return (
                <div key={c.n} className="fb-rl-perm">
                  <Switch
                    checked={on.includes(c.n)}
                    label={`${c.label}: ${c.help}`}
                    disabled={!mayEdit || (reason !== null && !on.includes(c.n))}
                    disabledReason={!mayEdit ? "Only Management changes sales access" : (reason ?? undefined)}
                    onChange={(v) => setOn(setSwitch(on, c.n, v))}
                  />
                  <div>
                    <div className="fb-com-strong">{c.n}. {c.label}</div>
                    <div className="fb-set-muted">{c.help}{reason && !on.includes(c.n) ? ` ${reason}` : ""}</div>
                  </div>
                </div>
              );
            })}
          </fieldset>
          <p className="fb-set-muted">Turning sales off never removes the account’s own tools, such as tasks, contacts, chat and its own pages.</p>
        </div>
        <aside className="fb-rl-preview" aria-label={`Preview as ${current.account}`}>
          <h3 className="fb-set-panel__title">Preview as {current.account}</h3>
          <div>
            <div className="fb-rl-sub">Sidebar</div>
            <ul className="fb-rl-nav">
              {nav.map((s) => <li key={s.section}><strong>{s.section}</strong>: {s.items.join(", ")}</li>)}
            </ul>
          </div>
          <div>
            <div className="fb-rl-sub">Home tiles</div>
            <ul className="fb-rl-scopes">
              {tiles.map((t) => <li key={t.label}>{t.label}: <strong>{t.value}</strong></li>)}
            </ul>
            {!on.includes(13) ? <p className="fb-set-muted">Deal values are hidden: no pipeline value, and won deals show a count.</p> : null}
          </div>
          <div>
            <div className="fb-rl-sub">Lead drawer</div>
            <p>{drawers.lead.length ? drawers.lead.join(", ") : "View only"}</p>
            <div className="fb-rl-sub">Deal drawer</div>
            <p>{drawers.deal.length ? drawers.deal.join(", ") : "No deals"}</p>
          </div>
        </aside>
      </div>
    </Panel>
  );
}
