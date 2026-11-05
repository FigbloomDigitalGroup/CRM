import type { AuthContext } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { buildCommands, searchableTypes, type Command } from "../lib/commandIndex";
import { loadFeatureConfig, requireFeature } from "./featureService";
import { resolveFeature, releaseAtLeast, type Release } from "../lib/featureFlags";
import { HELP_ARTICLES, PAGE_TIPS, RELEASE_NOTES, type HelpArticle } from "../lib/helpContent";

/**
 * Data for the command palette, Help and What's new (FIG-1149, B6.17, design X3). See docs/HELP_AND_PALETTE.md.
 *
 * Everything is filtered by the caller's permission keys and the organisation's release before it leaves, so the palette lists only
 * actions the role may perform and Help never names a screen the role cannot open. None of it carries a record or a value.
 * V1.1: each call needs the organisation to be on release V1.1.
 */

const MAX_Q = 100;

function visible<T extends { requiresAny?: readonly string[]; minRelease?: Release }>(item: T, keys: readonly string[], release: Release): boolean {
  if (item.minRelease && !releaseAtLeast(release, item.minRelease)) return false;
  return !item.requiresAny || item.requiresAny.some((k) => keys.includes(k));
}

async function releaseOf(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, "release.v11");
  const config = await loadFeatureConfig(ctx.organizationId);
  return { config, release: config.release };
}

export async function getCommandIndex(ctx: AuthContext) {
  const { config, release } = await releaseOf(ctx);
  const commands = buildCommands({
    permissionKeys: ctx.permissionKeys,
    release,
    toggles: { "assistant.enabled": resolveFeature("assistant.enabled", config).enabled },
  });
  const shortcuts: { label: string; keys: string }[] = [
    { label: "Command palette", keys: "Ctrl/Cmd K" },
    ...commands.filter((c: Command) => c.hint).map((c) => ({ label: c.title, keys: c.hint! })),
    { label: "Close any panel", keys: "Esc" },
  ];
  return {
    commands,
    search: { types: searchableTypes(ctx.permissionKeys), minQueryLength: 2, path: "/search" },
    shortcuts,
  };
}

function toIndexItem(a: HelpArticle) {
  return { slug: a.slug, title: a.title, area: a.area, summary: a.summary };
}

export async function listHelpArticles(ctx: AuthContext, options: { q?: string; area?: string; page?: string } = {}) {
  const { release } = await releaseOf(ctx);
  const q = (options.q ?? "").trim().toLowerCase();
  if (q.length > MAX_Q) throw new ValidationError(`q is at most ${MAX_Q} characters.`, [{ path: "q", message: `At most ${MAX_Q} characters.` }]);
  if (options.page !== undefined && !(options.page in PAGE_TIPS)) throw new ValidationError("Unknown page.", [{ path: "page", message: `Use one of ${Object.keys(PAGE_TIPS).join(", ")}.` }]);
  const items = HELP_ARTICLES.filter((a) => visible(a, ctx.permissionKeys, release))
    .filter((a) => !options.area || a.area === options.area)
    .filter((a) => !q || [a.title, a.summary, ...a.body, ...a.keywords].some((t) => t.toLowerCase().includes(q)))
    .map(toIndexItem);
  return { items, tips: options.page ? PAGE_TIPS[options.page]! : null };
}

export async function getHelpArticle(ctx: AuthContext, slug: string) {
  const { release } = await releaseOf(ctx);
  const article = HELP_ARTICLES.find((a) => a.slug === slug);
  // The same answer for an article that does not exist and one written for a role this person does not hold.
  if (!article || !visible(article, ctx.permissionKeys, release)) throw new NotFoundError("HelpArticle", slug);
  return { ...toIndexItem(article), body: article.body, keywords: article.keywords };
}

export async function getWhatsNew(ctx: AuthContext, options: { since?: string; limit?: number } = {}) {
  const { release } = await releaseOf(ctx);
  if (options.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.since)) throw new ValidationError("since must look like 2026-11-17.", [{ path: "since", message: "Use YYYY-MM-DD." }]);
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ValidationError("limit is 1 to 100.", [{ path: "limit", message: "1 to 100." }]);
  const items = RELEASE_NOTES.filter((n) => releaseAtLeast(release, n.release))
    .filter((n) => !n.requiresAny || n.requiresAny.some((k) => ctx.permissionKeys.includes(k)))
    .filter((n) => !options.since || n.date > options.since)
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((n) => ({ id: n.id, release: n.release, date: n.date, title: n.title, detail: n.detail }));
  return { release, items };
}
