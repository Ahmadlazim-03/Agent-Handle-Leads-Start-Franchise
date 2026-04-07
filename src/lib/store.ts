export interface ConversationState {
  chatId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  collectedData: Record<string, string>;
  isComplete: boolean;
  lastActivity: number;
}

export interface ConversationStateSnapshot {
  chatId: string;
  isComplete: boolean;
  lastActivity: number;
  messageCount: number;
}

const conversationStore = new Map<string, ConversationState>();

const CONVERSATION_TTL = 24 * 60 * 60 * 1000;

export function getConversationState(chatId: string): ConversationState | null {
  const state = conversationStore.get(chatId);
  if (!state) return null;
  if (Date.now() - state.lastActivity > CONVERSATION_TTL) {
    conversationStore.delete(chatId);
    return null;
  }
  return state;
}

export function createConversationState(chatId: string): ConversationState {
  const state: ConversationState = {
    chatId,
    messages: [],
    collectedData: {},
    isComplete: false,
    lastActivity: Date.now(),
  };
  conversationStore.set(chatId, state);
  return state;
}

export function updateConversationState(chatId: string, state: ConversationState): void {
  state.lastActivity = Date.now();
  conversationStore.set(chatId, state);
}

export function addMessageToState(
  chatId: string,
  role: 'user' | 'assistant',
  content: string
): ConversationState | null {
  const state = conversationStore.get(chatId);
  if (!state) return null;

  state.messages.push({ role, content });
  state.lastActivity = Date.now();
  return state;
}

export function markConversationComplete(chatId: string): void {
  const state = conversationStore.get(chatId);
  if (state) {
    state.isComplete = true;
    state.lastActivity = Date.now();
  }
}

export function cleanupExpiredConversations(): void {
  const now = Date.now();
  for (const [chatId, state] of conversationStore.entries()) {
    if (now - state.lastActivity > CONVERSATION_TTL) {
      conversationStore.delete(chatId);
    }
  }
}

export function listConversationStates(): ConversationStateSnapshot[] {
  cleanupExpiredConversations();

  return [...conversationStore.values()].map((state) => ({
    chatId: state.chatId,
    isComplete: state.isComplete,
    lastActivity: state.lastActivity,
    messageCount: state.messages.length,
  }));
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

export function resetConversationState(chatId: string): void {
  conversationStore.delete(chatId);
}

export function resetConversationByPhoneNumber(phoneNumber: string): number {
  const normalizedTarget = normalizePhoneNumber(phoneNumber);
  if (!normalizedTarget) {
    return 0;
  }

  let removed = 0;
  for (const key of conversationStore.keys()) {
    if (normalizePhoneNumber(key) === normalizedTarget) {
      conversationStore.delete(key);
      removed += 1;
    }
  }

  return removed;
}

export function resetAllConversations(): number {
  const total = conversationStore.size;
  conversationStore.clear();
  return total;
}

setInterval(cleanupExpiredConversations, 60 * 60 * 1000);
