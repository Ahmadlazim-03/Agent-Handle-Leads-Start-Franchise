import { JWT } from 'google-auth-library';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { NextRequest, NextResponse } from 'next/server';
import { createUnauthorizedResponse, isAdminAuthenticated } from '@/lib/admin-auth-guard';
import { getRedisClient } from '@/lib/redis';
import { getRuntimeEnvValues } from '@/lib/runtime-env';
import { buildTelegramChatCandidates, parseTelegramChatIds } from '@/lib/telegram-chat-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IntegrationKey = 'redis' | 'waha' | 'telegram' | 'spreadsheet';

type IntegrationStatus = {
  key: IntegrationKey;
  label: string;
  connected: boolean;
  configured: boolean;
  message: string;
  latencyMs: number | null;
  checkedAt: string;
};

const DEFAULT_GOOGLE_SHEET_SOURCE =
  'https://docs.google.com/spreadsheets/d/1kn23ILLqav6yn-FOSqsHxPIJNAeWKth-Jhk_jsJu6b0/edit?gid=2093370014#gid=2093370014';
const DEFAULT_GOOGLE_SHEET_NAME = 'Informasi Client';

function truncateText(value: string, max = 220): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 3)}...`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function extractSpreadsheetId(rawValue: string): string {
  const trimmed = rawValue.trim();

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Value is already a plain sheet ID.
  }

  const fallbackMatch = trimmed.match(/\/d\/([^/]+)/i);
  if (fallbackMatch?.[1]) {
    return fallbackMatch[1];
  }

  return trimmed;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function buildWahaHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildWahaUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string>
): string {
  const url = new URL(path, baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 7000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkRedisStatus(): Promise<IntegrationStatus> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const hasRedisUrl = Boolean(process.env.REDIS_URL?.trim());

  if (!hasRedisUrl) {
    return {
      key: 'redis',
      label: 'Redis',
      connected: false,
      configured: false,
      message: 'REDIS_URL belum diatur.',
      latencyMs: null,
      checkedAt,
    };
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return {
        key: 'redis',
        label: 'Redis',
        connected: false,
        configured: true,
        message: 'Koneksi Redis gagal dibuka.',
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    const pingResponse = await client.ping();

    return {
      key: 'redis',
      label: 'Redis',
      connected: true,
      configured: true,
      message: `Redis merespons ping: ${pingResponse}.`,
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  } catch (error) {
    return {
      key: 'redis',
      label: 'Redis',
      connected: false,
      configured: true,
      message: truncateText(normalizeErrorMessage(error)),
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  }
}

async function checkWahaStatus(): Promise<IntegrationStatus> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const runtimeValues = await getRuntimeEnvValues([
    'WAHA_URL',
    'WAHA_SESSION',
    'WAHA_API_KEY',
  ]);
  const session = runtimeValues.WAHA_SESSION.trim() || 'default';
  const wahaUrl = runtimeValues.WAHA_URL.trim() || 'http://localhost:3000';
  const wahaApiKey = runtimeValues.WAHA_API_KEY.trim();

  const probes: Array<{ label: string; url: string }> = [];

  try {
    probes.push({
      label: 'session chats',
      url: buildWahaUrl(wahaUrl, `/api/${encodeURIComponent(session)}/chats`, {
        limit: '1',
        offset: '0',
      }),
    });
    probes.push({
      label: 'contacts',
      url: buildWahaUrl(wahaUrl, '/api/contacts/all', {
        session,
        limit: '1',
        offset: '0',
      }),
    });
  } catch (error) {
    return {
      key: 'waha',
      label: 'WAHA',
      connected: false,
      configured: false,
      message: `Konfigurasi WAHA_URL tidak valid: ${truncateText(normalizeErrorMessage(error))}`,
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  }

  const errors: string[] = [];

  for (const probe of probes) {
    try {
      const response = await fetchWithTimeout(
        probe.url,
        {
          method: 'GET',
          headers: buildWahaHeaders(wahaApiKey),
        },
        7000
      );

      if (response.ok) {
        return {
          key: 'waha',
          label: 'WAHA',
          connected: true,
          configured: true,
          message: `WAHA tersambung melalui endpoint ${probe.label}.`,
          latencyMs: Date.now() - startedAt,
          checkedAt,
        };
      }

      const body = await response.text().catch(() => '');
      errors.push(
        `${probe.label}: ${response.status} ${response.statusText} ${truncateText(body)}`
      );
    } catch (error) {
      errors.push(`${probe.label}: ${truncateText(normalizeErrorMessage(error))}`);
    }
  }

  return {
    key: 'waha',
    label: 'WAHA',
    connected: false,
    configured: true,
    message:
      errors.length > 0
        ? truncateText(errors.join(' | '))
        : 'Tidak ada respons dari endpoint WAHA.',
    latencyMs: Date.now() - startedAt,
    checkedAt,
  };
}

async function checkTelegramStatus(): Promise<IntegrationStatus> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const runtimeValues = await getRuntimeEnvValues([
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ]);
  const botToken = runtimeValues.TELEGRAM_BOT_TOKEN.trim();
  const chatIds = parseTelegramChatIds(runtimeValues.TELEGRAM_CHAT_ID);

  if (!botToken || chatIds.length === 0) {
    return {
      key: 'telegram',
      label: 'Telegram',
      connected: false,
      configured: false,
      message:
        'TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diatur (pisahkan banyak ID dengan koma/baris baru).',
      latencyMs: null,
      checkedAt,
    };
  }

  const baseUrl = `https://api.telegram.org/bot${botToken}`;

  try {
    const meResponse = await fetchWithTimeout(`${baseUrl}/getMe`, { method: 'GET' }, 7000);
    const meText = await meResponse.text().catch(() => '');

    if (!meResponse.ok) {
      return {
        key: 'telegram',
        label: 'Telegram',
        connected: false,
        configured: true,
        message: `Telegram getMe gagal: ${meResponse.status} ${meResponse.statusText} ${truncateText(meText)}`,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    const successfulTargets: string[] = [];
    const failedTargets: string[] = [];

    for (const configuredChatId of chatIds) {
      const chatCandidates = buildTelegramChatCandidates(configuredChatId);
      let targetResolved = false;
      let targetError = '';

      for (let index = 0; index < chatCandidates.length; index += 1) {
        const candidate = chatCandidates[index];
        const chatUrl = new URL(`${baseUrl}/getChat`);
        chatUrl.searchParams.set('chat_id', candidate);

        const chatResponse = await fetchWithTimeout(chatUrl.toString(), { method: 'GET' }, 7000);
        const chatBody = await chatResponse.text().catch(() => '');

        if (chatResponse.ok) {
          successfulTargets.push(candidate);
          targetResolved = true;
          break;
        }

        const isChatNotFound = /chat not found/i.test(chatBody);
        const hasMoreCandidates = index < chatCandidates.length - 1;
        if (isChatNotFound && hasMoreCandidates) {
          continue;
        }

        targetError = `${chatResponse.status} ${chatResponse.statusText} ${truncateText(chatBody)}`;
        break;
      }

      if (!targetResolved) {
        failedTargets.push(
          targetError
            ? `${configuredChatId} (${targetError})`
            : configuredChatId
        );
      }
    }

    if (successfulTargets.length === 0) {
      return {
        key: 'telegram',
        label: 'Telegram',
        connected: false,
        configured: true,
        message: `Telegram getChat gagal untuk semua chat ID: ${truncateText(failedTargets.join(' | '))}`,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    if (failedTargets.length > 0) {
      return {
        key: 'telegram',
        label: 'Telegram',
        connected: true,
        configured: true,
        message: truncateText(
          `Bot token valid. ${successfulTargets.length}/${chatIds.length} chat ID dapat diakses. Gagal: ${failedTargets.join(' | ')}`
        ),
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    return {
      key: 'telegram',
      label: 'Telegram',
      connected: true,
      configured: true,
      message: `Bot token valid dan ${successfulTargets.length} chat ID dapat diakses.`,
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  } catch (error) {
    return {
      key: 'telegram',
      label: 'Telegram',
      connected: false,
      configured: true,
      message: truncateText(normalizeErrorMessage(error)),
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  }
}

async function checkSpreadsheetStatus(): Promise<IntegrationStatus> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  const runtimeValues = await getRuntimeEnvValues([
    'GOOGLE_SHEET_ID',
    'GOOGLE_SHEET_NAME',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
  ]);

  const rawSheetSource =
    runtimeValues.GOOGLE_SHEET_ID.trim() || DEFAULT_GOOGLE_SHEET_SOURCE;
  const spreadsheetId = extractSpreadsheetId(rawSheetSource);
  const sheetName =
    runtimeValues.GOOGLE_SHEET_NAME.trim() || DEFAULT_GOOGLE_SHEET_NAME;

  const email = stripWrappingQuotes(runtimeValues.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim());
  const rawPrivateKey = stripWrappingQuotes(runtimeValues.GOOGLE_PRIVATE_KEY.trim());
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

  if (!spreadsheetId) {
    return {
      key: 'spreadsheet',
      label: 'Spreadsheet',
      connected: false,
      configured: false,
      message: 'GOOGLE_SHEET_ID tidak valid atau belum diatur.',
      latencyMs: null,
      checkedAt,
    };
  }

  if (!email || !privateKey) {
    return {
      key: 'spreadsheet',
      label: 'Spreadsheet',
      connected: false,
      configured: false,
      message: 'Credential Google service account belum lengkap.',
      latencyMs: null,
      checkedAt,
    };
  }

  if (email.includes('your-service-account@') || privateKey.includes('...')) {
    return {
      key: 'spreadsheet',
      label: 'Spreadsheet',
      connected: false,
      configured: false,
      message: 'Credential Google masih placeholder.',
      latencyMs: null,
      checkedAt,
    };
  }

  try {
    const auth = new JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, auth);
    await doc.loadInfo();

    const targetSheet = sheetName
      ? doc.sheetsByTitle[sheetName]
      : doc.sheetsByIndex[0];

    if (!targetSheet) {
      return {
        key: 'spreadsheet',
        label: 'Spreadsheet',
        connected: false,
        configured: true,
        message: `Sheet tab tidak ditemukan: ${sheetName || '(sheet pertama)'}.`,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    await targetSheet.loadHeaderRow();

    return {
      key: 'spreadsheet',
      label: 'Spreadsheet',
      connected: true,
      configured: true,
      message: `Terhubung ke tab ${targetSheet.title} dengan ${targetSheet.headerValues.length} header.`,
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  } catch (error) {
    return {
      key: 'spreadsheet',
      label: 'Spreadsheet',
      connected: false,
      configured: true,
      message: truncateText(normalizeErrorMessage(error)),
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  }
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return createUnauthorizedResponse();
  }

  try {
    const [redis, waha, telegram, spreadsheet] = await Promise.all([
      checkRedisStatus(),
      checkWahaStatus(),
      checkTelegramStatus(),
      checkSpreadsheetStatus(),
    ]);

    const services = [redis, waha, telegram, spreadsheet];
    const connectedCount = services.filter((service) => service.connected).length;

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      summary: {
        connected: connectedCount,
        total: services.length,
      },
      services,
    });
  } catch (error) {
    console.error('[Dashboard Integrations API] Failed to check integration status:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to check integration status',
      },
      {
        status: 500,
      }
    );
  }
}