import { DEFAULT_RUNTIME_SYSTEM_PROMPT } from '@/prompts/runtime-system';
import { getRedisClient } from './redis';

const REDIS_RUNTIME_PROMPT_KEY = 'wa:config:runtime-system-prompt';
const MAX_RUNTIME_PROMPT_LENGTH = 16_000;

export type RuntimePromptSource = 'default' | 'redis-custom';

export type RuntimePromptConfig = {
  prompt: string;
  source: RuntimePromptSource;
  isCustom: boolean;
  updatedAt: string | null;
};

function normalizePrompt(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function buildDefaultRuntimePromptConfig(): RuntimePromptConfig {
  return {
    prompt: DEFAULT_RUNTIME_SYSTEM_PROMPT,
    source: 'default',
    isCustom: false,
    updatedAt: null,
  };
}

function normalizeUpdatedAt(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function getRuntimePromptConfig(): Promise<RuntimePromptConfig> {
  const client = await getRedisClient();
  if (!client) {
    return buildDefaultRuntimePromptConfig();
  }

  try {
    const raw = await client.hGetAll(REDIS_RUNTIME_PROMPT_KEY);
    const customPrompt = normalizePrompt(raw.prompt || '');

    if (!customPrompt) {
      return buildDefaultRuntimePromptConfig();
    }

    return {
      prompt: customPrompt,
      source: 'redis-custom',
      isCustom: true,
      updatedAt: normalizeUpdatedAt(raw.updatedAt),
    };
  } catch (error) {
    console.error('[PromptConfig] Failed to read runtime prompt config:', error);
    return buildDefaultRuntimePromptConfig();
  }
}

export async function getRuntimeSystemPrompt(): Promise<string> {
  const config = await getRuntimePromptConfig();
  return config.prompt;
}

export async function saveRuntimeSystemPrompt(prompt: string): Promise<{
  ok: boolean;
  error?: string;
  config?: RuntimePromptConfig;
}> {
  const normalizedPrompt = normalizePrompt(prompt);

  if (!normalizedPrompt) {
    return {
      ok: false,
      error: 'Prompt tidak boleh kosong.',
    };
  }

  if (normalizedPrompt.length > MAX_RUNTIME_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `Prompt terlalu panjang. Maksimal ${MAX_RUNTIME_PROMPT_LENGTH} karakter.`,
    };
  }

  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false,
      error: 'Redis tidak tersedia. Prompt belum tersimpan.',
    };
  }

  try {
    const updatedAt = new Date().toISOString();

    await client.hSet(REDIS_RUNTIME_PROMPT_KEY, {
      prompt: normalizedPrompt,
      updatedAt,
    });

    return {
      ok: true,
      config: {
        prompt: normalizedPrompt,
        source: 'redis-custom',
        isCustom: true,
        updatedAt,
      },
    };
  } catch (error) {
    console.error('[PromptConfig] Failed to save runtime prompt config:', error);
    return {
      ok: false,
      error: 'Gagal menyimpan prompt ke Redis.',
    };
  }
}

export async function resetRuntimeSystemPrompt(): Promise<{
  ok: boolean;
  error?: string;
  config: RuntimePromptConfig;
}> {
  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false,
      error: 'Redis tidak tersedia. Prompt belum direset.',
      config: buildDefaultRuntimePromptConfig(),
    };
  }

  try {
    await client.del(REDIS_RUNTIME_PROMPT_KEY);
    return {
      ok: true,
      config: buildDefaultRuntimePromptConfig(),
    };
  } catch (error) {
    console.error('[PromptConfig] Failed to reset runtime prompt config:', error);
    return {
      ok: false,
      error: 'Gagal mereset prompt custom.',
      config: buildDefaultRuntimePromptConfig(),
    };
  }
}
