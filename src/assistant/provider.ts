/**
 * The provider seam for the assistant (FIG-1152, B6.20). The assistant talks to a language model only through
 * `AssistantProvider`, so the model behind it can be changed (or faked in a test) without touching what the assistant is allowed
 * to see or do. The provider only ever receives the context the builder produced after masking and permission checks.
 *
 * The default provider is Anthropic's Claude, through the official SDK (`@anthropic-ai/sdk`, loaded only when
 * `ANTHROPIC_API_KEY` is set). The SDK is not a hard dependency: without the package or the key the assistant says plainly that
 * it is not configured for this deployment and no call is made. The key lives only in the environment, never in code or the
 * database.
 */
export interface ProviderMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ProviderRequest {
  system: string;
  messages: ProviderMessage[];
  tools: ProviderTool[];
  maxTokens: number;
}

export interface ProviderToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderResponse {
  text: string;
  toolCalls: ProviderToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  /** The model declined to answer (a safety refusal). */
  refused?: boolean;
}

export interface AssistantProvider {
  readonly id: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

/** What the adapter needs of the Anthropic SDK client, so a test can hand it a fake. */
export interface AnthropicLikeClient {
  messages: { create(params: Record<string, unknown>): Promise<unknown> };
}

/** `claude-opus-5-5` unless the deployment chooses another model with `ASSISTANT_MODEL`. */
export const DEFAULT_ASSISTANT_MODEL = "claude-opus-5-5";

export function createAnthropicProvider(client: AnthropicLikeClient, model: string = process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL): AssistantProvider {
  return {
    id: "anthropic",
    async complete(request) {
      // `tool_choice` stays automatic: forcing a tool is not accepted by the current models, and the assistant should be free to just answer.
      const raw = (await client.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      })) as {
        model?: string;
        stop_reason?: string;
        content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const content = raw.content ?? [];
      return {
        text: content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim(),
        toolCalls: content.filter((b) => b.type === "tool_use" && b.name).map((b) => ({ name: b.name!, input: b.input ?? {} })),
        usage: { inputTokens: raw.usage?.input_tokens ?? 0, outputTokens: raw.usage?.output_tokens ?? 0 },
        model: raw.model ?? model,
        refused: raw.stop_reason === "refusal",
      };
    },
  };
}

let factory: (() => Promise<AssistantProvider | null>) | null = null;

/** Tests (and a deployment with its own model gateway) replace the provider; pass null to restore the default. */
export function setAssistantProviderFactory(next: (() => Promise<AssistantProvider | null>) | null): void {
  factory = next;
}

export async function getAssistantProvider(): Promise<AssistantProvider | null> {
  if (factory) return factory();
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    // Computed specifier: the package is optional, so the build must not require it.
    const specifier = "@anthropic-ai/sdk";
    const mod = (await import(/* webpackIgnore: true */ specifier)) as { default: new (options: { apiKey: string }) => AnthropicLikeClient };
    return createAnthropicProvider(new mod.default({ apiKey: process.env.ANTHROPIC_API_KEY }));
  } catch {
    return null;
  }
}
