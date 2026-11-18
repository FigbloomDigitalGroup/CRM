/** The assistant's shapes (X2, FIG-1171). The panel draws these; `respond` (the real `/assistant/ask` call, see `api.ts`) produces them. */

export interface AssistantItem {
  title: string;
  sub: string;
  href: string;
}

/** Something the assistant proposes to do. It is only ever shown as a card: nothing runs until the person presses Confirm. */
export interface ProposedAction {
  /** The suggestion's id on the server: Confirm and Not now name it. Nothing is created until the confirm call succeeds. */
  proposalId: string;
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
  actionState?: "pending" | "confirming" | "confirmed" | "dismissed";
  /** Why Confirm did not go through (expired, access lost, offline). The card stays pending so the person can try again or dismiss it. */
  actionError?: string;
  /** The server's id of the answer, for feedback. */
  requestId?: string;
  feedback?: "up" | "down";
  /** The assistant could not answer: shown with Retry when retrying can help. */
  error?: boolean;
  retryable?: boolean;
}

export interface AskContext {
  orgSlug: string;
  roleName: string;
  permissionKeys: readonly string[];
  /** A record the person is looking at, when the page is one. `id` is sent to the API so the answer is about that record. */
  record?: { kind: "lead" | "deal" | "company"; name: string; id?: string } | null;
}

export type Respond = (question: string, ctx: AskContext) => Promise<AssistantMessage[]>;
