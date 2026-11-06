"use client";

import { HelpCircle, Lightbulb, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ContactSupportDialog } from "./ContactSupportDialog";
import { useHelpContent } from "./helpApi";

/** The Help panel (X3): tips for the page you are on, what's new and the shortcuts. Escape closes it and focus goes back. */
export function HelpPanel({ open, onClose, pathname, orgSlug }: { open: boolean; onClose: () => void; pathname: string; orgSlug: string }) {
  const ref = useRef<HTMLElement>(null);
  const [contacting, setContacting] = useState(false);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => opener?.focus?.();
  }, [open]);
  const content = useHelpContent(pathname, open);
  if (!open) return null;
  const page = content.tips;
  return (
    <aside ref={ref} className="fb-help-panel" role="complementary" aria-label="Help" tabIndex={-1} data-testid="help-panel" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <header className="fb-help-panel__head">
        <HelpCircle size={18} aria-hidden="true" />
        <strong>Help · {page.title}</strong>
        <button type="button" aria-label="Close help" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="fb-help-panel__tips">
        {page.tips.map((t) => (
          <div key={t} className="fb-help-panel__tip">
            <Lightbulb size={15} aria-hidden="true" />
            <span>{t}</span>
          </div>
        ))}
      </div>
      <section aria-labelledby="help-news">
        <h3 id="help-news" className="fb-help-panel__label">WHAT’S NEW</h3>
        {content.news.map((n) => (
          <div key={n.title} className="fb-help-panel__news">
            <strong>{n.title}</strong> <span className="fb-help-panel__tag">{n.tag}</span>
            <div>{n.detail}</div>
          </div>
        ))}
      </section>
      <section aria-labelledby="help-keys">
        <h3 id="help-keys" className="fb-help-panel__label">Keyboard shortcuts</h3>
        {content.shortcuts.map((k) => (
          <div key={k.label} className="fb-help-panel__key">
            <span>{k.label}</span>
            <kbd>{k.keys}</kbd>
          </div>
        ))}
      </section>
      <p className="fb-help-panel__more">
        <a href={`/o/${orgSlug}/help`}>Open the Help centre</a> · <a href={`/o/${orgSlug}/help/whats-new`}>All that’s new</a>
      </p>
      <p className="fb-help-panel__more">
        Need a person? <button type="button" className="fb-help-panel__contact" onClick={() => setContacting(true)}>Contact support</button>
      </p>
      {contacting ? <ContactSupportDialog onClose={() => setContacting(false)} /> : null}
    </aside>
  );
}
