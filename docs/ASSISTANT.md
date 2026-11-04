# Ask Figbloom: assistant backend (FIG-1152, B6.20)

Design X2 (the panel) and S7#2 (Settings, AI assistant). Rule 9 applies in full: the assistant may answer, list, draft and propose; it never decides.

| Piece | Where |
|---|---|
| Tables `assistant_requests`, `assistant_proposals` (RLS) | `prisma/migrations/20261110110000_assistant` |
| Provider adapter (interface, Anthropic adapter, factory) | `src/assistant/provider.ts` |
| Context builder, text cleaning, answer money filter | `src/assistant/context.ts` |
| Service: ask, settings, confirm, dismiss, feedback, audit | `src/services/assistantService.ts` |
| Routes | `src/app/api/orgs/[orgSlug]/assistant/*` |

## Pipeline for one question

1. `ai.use`, feature toggle `assistant.enabled` (off by default, V1.1), question 1 to 1000 characters, a provider configured. Any failure here: no provider call, nothing counted.
2. Per-person and per-organisation daily limits (defaults 15 and 500, set by Management within 1 to 200 and 1 to 5000). Over the limit gives 429 without a provider call.
3. **Context** from the same services the screens use, called as the person: leads (own, all or shared pool by role), deals (role scope, values masked by `maskDeal`), open tasks, and assignable people only for roles with `tasks.assign.any`. Margins, costs, quotes, invoices and payments are never read, so they cannot reach the model for any role. A deal value is included only if `canSeeDealValue` (Management, Finance, or the deal's owner).
4. **Injection defences.** Free text from records is cleaned (control and bidi characters), instruction-like phrases are replaced and flagged (`ignore-instructions`, `role-override`, `system-prompt`, `reveal-or-export`, `tool-instruction`, `role-marker`, `special-token`), angle brackets are neutralised so nothing can close the data block, money in text is hidden for roles without values. The system prompt calls `<records>` untrusted data. The flags are stored on the request.
5. **Provider call** with three tools: `show_records`, `draft_message` (if the drafts option is on) and `propose_task`. No tool changes anything. Tool choice stays automatic.
6. **Output wall.** The answer and the draft pass `filterAnswerMoney`: a role with `deals.view.value` keeps everything; anyone else keeps only figures they were given (own deals) and every other amount becomes `[value hidden]`. Cited ids must be in the context; an assignee must be one the person may assign to, otherwise the person themselves; the "about" record must be in the context. Unknown tool names (a model obeying injected text) are ignored.
7. The request is stored (question, answer, basis, counts, flags, redactions, tokens, model) and audited as `assistant.asked`.

## Confirm before acting

A suggested task is a `assistant_proposals` row (PENDING, 30 minutes). `POST .../proposals/{id}/confirm` is the explicit yes: only the person it was made for, once (atomic claim), only while the toggle is on, then `createTask` runs as that person, so tasks.create, assignment rules and record access are enforced at that moment (access lost since the suggestion makes it FAILED). Audited as `assistant.action_confirmed` / `_failed` / `_dismissed`.

## API

`GET/PUT /assistant/settings` (PUT: `ai.configure`; `enabled` writes the feature toggle through `updateFeatureToggles`, which also needs `organization.manage_settings`, both Management), `POST /assistant/ask`, `POST /assistant/proposals/{id}/confirm|dismiss`, `POST /assistant/requests/{id}/feedback`, `GET /assistant/audit` (`ai.configure`).

## Provider setup

Default: Claude through `@anthropic-ai/sdk`, loaded only when `ANTHROPIC_API_KEY` is set; model `ASSISTANT_MODEL` (default `claude-opus-5-5`). The package is not a dependency of the project yet: run `npm install @anthropic-ai/sdk` where the assistant is switched on. Without package or key the assistant says it is not set up. Any other model: `setAssistantProviderFactory` with an `AssistantProvider` (`complete(request)`).

## Decisions taken without being asked

- The org switch is the existing `assistant.enabled` toggle, not a new setting; options and limits live in `organization_settings` key `assistant.config`.
- Only one action kind exists (create a task, which covers assign and remind); more kinds are a code change plus a CHECK in the migration.
- Limits count every attempt that reached the provider, including failures.
- The audit trail stores the question and the already-filtered answer. Retention of `assistant_requests` is not yet in the privacy retention job.

## Known gaps

The "summaries", "scoring" and "churn" options are stored but have no backend yet (only Ask and drafts exist). Streaming answers and conversation history are not built (each question stands alone, which also keeps the context small). Screens to wire: `src/ui/screens/assistant/AssistantPanel.tsx` (swap `demoRespond` for `/assistant/ask` and the confirm/dismiss routes) and `.../settings/AiAssistantSettings.tsx` (the `/assistant/settings` routes).

## Tests

`tests/assistant.test.ts`: off by default and off again, role and configure permissions, settings audit and bounds, not-configured, masking for Delivery, Sales (own deals only) and Management/Finance, no payments or margins in context, money hiding, injection (neutralised text, obeying model cannot widen anything, no acting tools), confirm once/race/other person/other organisation/expiry/access lost/Management assigns, drafts, limits (person, organisation, failure counted, daily reset), audit trail and feedback, the Anthropic adapter against a fake client, RLS.
