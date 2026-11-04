import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { canSeeDealValue } from "../auth/masking";
import { listDeals } from "../services/dealService";
import { listLeads } from "../services/leadService";
import { listAssignableTaskAssignees, listTasks } from "../services/taskService";

/**
 * What the assistant may see, built before anything leaves the server (FIG-1152, B6.20).
 *
 * The data comes from the same services the screens use, called as the signed-in person, so it is exactly what that person could
 * open: their role's scope, archived rows hidden, deal values masked by `maskDeal`. On top of that:
 *
 *  - Nothing money-related beyond a deal value is ever fetched. Margins, costs, quotes' lines, invoices and payments are not read
 *    at all, so they cannot reach the model for any role.
 *  - A deal value is included only when `canSeeDealValue` says this person may see it (Management and Finance, or the owner of
 *    that deal); otherwise the field is absent, not rounded and not hinted at.
 *  - Free text typed into records (names, titles) is untrusted: it is cleaned, shortened, stripped of anything that looks like an
 *    instruction to the model or like markup that could break out of the data block, and money written in it is redacted for roles
 *    that may not see values. What was neutralised is counted and flagged.
 */
export const MAX_CONTEXT_RECORDS = 25;
const MAX_TEXT = 160;

const INJECTION_PATTERNS: { flag: string; re: RegExp }[] = [
  { flag: "ignore-instructions", re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|above|previous|earlier)\b/gi },
  { flag: "role-override", re: /\b(you are now|act as|pretend (to be|you are)|new instructions?|from now on you)\b/gi },
  { flag: "system-prompt", re: /\b(system prompt|developer message|your instructions)\b/gi },
  { flag: "reveal-or-export", re: /\b(reveal|show|print|output|send|email|exfiltrate)\b[^.\n]{0,30}\b(all|every|hidden|secret|password|token|api key|margin|cost|payments?|deal values?)\b/gi },
  { flag: "tool-instruction", re: /\b(call|use|run|execute|invoke)\b[^.\n]{0,20}\b(tool|function|propose_task|draft_message|show_records)\b/gi },
  { flag: "role-marker", re: /(^|\n)\s*(system|assistant|human|user)\s*:/gi },
  { flag: "special-token", re: /<\|[^>]*\|>|\[\/?INST\]|<\/?(system|assistant|records?|instructions?)>/gi },
];

/** Money in free text: an amount with a currency, as in `redactMoneyText` (src/auth/masking.ts). */
const MONEY_RE = /(?:\b(?:KES|KSH|KSHS|USD|EUR|GBP|UGX|TZS|RWF)\b\.?\s*|[$€£]\s?)(\d[\d,]*(?:\.\d+)?)(?:\s?(?:k|m|million|bn))?|\b(\d[\d,]*(?:\.\d+)?)\s?(?:KES|KSH|KSHS|USD|EUR|GBP|UGX|TZS|RWF)\b/gi;
export const HIDDEN = "[value hidden]";

export interface CleanText {
  text: string;
  flags: string[];
  redactions: number;
}

/** One piece of free text from a record, made safe to put in front of the model. */
export function cleanRecordText(raw: string | null | undefined, options: { redactMoney: boolean; max?: number }): CleanText {
  let text = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const flags: string[] = [];
  let redactions = 0;
  for (const { flag, re } of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      flags.push(flag);
      re.lastIndex = 0;
      text = text.replace(re, "[removed: looked like an instruction]");
    }
  }
  // Angle brackets cannot open or close anything in the data block.
  text = text.replace(/</g, "‹").replace(/>/g, "›");
  if (options.redactMoney) {
    text = text.replace(MONEY_RE, () => {
      redactions += 1;
      return HIDDEN;
    });
  }
  return { text: text.slice(0, options.max ?? MAX_TEXT), flags, redactions };
}

export interface ContextItem {
  id: string;
  kind: "lead" | "deal" | "task" | "company";
  title: string;
  sub: string;
  href: string;
  /** Present only when this person may see it. */
  value?: number;
  /** For a task or lead: the record it belongs to, so a proposal can be linked. */
  link?: { leadId?: string; dealId?: string; companyId?: string };
}

export interface AssistantContext {
  items: ContextItem[];
  assignees: { id: string; name: string }[];
  counts: { leads: number; deals: number; tasks: number; withValue: number };
  flags: string[];
  redactions: number;
  /** The text block handed to the model: untrusted data, nothing else. */
  records: string;
  /** Figures (deal values) the model has been given, so the answer filter can tell them from invented or hidden ones. */
  allowedFigures: number[];
  focus: { kind: string; id: string; name: string } | null;
}

const may = (ctx: AuthContext, ...keys: string[]) => keys.some((k) => hasPermission(ctx, k));
const daysSince = (d: Date | null | undefined) => (d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000)) : 0);

export async function buildAssistantContext(ctx: AuthContext, options: { orgSlug: string; focus?: { kind: "lead" | "deal" | "company"; id: string } | null; maxRecords?: number }): Promise<AssistantContext> {
  const max = Math.min(options.maxRecords ?? MAX_CONTEXT_RECORDS, 50);
  const redactMoney = !hasPermission(ctx, "deals.view.value");
  const flags = new Set<string>();
  let redactions = 0;
  const clean = (raw: string | null | undefined, max?: number) => {
    const out = cleanRecordText(raw, { redactMoney, max });
    out.flags.forEach((f) => flags.add(f));
    redactions += out.redactions;
    return out.text;
  };
  const items: ContextItem[] = [];
  const allowedFigures: number[] = [];
  const base = `/o/${options.orgSlug}`;

  if (may(ctx, "leads.view.own", "leads.view.all", "leads.view.shared")) {
    const leads = (await listLeads(ctx, { includeArchived: false })).filter((l) => !l.convertedAt).slice(0, max);
    for (const l of leads) {
      const name = [l.contact?.firstName, l.contact?.lastName].filter(Boolean).join(" ") || l.company?.name || "Lead";
      items.push({
        id: l.id,
        kind: "lead",
        title: clean(l.company?.name ?? name),
        sub: clean(`${l.leadStatus?.name ?? ""} · ${l.temperature.toLowerCase()}${l.ownerMembershipId === ctx.membershipId ? " · yours" : ""}`),
        href: `${base}/leads`,
        link: { leadId: l.id },
      });
    }
  }

  if (may(ctx, "deals.view.own", "deals.view.all", "deals.view.won")) {
    const deals = (await listDeals(ctx, {})).filter((d) => d.outcome === "OPEN" || d.outcome === "WON").slice(0, max);
    for (const d of deals) {
      const showValue = canSeeDealValue(ctx, d) && d.value != null && !(d as { valueMasked?: boolean }).valueMasked;
      const value = showValue ? Number(d.value) : undefined;
      if (value !== undefined) allowedFigures.push(value);
      const quiet = daysSince(d.lastActivityAt);
      items.push({
        id: d.id,
        kind: "deal",
        title: clean(`${d.company?.name ?? "Company"}${d.service?.name ? ` · ${d.service.name}` : ""}`),
        sub: clean(`${d.pipelineStage?.name ?? ""} · ${d.outcome.toLowerCase()} · last activity ${quiet} day${quiet === 1 ? "" : "s"} ago${d.ownerMembershipId === ctx.membershipId ? " · yours" : ""}`),
        href: `${base}/deals`,
        ...(value !== undefined ? { value } : {}),
        link: { dealId: d.id, companyId: d.companyId },
      });
    }
  }

  if (may(ctx, "tasks.view.own", "tasks.view.all")) {
    const tasks = (await listTasks(ctx, {})).filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").slice(0, max);
    for (const t of tasks) {
      const late = t.dueAt && t.dueAt < new Date() ? daysSince(t.dueAt) : 0;
      items.push({
        id: t.id,
        kind: "task",
        title: clean(t.title),
        sub: clean(`${t.assigneeName ?? ""}${t.dueAt ? ` · due ${t.dueAt.toISOString().slice(0, 10)}` : ""}${late ? ` · ${late} day${late === 1 ? "" : "s"} late` : ""}`),
        href: `${base}/tasks`,
        link: { leadId: t.leadId ?? undefined, dealId: t.dealId ?? undefined, companyId: t.companyId ?? undefined },
      });
    }
  }

  // Who a task may be handed to: only people the caller could assign to anyway; everyone else may only assign to themselves.
  let assignees: { id: string; name: string }[] = [];
  if (hasPermission(ctx, "tasks.assign.any")) {
    assignees = (await listAssignableTaskAssignees(ctx)).map((a) => ({ id: a.membershipId, name: clean(a.userName, 80) }));
  }

  let focus: AssistantContext["focus"] = null;
  if (options.focus) {
    const found = items.find((i) => i.id === options.focus!.id && i.kind === options.focus!.kind);
    if (found) focus = { kind: found.kind, id: found.id, name: found.title };
  }

  const counts = {
    leads: items.filter((i) => i.kind === "lead").length,
    deals: items.filter((i) => i.kind === "deal").length,
    tasks: items.filter((i) => i.kind === "task").length,
    withValue: allowedFigures.length,
  };
  const records = JSON.stringify({
    leads: items.filter((i) => i.kind === "lead").map(({ id, title, sub }) => ({ id, title, sub })),
    deals: items.filter((i) => i.kind === "deal").map(({ id, title, sub, value }) => ({ id, title, sub, ...(value !== undefined ? { valueKES: value } : {}) })),
    tasks: items.filter((i) => i.kind === "task").map(({ id, title, sub }) => ({ id, title, sub })),
    people: assignees,
    dealValuesVisible: allowedFigures.length > 0 || hasPermission(ctx, "deals.view.value"),
    focus,
  });
  return { items, assignees, counts, flags: [...flags], redactions, records, allowedFigures, focus };
}

/**
 * The last wall: whatever the model wrote, money that this person may not see does not leave. A role with `deals.view.value` sees
 * everything; anyone else keeps only the figures they were given (their own deals' values) and every other amount is hidden.
 */
export function filterAnswerMoney(ctx: Pick<AuthContext, "permissionKeys">, text: string, allowedFigures: number[]): { text: string; redactions: number } {
  if (ctx.permissionKeys.includes("deals.view.value")) return { text, redactions: 0 };
  const allowed = new Set(allowedFigures);
  let redactions = 0;
  const out = text.replace(MONEY_RE, (match, a: string | undefined, b: string | undefined) => {
    const n = Number((a ?? b ?? "").replace(/,/g, ""));
    if (allowed.has(n) && !/(k|m|million|bn)$/i.test(match.trim())) return match;
    redactions += 1;
    return HIDDEN;
  });
  return { text: out, redactions };
}
