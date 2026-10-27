/**
 * The design system's public surface. Screens import from `@/ui`, never from a component's own file, so a component can move without
 * touching its users.
 */
export * from "./components/basics";
export * from "./components/forms";
export * from "./components/overlays";
export * from "./components/states";
export * from "./components/appearance";
export * from "./components/toast";
export * from "./components/DataTable";
export { copy } from "./copy";
export { describeError, type DescribedError, type ErrorKind, type Denial } from "./errors";
export { useDraft, saveDraft, loadDraft, clearDraft, SESSION_ENDING_EVENT } from "./drafts";
export { ApiProvider, useApi, useApiQuery, useApiMutation, useOptimisticUpdate, useUndoable, explainRollback, queryKeyFor, makeQueryClient } from "./data/hooks";
export { connectivity, type ConnectivityState } from "./data/connectivity";
export { useAppearance, useAppearanceOptional, ThemeProvider } from "./theme/ThemeProvider";
