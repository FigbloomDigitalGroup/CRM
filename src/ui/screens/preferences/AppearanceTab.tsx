"use client";

import { Lock, Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PAGE_COLOURS, THEMES, findPageColour, findTheme, lookColours } from "@/preferences/catalogue";
import { ConfirmDialog, ErrorState, LoadingState, Select, useAppearance, useApiMutation, useMember, useToast } from "@/ui";
import { DEFAULT_DEVICE, TEXT_SIZES, type LookInput, type TextSize } from "@/ui/theme/resolve";
import { usePreferencesQuery, useSavePreferences } from "./hooks";
import type { EffectiveLookView, PreferencesView } from "./model";

const TEXT_LABEL: Record<TextSize, string> = { SMALL: "Small", DEFAULT: "Default", LARGE: "Large", EXTRA_LARGE: "Largest" };
const HOUR_LABEL: Record<string, string> = { H12: "12-hour (3:12 PM)", H24: "24-hour (15:12)" };
const WEEK_LABEL: Record<string, string> = { MON: "Monday", SUN: "Sunday", SAT: "Saturday" };
const DATE_LABEL: Record<string, string> = { DMY: "19 Oct 2026", MDY: "Oct 19, 2026", YMD: "2026-10-19" };
const LOCKED_REASON = "Your organisation uses a shared look. Ask a Management member to change it in Settings, under Organisation appearance.";

const A11Y = [
  { key: "bold", label: "Bolder text", help: "Heavier weight for body text." },
  { key: "higherContrast", label: "Higher contrast", help: "Darker secondary text and borders." },
  { key: "reduceMotion", label: "Reduce motion", help: "Turns off animations. Your device’s setting is respected too." },
  { key: "statusMarkers", label: "Status shapes", help: "A shape beside every status, so colour is never the only signal." },
] as const;

/** The date and time choices written out, so the effect of a choice is visible before leaving the page. */
export function previewDateTime(dateFormat: string, hourFormat: string, week: string): string {
  const date = dateFormat === "MDY" ? "Oct 19, 2026" : dateFormat === "YMD" ? "2026-10-19" : "19 Oct 2026";
  const time = hourFormat === "H24" ? "15:12" : "3:12 PM";
  return `${date}, ${time} · week starts ${WEEK_LABEL[week] ?? "Monday"}`;
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <div className="fb-prefs__seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} data-on={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Scope({ where }: { where: "account" | "device" }) {
  return where === "device" ? (
    <span className="fb-prefs__scope"><Smartphone size={12} aria-hidden="true" /> This device only</span>
  ) : (
    <span className="fb-prefs__scope"><Monitor size={12} aria-hidden="true" /> Follows your account</span>
  );
}

export function AppearanceTab({ resetOpen, onResetClose }: { resetOpen: boolean; onResetClose: () => void }) {
  const { orgSlug } = useMember();
  const { prefs: view, isLoading, error, refetch } = usePreferencesQuery();
  const { save, queryKey } = useSavePreferences();
  const appearance = useAppearance();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const reset = useApiMutation("resetMyAppearance");
  const undoReset = useApiMutation("undoMyReset");
  const [busy, setBusy] = useState(false);

  const eff = view?.appearance.effective;
  const locked = Boolean(view?.personalisation.locked);
  const sharedName = useMemo(() => (view ? findTheme(view.appearance.organisationDefault.theme)?.label ?? "a theme" : ""), [view]);

  if (isLoading) return <LoadingState label="Loading your appearance settings" lines={6} />;
  if (error || !view || !eff) return <ErrorState error={error} area="Appearance" onRetry={() => void refetch()} />;

  const lookFrom = (e: EffectiveLookView, over: Partial<{ theme: string; page: string; toggle: { light: string; dark: string } }> = {}): LookInput => {
    const base = lookColours(over.theme ?? e.theme, over.page ?? e.pageColour);
    return { locked: e.locked, toggle: over.toggle ?? e.toggle, colours: { sidebar: base.sidebar, accent: base.accent, highlight: base.highlight, page: base.page } };
  };
  const applyView = (v: PreferencesView) => {
    appearance.setLook({ locked: v.appearance.effective.locked, toggle: v.appearance.effective.toggle, colours: v.appearance.effective.colours });
    appearance.setDensity(v.appearance.density);
  };
  const previousLook = appearance.look;
  const previousDensity = view.appearance.density;
  const revert = () => {
    appearance.setLook(previousLook);
    appearance.setDensity(previousDensity);
  };

  function pickTheme(key: string) {
    if (locked || !eff) return;
    appearance.setLook(lookFrom(eff, { theme: key }));
    void save({ body: { theme: key }, message: `Theme: ${findTheme(key)?.label}.`, undoBody: { theme: eff.theme }, revert, reapply: applyView });
  }

  function pickPage(key: string) {
    if (locked || !eff) return;
    const def = findPageColour(key);
    const toggle = { ...eff.toggle };
    if (def?.hex) {
      if (def.dark) toggle.dark = key;
      else toggle.light = key;
    }
    const body: Record<string, unknown> = { pageColour: key };
    if (def?.hex) body.toggle = def.dark ? { dark: key } : { light: key };
    appearance.setLook(lookFrom(eff, { page: key, toggle }));
    void save({ body, message: `Page colour: ${def?.label}.`, undoBody: { pageColour: eff.pageColour, toggle: eff.toggle }, revert, reapply: applyView });
  }

  function pickDensity(id: "COMFORTABLE" | "COMPACT") {
    appearance.setDensity(id);
    void save({ body: { density: id }, message: `Density: ${id === "COMPACT" ? "compact" : "comfortable"}.`, undoBody: { density: previousDensity }, revert, reapply: applyView });
  }

  async function doReset() {
    setBusy(true);
    try {
      const out = (await reset.mutateAsync({ params: { orgSlug } })) as unknown as { preferences: PreferencesView; undo: { token: string } };
      const previousDevice = appearance.device;
      qc.setQueryData(queryKey, out.preferences);
      applyView(out.preferences);
      appearance.setDevice({ ...DEFAULT_DEVICE, scheme: null });
      router.refresh();
      onResetClose();
      toast.show({
        message: "Appearance reset to default.",
        undo: async () => {
          const back = (await undoReset.mutateAsync({ params: { orgSlug }, body: { token: out.undo.token } as never })) as unknown as PreferencesView;
          qc.setQueryData(queryKey, back);
          applyView(back);
          appearance.setDevice(previousDevice);
          router.refresh();
        },
      });
    } finally {
      setBusy(false);
    }
  }

  const dev = appearance.device;

  return (
    <div className="fb-prefs__stack" data-testid="prefs-appearance">
      {locked ? (
        <div role="status" className="fb-prefs__note" data-testid="prefs-shared-look">
          <Lock size={16} aria-hidden="true" />
          <span>
            <strong>Your organisation uses a shared look.</strong> Management chose {sharedName} for everyone. Text size, density and accessibility are still yours.
          </span>
        </div>
      ) : null}

      <section className="fb-prefs__card" aria-labelledby="prefs-themes">
        <div className="fb-prefs__cardhead"><h2 id="prefs-themes">Themes</h2><Scope where="account" /></div>
        <p className="fb-prefs__hint">A sidebar colour paired with an accent. Status colours never change.</p>
        <div className="fb-prefs__themes" role="radiogroup" aria-label="Theme" aria-describedby={locked ? "prefs-locked-why" : undefined}>
          {THEMES.map((t) => {
            const on = eff.theme === t.key;
            return (
              <button key={t.key} type="button" role="radio" aria-checked={on} aria-disabled={locked || undefined} title={locked ? LOCKED_REASON : undefined} className="fb-prefs__theme" data-on={on} onClick={() => pickTheme(t.key)}>
                <span className="fb-prefs__themeprev" aria-hidden="true">
                  <span style={{ width: "30%", background: t.sidebar }} />
                  <span className="fb-prefs__themepage">
                    <i style={{ background: t.accent, left: 8, top: 10, width: "48%", height: 7 }} />
                    <i style={{ background: "var(--border)", left: 8, top: 23, width: "30%", height: 5 }} />
                    <i style={{ background: t.highlight, right: 8, bottom: 8, width: 10, height: 10, borderRadius: 99 }} />
                  </span>
                </span>
                <span className="fb-prefs__themename">
                  <span>{t.label}{t.key === "FOREST" ? " (default)" : ""}</span>
                  {on ? <span className="fb-prefs__selected">Selected</span> : null}
                </span>
              </button>
            );
          })}
        </div>
        {locked ? <p id="prefs-locked-why" className="fb-prefs__hint">{LOCKED_REASON}</p> : null}
      </section>

      <section className="fb-prefs__card" aria-labelledby="prefs-pages">
        <div className="fb-prefs__cardhead"><h2 id="prefs-pages">Page colours</h2><Scope where="account" /></div>
        <p className="fb-prefs__hint">The light/dark button in the top bar flips between your chosen light and dark page.</p>
        <div className="fb-prefs__pages" role="radiogroup" aria-label="Page colour" aria-describedby={locked ? "prefs-locked-why" : undefined}>
          {PAGE_COLOURS.map((p) => {
            const on = eff.pageColour === p.key;
            return (
              <button key={p.key} type="button" role="radio" aria-checked={on} aria-disabled={locked || undefined} title={locked ? LOCKED_REASON : undefined} className="fb-prefs__page" data-on={on} onClick={() => pickPage(p.key)}>
                <span className="fb-prefs__pageprev" style={{ background: p.hex ?? "linear-gradient(90deg,#faf9f7 50%,#0f1512 50%)" }} aria-hidden="true">
                  {p.hex === null ? <Monitor size={18} color="#878a83" /> : null}
                </span>
                <span className="fb-prefs__pagename">{p.label}{p.key === "WHITE" ? " (default)" : ""}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="fb-prefs__grid">
        <section className="fb-prefs__card" aria-labelledby="prefs-density">
          <div className="fb-prefs__cardhead"><h2 id="prefs-density">Density</h2><Scope where="account" /></div>
          <Seg label="Density" value={view.appearance.density === "COMPACT" ? "COMPACT" : "COMFORTABLE"} options={[{ id: "COMFORTABLE", label: "Comfortable" }, { id: "COMPACT", label: "Compact" }]} onChange={pickDensity} />
          <div className="fb-prefs__sample" aria-hidden="true">
            {[["Sarova Hotels", "WARM"], ["Two Rivers Mall", "HOT"]].map(([n, b]) => (
              <div key={n} className="fb-prefs__samplerow"><strong>{n}</strong><span data-band={b}>{b}</span></div>
            ))}
          </div>
        </section>

        <section className="fb-prefs__card" aria-labelledby="prefs-text">
          <div className="fb-prefs__cardhead"><h2 id="prefs-text">Text size</h2><Scope where="device" /></div>
          <Seg label="Text size" value={dev.textSize} options={TEXT_SIZES.map((s) => ({ id: s, label: TEXT_LABEL[s] }))} onChange={(s) => appearance.setDevice({ textSize: s })} />
          <p className="fb-prefs__hint">Scales text, buttons and spacing together. Checked at Largest on desktop and at 375px.</p>
        </section>

        <section className="fb-prefs__card" aria-labelledby="prefs-a11y">
          <div className="fb-prefs__cardhead"><h2 id="prefs-a11y">Accessibility</h2><Scope where="device" /></div>
          {A11Y.map((a) => (
            <label key={a.key} className="fb-prefs__check">
              <input type="checkbox" checked={dev[a.key]} onChange={(e) => appearance.setDevice({ [a.key]: e.target.checked })} />
              <span><span className="fb-prefs__checkl">{a.label}</span><span className="fb-prefs__hint">{a.help}</span></span>
            </label>
          ))}
        </section>

        <section className="fb-prefs__card" aria-labelledby="prefs-start">
          <div className="fb-prefs__cardhead"><h2 id="prefs-start">Start page and sidebar</h2><Scope where="account" /></div>
          <Select
            label="After sign-in, open"
            value={view.startPage.key ?? ""}
            help={view.startPage.unavailable ? "Your saved start page is no longer available to your role, so you land on the dashboard." : undefined}
            options={[{ value: "", label: "Dashboard (default)" }, ...view.startPage.options.filter((o) => o.key !== "dashboard").map((o) => ({ value: o.key, label: o.label }))]}
            onChange={(e) => void save({ body: { startPage: e.target.value || null }, message: "Start page saved.", undoBody: { startPage: view.startPage.key } })}
          />
          <Select
            label="Sidebar starts"
            value={view.sidebar.collapsed ? "collapsed" : "expanded"}
            options={[{ value: "expanded", label: "Expanded" }, { value: "collapsed", label: "Collapsed" }]}
            onChange={(e) => void save({ body: { sidebar: { collapsed: e.target.value === "collapsed" } }, message: "Sidebar setting saved.", undoBody: { sidebar: { collapsed: view.sidebar.collapsed } }, refreshShell: true })}
          />
          <fieldset className="fb-prefs__fieldset">
            <legend className="fb-label">Pages in my sidebar</legend>
            {view.startPage.options.filter((o) => o.key !== "dashboard").map((o) => {
              const shown = !view.sidebar.hidden.includes(o.key);
              return (
                <label key={o.key} className="fb-prefs__inline">
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={(e) => {
                      const hidden = e.target.checked ? view.sidebar.hidden.filter((h) => h !== o.key) : [...view.sidebar.hidden, o.key];
                      void save({ body: { sidebar: { hidden } }, message: `${o.label} ${e.target.checked ? "shown in" : "hidden from"} your sidebar.`, undoBody: { sidebar: { hidden: view.sidebar.hidden } }, refreshShell: true });
                    }}
                  />
                  {o.label}
                </label>
              );
            })}
            <span className="fb-prefs__hint">Hiding a page only removes the link. You can still open it from search, and your access does not change.</span>
          </fieldset>
        </section>

        <section className="fb-prefs__card" aria-labelledby="prefs-dt">
          <div className="fb-prefs__cardhead"><h2 id="prefs-dt">Date, time and numbers</h2><Scope where="account" /></div>
          <Select label="Clock" value={view.regional.hourFormat} options={Object.entries(HOUR_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e) => void save({ body: { hourFormat: e.target.value }, message: "Clock saved.", undoBody: { hourFormat: view.regional.hourFormat }, refreshShell: true })} />
          <Select label="Week starts on" value={view.regional.firstDayOfWeek} options={Object.entries(WEEK_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e) => void save({ body: { firstDayOfWeek: e.target.value }, message: "First day of the week saved.", undoBody: { firstDayOfWeek: view.regional.firstDayOfWeek } })} />
          <Select label="Date format" value={view.regional.dateFormat} options={Object.entries(DATE_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e) => void save({ body: { dateFormat: e.target.value }, message: "Date format saved.", undoBody: { dateFormat: view.regional.dateFormat } })} />
          <div className="fb-prefs__preview" data-testid="prefs-dt-preview">Preview: <strong>{previewDateTime(view.regional.dateFormat, view.regional.hourFormat, view.regional.firstDayOfWeek)}</strong> · currency stays KES</div>
          <p className="fb-prefs__hint">Your time zone is set on the Profile tab.</p>
        </section>
      </div>

      <section className="fb-prefs__saved">
        <strong>What is saved where.</strong> Theme, page colours, density, start page, sidebar, date and time, and your profile picture are saved to your account and follow you to other devices. Text size, bolder text, higher contrast, reduce motion and status shapes are saved on this device only. Status colours (overdue red, warning amber, success green), scope pills, hidden values and the archived banner never change with a theme.
      </section>

      <ConfirmDialog
        open={resetOpen}
        onClose={onResetClose}
        title="Reset appearance to default?"
        body={
          locked
            ? "Density goes back to comfortable, text size to default and accessibility to off. The look stays your organisation’s shared look. Your profile and notifications don’t change."
            : "Theme goes back to Forest on White, density to comfortable, text size to default and accessibility to off. Your profile and notifications don’t change. You can undo this for a few minutes."
        }
        confirmLabel="Reset"
        onConfirm={doReset}
      />
      <span className="fb-sr-only" aria-live="polite">{busy ? "Resetting" : ""}</span>
    </div>
  );
}
