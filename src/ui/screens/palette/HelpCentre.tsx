"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { SHORTCUTS } from "./helpContent";
import type { HelpArticleDto, HelpIndexItem } from "./helpApi";

function Article({ item }: { item: HelpIndexItem }) {
  const { orgSlug } = useMember();
  const [open, setOpen] = useState(false);
  const q = useApiQuery("getHelpBySlug", { params: { orgSlug, slug: item.slug } }, { enabled: open, retry: false, staleTime: 300_000 });
  const body = (q.data as HelpArticleDto | undefined)?.body ?? [];
  return (
    <div className="fb-helpc__page">
      <h3>{item.title}</h3>
      <p>{item.summary}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Read"}
      </button>
      {open ? (
        q.isLoading ? (
          <LoadingState label="Loading the article" lines={2} />
        ) : q.error ? (
          <ErrorState error={q.error} area="This article" onRetry={() => void q.refetch()} />
        ) : (
          body.map((p) => <p key={p}>{p}</p>)
        )
      ) : null}
    </div>
  );
}

/**
 * The Help centre and What's new pages (X3, FIG-1172): the articles and release notes the API offers this role and release
 * (`/help`, `/help/{slug}`, `/whats-new`, docs/HELP_AND_PALETTE.md), so Help never describes a screen the person cannot open.
 */
export function HelpCentre({ orgSlug, view }: { orgSlug: string; view: "help" | "news" }) {
  const help = useApiQuery("getHelp", { params: { orgSlug } }, { enabled: view === "help", retry: false });
  const news = useApiQuery("getWhatsNew", { params: { orgSlug } }, { enabled: view === "news", retry: false });
  const cmds = useApiQuery("getCommands", { params: { orgSlug } }, { enabled: view === "help", retry: false });
  const active = view === "news" ? news : help;
  const articles = (help.data as { items?: HelpIndexItem[] } | undefined)?.items ?? [];
  const notes = (news.data as { items?: { id: string; release: string; title: string; detail: string; date: string }[] } | undefined)?.items ?? [];
  const shortcuts = (cmds.data as { shortcuts?: { label: string; keys: string }[] } | undefined)?.shortcuts ?? SHORTCUTS;

  return (
    <div className="fb-helpc">
      <h1 className="fb-helpc__title">{view === "news" ? "What’s new" : "Help centre"}</h1>
      <nav className="fb-helpc__tabs" aria-label="Help sections">
        <Link href={`/o/${orgSlug}/help`} aria-current={view === "help" ? "page" : undefined}>Help</Link>
        <Link href={`/o/${orgSlug}/help/whats-new`} aria-current={view === "news" ? "page" : undefined}>What’s new</Link>
      </nav>
      {active.isLoading ? (
        <LoadingState label="Loading" />
      ) : active.error ? (
        <ErrorState error={active.error} area={view === "news" ? "What’s new" : "The Help centre"} onRetry={() => void active.refetch()} />
      ) : view === "news" ? (
        <section aria-label="What’s new" className="fb-helpc__card">
          {notes.length === 0 ? <p>Nothing new for your role yet.</p> : null}
          {notes.map((n) => (
            <article key={n.id} className="fb-helpc__news">
              <h2>
                {n.title} <span className="fb-helpc__tag">{n.release.toUpperCase()}</span>
              </h2>
              <p>{n.detail}</p>
            </article>
          ))}
        </section>
      ) : (
        <>
          <section aria-labelledby="help-tips" className="fb-helpc__card">
            <h2 id="help-tips">Articles</h2>
            {articles.length === 0 ? <p>No articles for your role yet.</p> : null}
            {articles.map((a) => (
              <Article key={a.slug} item={a} />
            ))}
          </section>
          <section aria-labelledby="help-keys" className="fb-helpc__card">
            <h2 id="help-keys">Keyboard shortcuts</h2>
            {shortcuts.map((k) => (
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
