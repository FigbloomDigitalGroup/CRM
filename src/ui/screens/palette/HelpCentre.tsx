import { NEWS, SHORTCUTS, TIPS } from "./helpContent";

/** The Help centre and What's new pages (X3, FIG-1172): the same copy as the Help panel, laid out as pages. Server-renderable: no state. */
export function HelpCentre({ orgSlug, view }: { orgSlug: string; view: "help" | "news" }) {
  return (
    <div className="fb-helpc">
      <h1 className="fb-helpc__title">{view === "news" ? "What’s new" : "Help centre"}</h1>
      <nav className="fb-helpc__tabs" aria-label="Help sections">
        <a href={`/o/${orgSlug}/help`} aria-current={view === "help" ? "page" : undefined}>Help</a>
        <a href={`/o/${orgSlug}/help/whats-new`} aria-current={view === "news" ? "page" : undefined}>What’s new</a>
      </nav>
      {view === "news" ? (
        <section aria-label="What’s new" className="fb-helpc__card">
          {NEWS.map((n) => (
            <article key={n.title} className="fb-helpc__news">
              <h2>
                {n.title} <span className="fb-helpc__tag">{n.tag}</span>
              </h2>
              <p>{n.detail}</p>
            </article>
          ))}
        </section>
      ) : (
        <>
          <section aria-labelledby="help-tips" className="fb-helpc__card">
            <h2 id="help-tips">Tips by page</h2>
            {Object.values(TIPS).map((p) => (
              <div key={p.title} className="fb-helpc__page">
                <h3>{p.title}</h3>
                <ul>
                  {p.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <section aria-labelledby="help-keys" className="fb-helpc__card">
            <h2 id="help-keys">Keyboard shortcuts</h2>
            {SHORTCUTS.map((k) => (
              <div key={k.label} className="fb-helpc__key">
                <span>{k.label}</span>
                <kbd>{k.keys}</kbd>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
