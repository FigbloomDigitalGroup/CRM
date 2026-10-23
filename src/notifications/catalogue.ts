import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { canUseResource } from "../auth/permissions";
import type { Release } from "../lib/featureFlags";
import { releaseAtLeast } from "../lib/featureFlags";

/**
 * The nine things the CRM can tell a person about (FIG-1027, B1.11), which of
 * them apply to which role, which count as "important", and the three presets.
 * The raisers for most of the new types arrive with the features they belong to
 * (mentions, renewals, proposals, stalled deals, support access); the
 * preferences exist now so nobody has to be asked twice later.
 */
export const NOTIFICATION_TYPES = [
  "LEAD_ASSIGNED",
  "TASK_DUE",
  "TASK_OVERDUE",
  "DEAL_WON_HANDOFF",
  "MENTION",
  "RENEWAL_DUE",
  "PROPOSAL_UNANSWERED",
  "STALLED_DEAL",
  "SUPPORT_ACCESS_REQUEST",
] as const;
export type NotificationTypeKey = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationTypeDef {
  key: NotificationTypeKey;
  label: string;
  description: string;
  /** Part of the "Important only" preset. */
  important: boolean;
  /** Cannot be switched off in either channel: a missed overdue task is the one thing this must never hide. */
  alwaysOn: boolean;
  /** Does this role ever receive it? Irrelevant types are not listed or accepted. */
  relevant: (ctx: AuthContext, release: Release) => boolean;
}

const canWorkLeads = (c: AuthContext) => hasPermission(c, "leads.view.own") || hasPermission(c, "leads.view.all");
const canWorkTasks = (c: AuthContext) => hasPermission(c, "tasks.view.own") || hasPermission(c, "tasks.view.all");

export const TYPE_DEFS: readonly NotificationTypeDef[] = [
  {
    key: "LEAD_ASSIGNED",
    label: "A lead is assigned to you",
    description: "When a new lead is given to you or reassigned to you.",
    important: true,
    alwaysOn: false,
    relevant: (c) => canWorkLeads(c),
  },
  {
    key: "TASK_DUE",
    label: "A task is due today",
    description: "On the day one of your tasks is due.",
    important: false,
    alwaysOn: false,
    relevant: (c) => canWorkTasks(c),
  },
  {
    key: "TASK_OVERDUE",
    label: "A task is overdue",
    description: "When one of your tasks passes its due date. This cannot be turned off.",
    important: true,
    alwaysOn: true,
    relevant: (c) => canWorkTasks(c),
  },
  {
    key: "DEAL_WON_HANDOFF",
    label: "A won deal is handed to you",
    description: "When a deal is won and its delivery work is handed over to you.",
    important: true,
    alwaysOn: false,
    relevant: (c) => hasPermission(c, "handoff.manage"),
  },
  {
    key: "MENTION",
    label: "Someone mentions you",
    description: "When a colleague mentions you in a note or comment.",
    important: true,
    alwaysOn: false,
    relevant: () => true,
  },
  {
    key: "RENEWAL_DUE",
    label: "A service renewal is coming up",
    description: "When a customer's service is approaching its renewal date.",
    important: false,
    alwaysOn: false,
    relevant: (c) => hasPermission(c, "companies.view") && hasPermission(c, "company_services.view"),
  },
  {
    key: "PROPOSAL_UNANSWERED",
    label: "A proposal has had no answer",
    description: "When a proposal you sent has had no reply after the follow-up time.",
    important: false,
    alwaysOn: false,
    relevant: (c) => hasPermission(c, "proposals.view"),
  },
  {
    key: "STALLED_DEAL",
    label: "A deal has stalled",
    description: "When an open deal has not moved for a while.",
    important: false,
    alwaysOn: false,
    relevant: (c) => canUseResource(c, "deals"),
  },
  {
    key: "SUPPORT_ACCESS_REQUEST",
    label: "A support view is requested",
    description: "When platform support asks to view your organisation's data.",
    important: true,
    alwaysOn: false,
    // The support view is a V2 feature; until then there is nothing to ask about.
    relevant: (c, release) => hasPermission(c, "security.manage") && releaseAtLeast(release, "v2"),
  },
];

export function findTypeDef(type: string): NotificationTypeDef | undefined {
  return TYPE_DEFS.find((t) => t.key === type);
}

export function relevantTypes(ctx: AuthContext, release: Release): NotificationTypeDef[] {
  return TYPE_DEFS.filter((t) => t.relevant(ctx, release));
}

export const ALWAYS_ON_TYPES: readonly NotificationTypeKey[] = TYPE_DEFS.filter((t) => t.alwaysOn).map((t) => t.key);

export type PresetKey = "EVERYTHING" | "IMPORTANT_ONLY" | "OFF";
export const PRESETS: readonly { key: PresetKey; label: string; description: string }[] = [
  { key: "EVERYTHING", label: "Everything", description: "Every notification that applies to your role, in the app and by email." },
  {
    key: "IMPORTANT_ONLY",
    label: "Important only",
    description: "New leads, overdue tasks, mentions, handoffs and support requests. The rest are off.",
  },
  { key: "OFF", label: "Off", description: "Nothing, except overdue tasks, which cannot be turned off." },
];

/** What a preset means for one type. */
export function presetValue(preset: PresetKey, def: NotificationTypeDef): boolean {
  if (def.alwaysOn) return true;
  if (preset === "EVERYTHING") return true;
  if (preset === "IMPORTANT_ONLY") return def.important;
  return false;
}

export const QUIET_HOURS_DEFAULT = { enabled: false, start: "20:00", end: "07:00" } as const;
export const EMAIL_CAP_DEFAULT = 20;
export const EMAIL_CAP_MIN = 1;
export const EMAIL_CAP_MAX = 200;
