import OpenAI from 'openai';
import { getRuntimeEnvValues } from './runtime-env';

const DEFAULT_OPENAI_MODEL = 'gpt-4o';

export async function createOpenAIClient(): Promise<OpenAI | null> {
  const runtimeValues = await getRuntimeEnvValues(['OPENAI_API_KEY']);
  const apiKey = runtimeValues.OPENAI_API_KEY.trim();
  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
}

export async function getOpenAIModel(): Promise<string> {
  const runtimeValues = await getRuntimeEnvValues(['OPENAI_MODEL']);
  const model = runtimeValues.OPENAI_MODEL.trim();
  return model || DEFAULT_OPENAI_MODEL;
}

export interface LeadData {
  sumberInfo: string;
  biodata: string;
  bidangUsaha: string;
  budget: string;
  rencanaMulai: string;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
