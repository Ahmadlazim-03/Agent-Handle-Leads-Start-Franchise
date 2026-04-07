import { getRedisClient } from './redis';

const REDIS_INCOMING_NUMBERS_KEY = 'wa:incoming:numbers';
const REDIS_KNOWN_NUMBERS_KEY = 'wa:known:numbers';
const REDIS_PROCESSING_NUMBERS_KEY = 'wa:processing:numbers';
const REDIS_STATUS_OVERRIDES_KEY = 'wa:numbers:status-overrides';

export type ManagedNumberStatus =
  | 'pernah_chat'
  | 'proses_bot'
  | 'selesai_berlabel';

const MANAGED_NUMBER_KEYS = [
  REDIS_INCOMING_NUMBERS_KEY,
  REDIS_KNOWN_NUMBERS_KEY,
  REDIS_PROCESSING_NUMBERS_KEY,
  REDIS_STATUS_OVERRIDES_KEY,
];

const VALID_STATUS_VALUES: ManagedNumberStatus[] = [
  'pernah_chat',
  'proses_bot',
  'selesai_berlabel',
];

function normalizePhoneNumber(chatId: string): string {
  return chatId.replace(/@c\.us$/i, '').replace(/\D/g, '');
}

function normalizeManagedStatus(
  value: string
): ManagedNumberStatus | null {
  const normalized = value.trim().toLowerCase() as ManagedNumberStatus;
  if (!VALID_STATUS_VALUES.includes(normalized)) {
    return null;
  }

  return normalized;
}

async function addPhoneNumberToSet(key: string, chatId: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  const phoneNumber = normalizePhoneNumber(chatId);
  if (!phoneNumber) {
    return false;
  }

  try {
    await client.sAdd(key, phoneNumber);
    return true;
  } catch (error) {
    console.error(`[Redis] Failed to save phone number to ${key}:`, error);
    return false;
  }
}

async function removePhoneNumberFromSet(
  key: string,
  chatId: string
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  const phoneNumber = normalizePhoneNumber(chatId);
  if (!phoneNumber) {
    return false;
  }

  try {
    await client.sRem(key, phoneNumber);
    return true;
  } catch (error) {
    console.error(`[Redis] Failed to remove phone number from ${key}:`, error);
    return false;
  }
}

export async function saveIncomingLeadNumber(chatId: string): Promise<boolean> {
  return addPhoneNumberToSet(REDIS_INCOMING_NUMBERS_KEY, chatId);
}

export async function saveKnownLeadNumber(chatId: string): Promise<boolean> {
  return addPhoneNumberToSet(REDIS_KNOWN_NUMBERS_KEY, chatId);
}

export async function saveProcessingLeadNumber(chatId: string): Promise<boolean> {
  return addPhoneNumberToSet(REDIS_PROCESSING_NUMBERS_KEY, chatId);
}

export async function isKnownLeadNumber(chatId: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  const phoneNumber = normalizePhoneNumber(chatId);
  if (!phoneNumber) {
    return false;
  }

  try {
    const exists = await client.sIsMember(REDIS_KNOWN_NUMBERS_KEY, phoneNumber);
    return Boolean(exists);
  } catch (error) {
    console.error('[Redis] Failed to fetch known lead number:', error);
    return false;
  }
}

export async function fetchIncomingLeadNumbers(limit = 100): Promise<string[]> {
  const client = await getRedisClient();
  if (!client) {
    return [];
  }

  const safeLimit = Math.max(0, limit);

  try {
    const phoneNumbers = await client.sMembers(REDIS_INCOMING_NUMBERS_KEY);
    return phoneNumbers.slice(0, safeLimit);
  } catch (error) {
    console.error('[Redis] Failed to fetch incoming lead numbers:', error);
    return [];
  }
}

export async function fetchKnownLeadNumbers(limit = 100): Promise<string[]> {
  const client = await getRedisClient();
  if (!client) {
    return [];
  }

  const safeLimit = Math.max(0, limit);

  try {
    const phoneNumbers = await client.sMembers(REDIS_KNOWN_NUMBERS_KEY);
    return phoneNumbers.slice(0, safeLimit);
  } catch (error) {
    console.error('[Redis] Failed to fetch known lead numbers:', error);
    return [];
  }
}

export async function removeKnownLeadNumber(chatId: string): Promise<boolean> {
  return removePhoneNumberFromSet(REDIS_KNOWN_NUMBERS_KEY, chatId);
}

export async function removeProcessingLeadNumber(chatId: string): Promise<boolean> {
  return removePhoneNumberFromSet(REDIS_PROCESSING_NUMBERS_KEY, chatId);
}

export async function fetchProcessingLeadNumbers(limit = 100): Promise<string[]> {
  const client = await getRedisClient();
  if (!client) {
    return [];
  }

  const safeLimit = Math.max(0, limit);

  try {
    const phoneNumbers = await client.sMembers(REDIS_PROCESSING_NUMBERS_KEY);
    return phoneNumbers.slice(0, safeLimit);
  } catch (error) {
    console.error('[Redis] Failed to fetch processing lead numbers:', error);
    return [];
  }
}

export async function fetchNumberStatusOverrides(): Promise<
  Record<string, ManagedNumberStatus>
> {
  const client = await getRedisClient();
  if (!client) {
    return {};
  }

  try {
    const raw = await client.hGetAll(REDIS_STATUS_OVERRIDES_KEY);
    const result: Record<string, ManagedNumberStatus> = {};

    for (const [phoneNumber, status] of Object.entries(raw)) {
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      const normalizedStatus = normalizeManagedStatus(status);

      if (!normalizedPhone || !normalizedStatus) {
        continue;
      }

      result[normalizedPhone] = normalizedStatus;
    }

    return result;
  } catch (error) {
    console.error('[Redis] Failed to fetch number status overrides:', error);
    return {};
  }
}

export async function getNumberStatusOverride(
  chatId: string
): Promise<ManagedNumberStatus | null> {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  const phoneNumber = normalizePhoneNumber(chatId);
  if (!phoneNumber) {
    return null;
  }

  try {
    const raw = await client.hGet(REDIS_STATUS_OVERRIDES_KEY, phoneNumber);
    if (!raw) {
      return null;
    }

    return normalizeManagedStatus(raw);
  } catch (error) {
    console.error('[Redis] Failed to get number status override:', error);
    return null;
  }
}

export async function setNumberStatusOverride(
  chatId: string,
  status: ManagedNumberStatus
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  const phoneNumber = normalizePhoneNumber(chatId);
  if (!phoneNumber) {
    return false;
  }

  try {
    await client.hSet(REDIS_STATUS_OVERRIDES_KEY, phoneNumber, status);
    return true;
  } catch (error) {
    console.error('[Redis] Failed to set number status override:', error);
    return false;
  }
}

export async function clearNumberStatusOverride(chatId: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  const phoneNumber = normalizePhoneNumber(chatId);
  if (!phoneNumber) {
    return false;
  }

  try {
    await client.hDel(REDIS_STATUS_OVERRIDES_KEY, phoneNumber);
    return true;
  } catch (error) {
    console.error('[Redis] Failed to clear number status override:', error);
    return false;
  }
}

export async function saveIncomingLeadNumbers(chatIds: string[]): Promise<number> {
  const client = await getRedisClient();
  if (!client) {
    return 0;
  }

  const normalizedNumbers = [...new Set(chatIds.map(normalizePhoneNumber).filter(Boolean))];
  if (normalizedNumbers.length === 0) {
    return 0;
  }

    try {
      const added = await client.sAdd(REDIS_INCOMING_NUMBERS_KEY, normalizedNumbers);
    return Number(added || 0);
  } catch (error) {
    console.error('[Redis] Failed to save incoming lead numbers in bulk:', error);
    return 0;
  }
}

export async function clearAllManagedNumbers(): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  try {
    await Promise.all(MANAGED_NUMBER_KEYS.map((key) => client.del(key)));
    return true;
  } catch (error) {
    console.error('[Redis] Failed to clear managed number keys:', error);
    return false;
  }
}
