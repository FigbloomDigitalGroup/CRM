import { createHash } from "node:crypto";
import type { AuthContext } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { loadFeatureConfig } from "../lib/featureConfig";
import { MAX_BATCH, OFFLINE_SAFE_KINDS, SERVER_WINS_KINDS } from "./syncService";
import { readOrganizationLook } from "./organizationLookService";

/**
 * PWA install data and the cache version (FIG-1064, B4.07, design S3 and M4).
 *
 * The manifest is built from the organisation's own look (its shown name and colours), so "Add to home screen" installs the
 * organisation's CRM, not a generic one. The cache version is a short fingerprint of everything that should make an
 * installed app throw its offline cache away: the app build, the active release, the organisation's look and its feature
 * toggles. When the number a phone holds differs from this one, it refreshes. Any signed-in member may read both.
 */

export const SYNC_API_VERSION = 1;

function appVersion(): string {
  return process.env.APP_VERSION?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "dev";
}

export async function getPwaManifest(ctx: AuthContext) {
  const [look, org] = await Promise.all([
    readOrganizationLook(ctx.organizationId),
    adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { slug: true } }),
  ]);
  const shortName = look.shownName.length > 12 ? look.shownName.slice(0, 12).trim() : look.shownName;
  return {
    name: look.shownName,
    short_name: shortName,
    description: `${look.shownName} CRM`,
    start_url: `/o/${org.slug}`,
    scope: `/o/${org.slug}`,
    display: "standalone",
    orientation: "portrait",
    background_color: look.colours.page.hex ?? "#ffffff",
    theme_color: look.colours.accent,
    categories: ["business", "productivity"],
    // A signed logo link expires in minutes, so it cannot be an install icon; the brand icon is a static file.
    // Chrome and Android install only with 192 and 512 px PNGs; the maskable one fills the circle or squircle a phone crops it to (FIG-791).
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export async function getPwaVersion(ctx: AuthContext, now = new Date()) {
  const [org, config] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { displayName: true, defaultTheme: true, defaultPageColour: true, logoFileId: true, showLogoOnClientPages: true },
    }),
    loadFeatureConfig(ctx.organizationId),
  ]);
  const fingerprint = JSON.stringify([appVersion(), SYNC_API_VERSION, config.release, config.toggles, org]);
  const cacheVersion = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
  return {
    cacheVersion,
    appVersion: appVersion(),
    syncApiVersion: SYNC_API_VERSION,
    release: config.release,
    offline: {
      maxBatch: MAX_BATCH,
      safeKinds: [...OFFLINE_SAFE_KINDS],
      serverWinsKinds: [...SERVER_WINS_KINDS],
      // The pipeline can be read offline, never edited (design M2).
      readOnly: ["pipeline", "deals", "ownership"],
    },
    serverTime: now,
  };
}
