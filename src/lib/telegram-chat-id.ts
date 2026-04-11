export function parseTelegramChatIds(rawValue: string): string[] {
  const parsed = rawValue
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(parsed)];
}

export function buildTelegramChatCandidates(chatId: string): string[] {
  const normalized = chatId.trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  if (normalized.startsWith('-') && !normalized.startsWith('-100')) {
    candidates.push(`-100${normalized.slice(1)}`);
  }

  return [...new Set(candidates)];
}
