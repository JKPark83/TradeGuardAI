// @vitest-environment node
//
// Dual-provider LLM client smoke tests.
//
// Verifies that `createLlmClient` honors LLM_PROVIDER (and explicit `provider`
// option) and that both Anthropic and OpenAI implementations satisfy the
// shared `LlmClient` contract. Network calls are intercepted by MSW handlers
// in `tests/mocks/handlers.ts`.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  AnthropicLlmClient,
  OpenAiLlmClient,
  createLlmClient,
  type LlmClient,
} from '@/lib/llm/client';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.OPENAI_API_KEY = 'sk-test-openai';
  delete process.env.LLM_PROVIDER;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.OPENAI_MODEL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('createLlmClient — factory', () => {
  it('defaults to Anthropic when LLM_PROVIDER is unset', () => {
    const client = createLlmClient();
    expect(client.provider).toBe('anthropic');
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  it('respects LLM_PROVIDER=openai env var', () => {
    process.env.LLM_PROVIDER = 'openai';
    const client = createLlmClient();
    expect(client.provider).toBe('openai');
    expect(client).toBeInstanceOf(OpenAiLlmClient);
  });

  it('respects LLM_PROVIDER=anthropic env var (case-insensitive)', () => {
    process.env.LLM_PROVIDER = 'ANTHROPIC';
    const client = createLlmClient();
    expect(client.provider).toBe('anthropic');
  });

  it('falls back to Anthropic for unknown LLM_PROVIDER values', () => {
    process.env.LLM_PROVIDER = 'cohere';
    const client = createLlmClient();
    expect(client.provider).toBe('anthropic');
  });

  it('explicit `provider` option overrides env', () => {
    process.env.LLM_PROVIDER = 'openai';
    const client = createLlmClient({ provider: 'anthropic' });
    expect(client.provider).toBe('anthropic');
  });

  it('throws when the required provider key is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => createLlmClient({ provider: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });
});

describe('LlmClient contract — provider-agnostic shape', () => {
  it.each<{ provider: 'anthropic' | 'openai' }>([
    { provider: 'anthropic' },
    { provider: 'openai' },
  ])('$provider returns { text, tokenUsage } with the right model', async ({ provider }) => {
    const client: LlmClient = createLlmClient({ provider });
    const result = await client.messages({
      systemPrompt: '냉정한 분석',
      userMessage: '거래 1건 회고',
    });
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.tokenUsage.input).toBeGreaterThan(0);
    expect(result.tokenUsage.output).toBeGreaterThan(0);
    if (provider === 'anthropic') {
      expect(result.tokenUsage.model).toMatch(/claude/);
    } else {
      expect(result.tokenUsage.model).toMatch(/gpt/);
    }
  });
});
