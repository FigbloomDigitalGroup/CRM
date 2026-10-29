/** The assistant's shapes (X2, FIG-1171). The panel draws these; `respond` (demo today, the real API in M13) produces them. */

export interface AssistantItem {
  title: string;
  sub: string;
  href: string;
}

/** Something the assistant proposes to do. It is only ever shown as a card: nothing runs until the person presses Confirm. */
export interface ProposedAction {
  kind: "task";
  title: string;
  forWhom: string;
  due: string;
  /** What the task is about, written as the person sees it ("Sarova Hotels · deal"). */
  about: string;
}

export interface AssistantMessage {
  id: string;
  who: "me" | "ai";
  text: string;
  /** What the answer was based on, so the person can see how much the assistant could see ("Based on Sales access · 12 leads"). */
  basis?: string;
  items?: AssistantItem[];
  /** A message the person can edit and send themselves. The assistant never sends. */
  draft?: string;
  action?: ProposedAction;
  actionState?: "pending" | "confirmed" | "dismissed";
  feedback?: "up" | "down";
  /** The assistant could not answer: shown with Retry. */
  error?: boolean;
}

export interface AskContext {
  orgSlug: string;
  roleName: string;
  permissionKeys: readonly string[];
  /** A record the person is looking at, when the page is one. */
  record?: { kind: "lead" | "deal" | "company"; name: string } | null;
}

export type Respond = (question: string, ctx: AskContext) => Promise<AssistantMessage[]>;

/** Questions per person per day in the demo. The real limit is an organisation setting (B6.20). */
export const DAILY_LIMIT = 15;
