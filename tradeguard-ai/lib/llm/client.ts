// LLM client — provider-agnostic interface backed by either Anthropic Claude
// or OpenAI GPT. Used by AI 회고 (US2) and 위험도 설명 (US4) flows.
//
// Provider selection is env-driven (`LLM_PROVIDER=anthropic|openai`). Default
// is Anthropic because that's what the spec was scoped against (research.md
// R-03). OpenAI is a drop-in alternative — same prompt + same expected output
// shape — so callers never branch on provider.
//
// Architecture:
//   - `LlmClient` interface = the public contract every provider implements.
//   - `AnthropicLlmClient` and `OpenAiLlmClient` are concrete implementations.
//   - `createLlmClient()` is the factory that picks one based on env.
//   - Existing code keeps importing `LlmClient` (now a type) + `createLlmClient`
//     (a new helper) — the previous class-constructor pattern still works for
//     tests that want to inject a stub.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from '@/lib/utils/logger';

// ─── Public types ─────────────────────────────────────────────────────────

export interface LlmTokenUsage {
  input: number;
  output: number;
  /** Model identifier (provider-specific string, e.g. 'claude-sonnet-4-6' or 'gpt-4o-2024-08-06'). */
  model: string;
}

export interface LlmMessageArgs {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LlmMessageResult {
  text: string;
  tokenUsage: LlmTokenUsage;
}

export type LlmProvider = 'anthropic' | 'openai';

export interface LlmClientOptions {
  /** Force a specific provider. Defaults to `process.env.LLM_PROVIDER` then 'anthropic'. */
  provider?: LlmProvider;
  /** Provider-specific API key. If omitted, read from env. */
  apiKey?: string;
  /** Model identifier. If omitted, defaults per provider via env or hard-coded fallback. */
  model?: string;
}

/** Provider-agnostic contract. Both Anthropic and OpenAI implementations satisfy this. */
export interface LlmClient {
  readonly provider: LlmProvider;
  messages(args: LlmMessageArgs): Promise<LlmMessageResult>;
}

// ─── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-08-06';

// ─── Anthropic implementation ─────────────────────────────────────────────

export class AnthropicLlmClient implements LlmClient {
  readonly provider: LlmProvider = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'AnthropicLlmClient: ANTHROPIC_API_KEY is required (env or constructor option).',
      );
    }
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
    this.client = new Anthropic({ apiKey });
  }

  async messages(args: LlmMessageArgs): Promise<LlmMessageResult> {
    const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system: args.systemPrompt,
        messages: [{ role: 'user', content: args.userMessage }],
      });
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      return {
        text,
        tokenUsage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          model: this.model,
        },
      };
    } catch (err) {
      logger.error('llm_call_failed', {
        provider: 'anthropic',
        model: this.model,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

// ─── OpenAI implementation ────────────────────────────────────────────────

export class OpenAiLlmClient implements LlmClient {
  readonly provider: LlmProvider = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAiLlmClient: OPENAI_API_KEY is required (env or constructor option).');
    }
    this.model = opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    this.client = new OpenAI({ apiKey });
  }

  async messages(args: LlmMessageArgs): Promise<LlmMessageResult> {
    const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: args.systemPrompt },
          { role: 'user', content: args.userMessage },
        ],
      });

      // Take the first choice (we don't request n>1). Concatenate any
      // string-typed content; OpenAI typically returns a single string.
      const choice = response.choices[0];
      const rawContent = choice?.message?.content;
      const text = typeof rawContent === 'string' ? rawContent : '';

      // Usage is always present on chat.completions in 2024+; guard anyway.
      const usage = response.usage;
      return {
        text,
        tokenUsage: {
          input: usage?.prompt_tokens ?? 0,
          output: usage?.completion_tokens ?? 0,
          model: this.model,
        },
      };
    } catch (err) {
      logger.error('llm_call_failed', {
        provider: 'openai',
        model: this.model,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

function resolveProvider(explicit?: LlmProvider): LlmProvider {
  if (explicit) return explicit;
  const fromEnv = process.env.LLM_PROVIDER?.toLowerCase();
  if (fromEnv === 'openai') return 'openai';
  if (fromEnv === 'anthropic') return 'anthropic';
  // Default falls back to Anthropic — original spec target.
  return 'anthropic';
}

/**
 * Build an `LlmClient` for the configured (or explicitly requested) provider.
 *
 * Examples:
 *   const llm = createLlmClient();                          // env-driven
 *   const llm = createLlmClient({ provider: 'openai' });    // explicit
 *   const llm = createLlmClient({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
 */
export function createLlmClient(opts: LlmClientOptions = {}): LlmClient {
  const provider = resolveProvider(opts.provider);
  if (provider === 'openai') {
    return new OpenAiLlmClient({ apiKey: opts.apiKey, model: opts.model });
  }
  return new AnthropicLlmClient({ apiKey: opts.apiKey, model: opts.model });
}
