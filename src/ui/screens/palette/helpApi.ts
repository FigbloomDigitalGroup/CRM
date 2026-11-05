"use client";

import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { NEWS, SHORTCUTS, TIPS, pageKey, type NewsItem } from "./helpContent";

export interface HelpIndexItem {
  slug: string;
  title: string;
  area: string;
  summary: string;
}
export interface HelpArticleDto extends HelpIndexItem {
  body: string[];
}

/** The Help panel's content for one page: role-filtered tips, release notes and shortcuts from the API; the written fallback when it cannot answer. */
export function useHelpContent(pathname: string, active: boolean) {
  const { orgSlug } = useMember();
  const page = pageKey(pathname, orgSlug);
  const help = useApiQuery("getHelp", { params: { orgSlug }, query: { page } }, { enabled: active, retry: false, staleTime: 60_000 });
  const news = useApiQuery("getWhatsNew", { params: { orgSlug }, query: { limit: 3 } }, { enabled: active, retry: false, staleTime: 60_000 });
  const keys = useApiQuery("getCommands", { params: { orgSlug } }, { enabled: active, retry: false, staleTime: 60_000 });

  const tips = (help.data as { tips?: { title: string; tips: string[] } | null } | undefined)?.tips ?? TIPS[page]!;
  const items: NewsItem[] = news.data
    ? ((news.data as { items: { release: string; title: string; detail: string }[] }).items.map((n) => ({ tag: (n.release === "v2" ? "V2" : n.release === "v1.1" ? "V1.1" : "V1") as NewsItem["tag"], title: n.title, detail: n.detail })))
    : NEWS.slice(0, 3);
  const shortcuts = (keys.data as { shortcuts?: { label: string; keys: string }[] } | undefined)?.shortcuts ?? SHORTCUTS;
  return { tips, news: items, shortcuts, fromServer: help.isSuccess, loading: help.isLoading };
}
