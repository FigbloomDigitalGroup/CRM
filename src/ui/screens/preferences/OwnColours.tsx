"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { lookColours, type OwnColourField } from "@/preferences/catalogue";
import { Button, useAppearance } from "@/ui";
import { evaluateOwnColours, isChanged, OWN_LABELS, type OwnDraft } from "@/ui/theme/ownColours";
import { useSavePreferences } from "./hooks";
import type { PreferencesView } from "./model";

const FIELDS: OwnColourField[] = ["sidebar", "accent", "highlight", "page"];

/**
 * Your own colours (AP4, FIG-1176): hex and picker for the sidebar, accent, highlight and page, a live preview with the buttons darkened until
 * white text reads on them, and a check that mirrors the server's. Save stays off, with the reason beside it, until every colour passes AA, so
 * no combination below AA can be saved. Available only while the organisation allows personalisation and has not locked the look.
 */
export function OwnColours({ view }: { view: PreferencesView }) {
  const appearance = useAppearance();
  const { save } = useSavePreferences();
  const eff = view.appearance.effective;
  const base = useMemo(() => {
    const b = lookColours(eff.theme, eff.pageColour);
    return { sidebar: b.sidebar, accent: b.accent, highlight: b.highlight, page: b.page.hex ?? eff.colours.page.hex ?? "#FAF9F7" };
  }, [eff.theme, eff.pageColour, eff.colours.page.hex]);
  const initial: OwnDraft = useMemo(() => ({ ...base, ...(eff.ownColours ?? {}) }), [base, eff.ownColours]);
  const [draft, setDraft] = useState<OwnDraft>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(initial), [initial]);

  const allowed = view.personalisation.ownColoursAvailable;
  const locked = view.personalisation.locked;
  const report = useMemo(() => evaluateOwnColours(draft, base), [draft, base]);
  const hasOwn = Boolean(eff.ownColours && Object.keys(eff.ownColours).length > 0);
  const changed = isChanged(draft, initial);

  if (!allowed || locked) {
    return (
      <section className="fb-prefs__card" aria-labelledby="prefs-own" data-testid="prefs-own-colours">
        <div className="fb-prefs__cardhead">
          <h2 id="prefs-own">Your own colours</h2>
          <span className="fb-own__rel">V1.1</span>
        </div>
        <p className="fb-prefs__note" role="status">
          <Lock size={16} aria-hidden="true" />
          <span>
            {locked
              ? "Your organisation uses a shared look, so personal colours are switched off. A Management member can change this in Settings."
              : "Your organisation has not turned on personal colours. A Management member can allow them in Settings, under Organisation appearance."}
          </span>
        </p>
      </section>
    );
  }

  const applyView = (v: PreferencesView) => appearance.setLook({ locked: v.appearance.effective.locked, toggle: v.appearance.effective.toggle, colours: v.appearance.effective.colours });
  const previous = appearance.look;

  async function saveOwn(own: Record<string, string> | null, message: string) {
    setBusy(true);
    try {
      await save({ body: { ownColours: own }, message, undoBody: { ownColours: eff.ownColours ?? null }, revert: () => appearance.setLook(previous), reapply: applyView });
    } finally {
      setBusy(false);
    }
  }

  const set = (field: OwnColourField, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const saveReason = !report.canSave
    ? "Fix the colours marked below first. Every colour must read at the AA level (4.5:1)."
    : !changed
      ? "Change a colour to save."
      : undefined;
  const p = report.preview;

  return (
    <section className="fb-prefs__card" aria-labelledby="prefs-own" data-testid="prefs-own-colours">
      <div className="fb-prefs__cardhead">
        <h2 id="prefs-own">Your own colours</h2>
        <span className="fb-own__rel">V1.1</span>
      </div>
      <p className="fb-prefs__hint">Pick any colours you like. We check every one for readability and darken buttons where white text would be hard to read.</p>
      <div className="fb-own">
        <div className="fb-own__fields">
          {FIELDS.map((field) => {
            const r = report.fields.find((f) => f.field === field)!;
            const id = `own-${field}`;
            return (
              <div key={field} className="fb-own__field">
                <label className="fb-own__label" htmlFor={`${id}-hex`}>
                  {OWN_LABELS[field]}
                </label>
                <span className="fb-own__inputs">
                  <input type="color" className="fb-own__picker" aria-label={`${OWN_LABELS[field]} picker`} value={r.valid ? r.value.toLowerCase() : "#000000"} onChange={(e) => set(field, e.target.value.toUpperCase())} />
                  <input id={`${id}-hex`} className="fb-own__hex" value={draft[field]} aria-invalid={r.blocked || undefined} aria-describedby={r.note ? `${id}-note` : undefined} spellCheck={false} onChange={(e) => set(field, e.target.value)} />
                </span>
                {r.note ? (
                  <span id={`${id}-note`} className="fb-own__note" data-blocked={r.blocked || undefined} role={r.blocked ? "alert" : "status"}>
                    <AlertTriangle size={13} aria-hidden="true" /> {r.note}
                    {r.blocked && r.suggestion ? (
                      <button type="button" className="fb-own__fix" onClick={() => set(field, r.suggestion!)}>
                        Use {r.suggestion}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="fb-own__preview" data-testid="own-preview">
          <div className="fb-own__stage">
            <div className="fb-own__side" style={{ background: p.sidebar }}>
              <i style={{ background: p.sidebarText, opacity: 0.9 }} />
              <i style={{ background: p.sidebarText, opacity: 0.4 }} />
              <i style={{ background: p.sidebarText, opacity: 0.4 }} />
            </div>
            <div className="fb-own__page" style={{ background: p.page }}>
              <i className="fb-own__line" />
              <span className="fb-own__btn" style={{ background: p.button }}>
                Button
              </span>
              <span className="fb-own__hl">
                <b style={{ background: p.dot }} />
                Highlight
              </span>
            </div>
          </div>
          <div className="fb-own__cap">Live preview{p.buttonDarkened ? ` · buttons darkened to ${p.button} for contrast` : ""}</div>
        </div>
      </div>
      <div className="fb-own__actions">
        <Button variant="primary" disabled={!report.canSave || !changed || busy} disabledReason={saveReason} onClick={() => void saveOwn(report.colours as Record<string, string>, "Your colours were saved.")}>
          Save my colours
        </Button>
        <Button variant="secondary" disabled={!hasOwn || busy} disabledReason={!hasOwn ? "You are already using the theme’s colours." : undefined} onClick={() => void saveOwn(null, "Back to the theme’s colours.")}>
          Use the theme’s colours
        </Button>
      </div>
    </section>
  );
}
