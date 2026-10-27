/**
 * The copy deck (F1.05): every sentence the shared states show, in one place, so the wording is consistent and a translation (V2, Swahili)
 * means editing this file rather than hunting through components. Functions take the few values a sentence needs.
 *
 * Wording rules from the design: say what happened and what to do next; name the person or role who can help; never show a raw error
 * message, a stack trace or an internal code to a person.
 */
export const copy = {
  loading: { label: "Loading" },
  empty: {
    title: "Nothing here yet",
    body: "When there is something to show, it will appear here.",
    noResults: { title: "No results", body: "Nothing matches those filters. Clear a filter or try a different word." },
  },
  error: {
    title: "That did not load",
    body: "Something went wrong on our side. Try again. If it keeps happening, tell your admin and give them the reference below.",
    retry: "Try again",
    reference: (id: string) => `Reference ${id}`,
    signedOut: { title: "Your session has ended", body: "Sign in again to carry on. Anything you typed has been kept.", action: "Sign in" },
    notFound: { title: "We cannot find that", body: "It may have been archived, merged or never existed in your organisation.", action: "Go to the dashboard" },
    conflict: { title: "That changed while you were looking", body: "Reload to see the latest version, then try again." },
    rateLimited: { title: "Too many requests", body: "Wait a moment and try again." },
    offline: { title: "You are offline", body: "Check your connection. Changes you make are saved on this device and sent when you are back online." },
  },
  noAccess: {
    title: (area: string) => `${area} isn’t part of your workspace.`,
    yourRole: "Your role",
    owners: "Who has access",
    askWho: "Who to ask",
    fallbackAsk: "your organisation’s admin",
    body: "This is how your organisation set up roles, not a fault. Ask someone below if you need it.",
  },
  masked: {
    shown: "Hidden",
    reason: "Your role cannot see this value.",
    dealValue: "Deal values are visible to Management and Sales only.",
    payment: "Payments are visible to Finance and Management only.",
  },
  archived: {
    title: "Archived.",
    body: "This record is read-only. Restore it to make changes.",
    restore: "Restore",
  },
  offline: {
    banner: "Offline. Saves are queued.",
    back: "Back online. Sending your queued changes.",
    slow: "Slow connection",
  },
  session: {
    expiring: (when: string) => `Your session ends ${when}.`,
    stay: "Stay signed in",
    signOut: "Sign out",
    ended: "Your session ended. Sign in again to carry on.",
  },
  scope: { organisation: "Organisation", team: "Team", mine: "Mine", readOnly: "Read-only" },
} as const;
