/**
 * The automation rule catalogue (FIG-1059, B4.02, Settings > Automations).
 *
 * Rules are defined here, in code. An organisation switches each one on or off, sets its thresholds and its
 * audience, and reads what it did in the run log. It cannot invent a rule, and a rule cannot do more than
 * its declared actions allow.
 *
 * THE BOUNDARY (CLAUDE.md rule 9, findings 26 and 27): automations may assign, remind and draft. They never
 * decide. No rule moves a deal stage, sets a discount, approves anything or changes an owner, with one
 * exception: a rule that is explicitly an assignment rule (`ASSIGN_OWNER`) may choose the owner of a lead
 * it has just been given. The four action kinds below are the only effects a rule can have, and the
 * effects module (`./effects.ts`) is the only code that carries them out on a rule's behalf, so the
 * boundary is enforced in one place and tested in `tests/automations.test.ts`.
 */

export const ACTION_KINDS = ["ASSIGN_OWNER", "CREATE_TASK", "NOTIFY", "FLAG"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * Names of the fields a rule must never write. The boundary test scans the automation code for them and the
 * runtime test asserts none of these change when every rule runs.
 */
export const FORBIDDEN_RULE_FIELDS = [
  "pipelineStageId",
  "pipelineStage",
  "outcome",
  "discount",
  "approvedAt",
  "approvedBy",
  "approval",
] as const;

export const AUDIENCES = ["OWNER", "OWNER_AND_MANAGEMENT"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const RULE_KEYS = {
  WEBSITE_LEAD_ASSIGNMENT: "WEBSITE_LEAD_ASSIGNMENT",
  NEW_LEAD_FOLLOW_UP_TASK: "NEW_LEAD_FOLLOW_UP_TASK",
  PROPOSAL_FOLLOW_UP: "PROPOSAL_FOLLOW_UP",
  RENEWAL_REMINDER: "RENEWAL_REMINDER",
  DORMANT_CUSTOMER_FLAG: "DORMANT_CUSTOMER_FLAG",
  STALLED_DEAL_ALERT: "STALLED_DEAL_ALERT",
  HANDOFF_ONBOARDING_TASKS: "HANDOFF_ONBOARDING_TASKS",
  OVERDUE_INVOICE_NOTICE: "OVERDUE_INVOICE_NOTICE",
} as const;
export type RuleKey = (typeof RULE_KEYS)[keyof typeof RULE_KEYS];

export interface ParamDef {
  key: string;
  label: string;
  unit: "days" | "hours" | "choice";
  min?: number;
  max?: number;
  default: number | string;
  options?: readonly string[];
  /** True when the value is shown here but changed where it lives (for example the deal rules). */
  readOnly?: boolean;
  note?: string;
}

export interface RuleDef {
  key: RuleKey;
  name: string;
  description: string;
  /** What starts it, and what it does, in a sentence each. */
  trigger: string;
  effect: string;
  /** The only things this rule may do. Checked by `assertRuleMay`. */
  actions: readonly ActionKind[];
  defaultEnabled: boolean;
  params: readonly ParamDef[];
  /** Who hears about it. Empty for rules that do not notify people. */
  audiences: readonly Audience[];
  defaultAudience: Audience | null;
  /** Released with FIG-xxxx, for the Settings screen's "why does this exist". */
  origin: string;
}

export const RULES: readonly RuleDef[] = [
  {
    key: RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT,
    name: "Assign website leads",
    description: "A lead from the website form is given an owner using the assignment rules, then the round robin.",
    trigger: "A website form submission is accepted.",
    effect: "Sets the owner of the new lead. Off: the lead is left unassigned for someone to take.",
    actions: ["ASSIGN_OWNER"],
    defaultEnabled: true,
    params: [{ key: "fallback", label: "When no assignment rule matches", unit: "choice", default: "ROUND_ROBIN", options: ["ROUND_ROBIN", "UNASSIGNED"] }],
    audiences: [],
    defaultAudience: null,
    origin: "FIG-751",
  },
  {
    key: RULE_KEYS.NEW_LEAD_FOLLOW_UP_TASK,
    name: "Follow-up task on a new website lead",
    description: "The owner of a new website lead gets a task to acknowledge and qualify it.",
    trigger: "A website lead is created with an owner.",
    effect: "Creates one task for the owner, due after the number of hours set.",
    actions: ["CREATE_TASK"],
    defaultEnabled: true,
    params: [{ key: "dueInHours", label: "Task is due after", unit: "hours", min: 1, max: 168, default: 24 }],
    audiences: [],
    defaultAudience: null,
    origin: "FIG-442",
  },
  {
    key: RULE_KEYS.PROPOSAL_FOLLOW_UP,
    name: "Proposal follow-up",
    description: "A proposal that has had no answer for a while reminds the person who owns it.",
    trigger: "A sent proposal has not been touched for the number of days set.",
    effect: "Notifies the owner. Never changes the proposal or the deal.",
    actions: ["NOTIFY"],
    defaultEnabled: true,
    params: [{ key: "days", label: "Remind after", unit: "days", min: 1, max: 365, default: 5 }],
    audiences: AUDIENCES,
    defaultAudience: "OWNER",
    origin: "FIG-795",
  },
  {
    key: RULE_KEYS.RENEWAL_REMINDER,
    name: "Renewal reminder",
    description: "A service about to renew, or past its renewal date, reminds the person who looks after it.",
    trigger: "A recurring service renews within the number of days set, or has lapsed.",
    effect: "Notifies the owner. Never renews or cancels anything.",
    actions: ["NOTIFY"],
    defaultEnabled: true,
    params: [{ key: "daysAhead", label: "Remind this many days ahead", unit: "days", min: 1, max: 365, default: 30 }],
    audiences: AUDIENCES,
    defaultAudience: "OWNER",
    origin: "FIG-795",
  },
  {
    key: RULE_KEYS.DORMANT_CUSTOMER_FLAG,
    name: "Dormant customer flag",
    description: "A customer with no activity for a long time is flagged Dormant and the owner is told.",
    trigger: "The nightly lifecycle check finds a customer quiet for longer than the number of days set.",
    effect: "Moves the company's lifecycle state to Dormant and notifies the owner. Off: nothing is flagged.",
    actions: ["FLAG", "NOTIFY"],
    defaultEnabled: true,
    params: [{ key: "days", label: "Dormant after", unit: "days", min: 1, max: 730, default: 90 }],
    audiences: AUDIENCES,
    defaultAudience: "OWNER",
    origin: "FIG-1048",
  },
  {
    key: RULE_KEYS.STALLED_DEAL_ALERT,
    name: "Stalled deal alert",
    description: "An open deal with no activity for too long alerts its owner. It never moves the deal.",
    trigger: "The nightly check finds an open deal stalled by the deal rules.",
    effect: "Notifies the owner once per stall. Never changes the stage or anything else on the deal.",
    actions: ["NOTIFY"],
    defaultEnabled: true,
    params: [
      {
        key: "stalledAfterDays",
        label: "A deal counts as stalled after",
        unit: "days",
        default: 10,
        readOnly: true,
        note: "Set in the deal rules; the dashboard uses the same number.",
      },
    ],
    audiences: AUDIENCES,
    defaultAudience: "OWNER",
    origin: "FIG-1035",
  },
  {
    key: RULE_KEYS.HANDOFF_ONBOARDING_TASKS,
    name: "Onboarding tasks at handoff",
    description: "When a deal is won and handed to Delivery, the organisation's onboarding tasks are created for the owner.",
    trigger: "A deal is handed off to Delivery.",
    effect: "Creates the onboarding task template for the Delivery owner. Off: the handoff happens without tasks.",
    actions: ["CREATE_TASK"],
    defaultEnabled: true,
    params: [],
    audiences: [],
    defaultAudience: null,
    origin: "FIG-792",
  },
  {
    key: RULE_KEYS.OVERDUE_INVOICE_NOTICE,
    name: "Overdue invoice notice",
    description: "An invoice past its due date tells Finance, and the deal owner that it is overdue.",
    trigger: "An unpaid invoice passes its due date.",
    effect: "Notifies Finance and the deal owner. The owner's notice carries no number or amount.",
    actions: ["NOTIFY"],
    defaultEnabled: true,
    params: [],
    audiences: [],
    defaultAudience: null,
    origin: "FIG-795",
  },
];

export function findRule(key: string): RuleDef | undefined {
  return RULES.find((r) => r.key === key);
}

export function isRuleKey(key: string): key is RuleKey {
  return findRule(key) !== undefined;
}

/**
 * The gate every effect passes through: a rule may only do what it declares. Throws for an undeclared action,
 * which is a programming error caught by the tests, never a runtime condition for a user.
 */
export function assertRuleMay(ruleKey: RuleKey, action: ActionKind): void {
  const rule = findRule(ruleKey);
  if (!rule) throw new Error(`Unknown automation rule "${ruleKey}".`);
  if (!rule.actions.includes(action)) {
    throw new Error(`Automation rule ${ruleKey} may not ${action}: automations assign, remind and draft, they never decide.`);
  }
}
