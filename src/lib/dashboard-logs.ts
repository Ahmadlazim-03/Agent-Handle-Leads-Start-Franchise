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

export async function appendDashboardLog(input: AppendDashboardLogInput): Promise<void> {
  const entry = toRedisLogEntry(input);

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
}> {
  const client = await getRedisClient();
  if (!client) {
    return {
      logs: [],
      redisAvailable: false,
    };
  }

  const limit = Number.isFinite(query.limit)
    ? Math.max(1, Math.min(Number(query.limit), MAX_FETCH_LIMIT))
    : DEFAULT_FETCH_LIMIT;

  const normalizedLevel = normalizeText(query.level).toLowerCase();
  const normalizedSource = normalizeText(query.source).toLowerCase();
  const normalizedSearch = normalizeText(query.search).toLowerCase();

  try {
    const rawValues = await client.lRange(DASHBOARD_LOGS_KEY, 0, MAX_LOG_ITEMS - 1);
    const parsedLogs = rawValues
      .map((entry) => parseStoredLog(entry))
      .filter((entry): entry is DashboardLogEntry => entry !== null);

    const filtered = parsedLogs.filter((entry) => {
      if (normalizedLevel && normalizedLevel !== 'all' && entry.level !== normalizedLevel) {
        return false;
      }

      if (normalizedSource && normalizedSource !== 'all' && entry.source.toLowerCase() !== normalizedSource) {
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

    return {
      logs: filtered.slice(0, limit),
      redisAvailable: true,
    };
  } catch (error) {
    console.error('[DashboardLogs] Failed to list logs:', error);
    return {
      logs: [],
      redisAvailable: true,
    };
  }
}

export async function clearDashboardLogs(): Promise<{
  redisAvailable: boolean;
  removed: number;
}> {
  const client = await getRedisClient();
  if (!client) {
    return {
      redisAvailable: false,
      removed: 0,
    };
  }

  try {
    const removed = await client.del(DASHBOARD_LOGS_KEY);
    return {
      redisAvailable: true,
      removed,
    };
  } catch (error) {
    console.error('[DashboardLogs] Failed to clear logs:', error);
    return {
      redisAvailable: true,
      removed: 0,
    };
  }
}
