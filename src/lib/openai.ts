import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const AI_MODEL = 'gpt-4o-mini';

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
