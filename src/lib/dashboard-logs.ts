import { randomUUID } from 'node:crypto';
import { getRedisClient } from './redis';

export type DashboardLogLevel = 'info' | 'warn' | 'error';

export type DashboardLogEntry = {
  id: string;
  level: DashboardLogLevel;
  source: string;
  message: string;
  details: string;
  createdAt: string;
};

type AppendDashboardLogInput = {
  level: DashboardLogLevel;
  source: string;
  message: string;
  details?: unknown;
};

type DashboardLogQuery = {
  limit?: number;
  level?: string;
  search?: string;
  source?: string;
};

const DASHBOARD_LOGS_KEY = 'wa:dashboard:logs';
const MAX_LOG_ITEMS = 600;
const DEFAULT_FETCH_LIMIT = 80;
const MAX_FETCH_LIMIT = 250;
const MAX_SOURCE_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 420;
const MAX_DETAILS_LENGTH = 1_400;

const inMemoryDashboardLogs: DashboardLogEntry[] = [];

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toDetailsText(value: unknown): string {
  if (typeof value === 'undefined' || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (value instanceof Error) {
    return value.stack || value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toRedisLogEntry(input: AppendDashboardLogInput): DashboardLogEntry {
  const source = limitText(normalizeText(input.source) || 'system', MAX_SOURCE_LENGTH);
  const message = limitText(
    normalizeText(input.message) || 'Log message is empty.',
    MAX_MESSAGE_LENGTH
  );
  const details = limitText(toDetailsText(input.details), MAX_DETAILS_LENGTH);

  return {
    id: randomUUID(),
    level: input.level,
    source,
    message,
    details,
    createdAt: new Date().toISOString(),
  };
}

function parseStoredLog(value: string): DashboardLogEntry | null {
  try {
    const parsed = JSON.parse(value) as Partial<DashboardLogEntry>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.id !== 'string' ||
      typeof parsed.level !== 'string' ||
      typeof parsed.source !== 'string' ||
      typeof parsed.message !== 'string' ||
      typeof parsed.details !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }

    if (
      parsed.level !== 'info' &&
      parsed.level !== 'warn' &&
      parsed.level !== 'error'
    ) {
      return null;
    }

    return {
      id: parsed.id,
      level: parsed.level,
      source: parsed.source,
      message: parsed.message,
      details: parsed.details,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function appendToInMemory(entry: DashboardLogEntry): void {
  inMemoryDashboardLogs.unshift(entry);
  if (inMemoryDashboardLogs.length > MAX_LOG_ITEMS) {
    inMemoryDashboardLogs.length = MAX_LOG_ITEMS;
  }
}

function resolveLimit(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(Number(value), MAX_FETCH_LIMIT))
    : DEFAULT_FETCH_LIMIT;
}

function filterLogs(logs: DashboardLogEntry[], query: DashboardLogQuery): DashboardLogEntry[] {
  const normalizedLevel = normalizeText(query.level).toLowerCase();
  const normalizedSource = normalizeText(query.source).toLowerCase();
  const normalizedSearch = normalizeText(query.search).toLowerCase();

  const filtered = logs.filter((entry) => {
    if (normalizedLevel && normalizedLevel !== 'all' && entry.level !== normalizedLevel) {
      return false;
    }

    if (
      normalizedSource &&
      normalizedSource !== 'all' &&
      entry.source.toLowerCase() !== normalizedSource
    ) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return (
      entry.message.toLowerCase().includes(normalizedSearch) ||
      entry.details.toLowerCase().includes(normalizedSearch) ||
      entry.source.toLowerCase().includes(normalizedSearch)
    );
  });

  const limit = resolveLimit(query.limit);
  return filtered.slice(0, limit);
}

export async function appendDashboardLog(input: AppendDashboardLogInput): Promise<void> {
  const entry = toRedisLogEntry(input);
  appendToInMemory(entry);

  if (entry.level === 'error') {
    console.error(`[${entry.source}] ${entry.message}`, entry.details);
  } else if (entry.level === 'warn') {
    console.warn(`[${entry.source}] ${entry.message}`, entry.details);
  } else {
    console.log(`[${entry.source}] ${entry.message}`, entry.details);
  }

  const client = await getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.lPush(DASHBOARD_LOGS_KEY, JSON.stringify(entry));
    await client.lTrim(DASHBOARD_LOGS_KEY, 0, MAX_LOG_ITEMS - 1);
  } catch (error) {
    console.error('[DashboardLogs] Failed to persist log:', error);
  }
}

export async function listDashboardLogs(query: DashboardLogQuery): Promise<{
  logs: DashboardLogEntry[];
  redisAvailable: boolean;
  storage: 'redis' | 'memory';
}> {
  const client = await getRedisClient();
  if (!client) {
    return {
      logs: filterLogs(inMemoryDashboardLogs, query),
      redisAvailable: false,
      storage: 'memory',
    };
  }

  try {
    const rawValues = await client.lRange(DASHBOARD_LOGS_KEY, 0, MAX_LOG_ITEMS - 1);
    const parsedLogs = rawValues
      .map((entry) => parseStoredLog(entry))
      .filter((entry): entry is DashboardLogEntry => entry !== null);

    return {
      logs: filterLogs(parsedLogs, query),
      redisAvailable: true,
      storage: 'redis',
    };
  } catch (error) {
    console.error('[DashboardLogs] Failed to list logs:', error);
    return {
      logs: filterLogs(inMemoryDashboardLogs, query),
      redisAvailable: true,
      storage: 'memory',
    };
  }
}

export async function clearDashboardLogs(): Promise<{
  redisAvailable: boolean;
  removed: number;
  storage: 'redis' | 'memory';
}> {
  const removedFromMemory = inMemoryDashboardLogs.length;
  inMemoryDashboardLogs.length = 0;

  const client = await getRedisClient();
  if (!client) {
    return {
      redisAvailable: false,
      removed: removedFromMemory,
      storage: 'memory',
    };
  }

  try {
    const redisLength = await client.lLen(DASHBOARD_LOGS_KEY);
    await client.del(DASHBOARD_LOGS_KEY);

    return {
      redisAvailable: true,
      removed: Math.max(removedFromMemory, Number(redisLength)),
      storage: 'redis',
    };
  } catch (error) {
    console.error('[DashboardLogs] Failed to clear logs:', error);
    return {
      redisAvailable: true,
      removed: removedFromMemory,
      storage: 'memory',
    };
  }
}
