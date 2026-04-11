import { getRedisClient } from './redis';

const REDIS_RUNTIME_ENV_KEY = 'wa:config:runtime-env-overrides';
const UPDATED_AT_FIELD_SUFFIX = '__updatedAt';
const RUNTIME_ENV_CACHE_TTL_MS = 1500;
const DEFAULT_MAX_RUNTIME_ENV_VALUE_LENGTH = 40_000;

export type RuntimeEnvSource = 'runtime' | 'env' | 'default';

export type RuntimeEnvKey =
  | 'OPENAI_API_KEY'
  | 'OPENAI_MODEL'
  | 'WAHA_URL'
  | 'WAHA_SESSION'
  | 'WAHA_API_KEY'
  | 'WAHA_NEW_LEAD_LABEL_NAME'
  | 'WAHA_NEW_LEAD_LABEL_COLOR'
  | 'ALLOW_EXISTING_LEADS_FOR_TEST'
  | 'NEW_LEAD_MAX_USER_MESSAGES'
  | 'TELEGRAM_BOT_TOKEN'
  | 'TELEGRAM_CHAT_ID'
  | 'MERCHANT_PRICING_SHEET_URL'
  | 'GOOGLE_SHEET_ID'
  | 'GOOGLE_SHEET_NAME'
  | 'GOOGLE_SERVICE_ACCOUNT_EMAIL'
  | 'GOOGLE_PRIVATE_KEY';

export type RuntimeEnvDefinition = {
  key: RuntimeEnvKey;
  label: string;
  description: string;
  defaultValue: string;
  isSecret: boolean;
  isMultiline: boolean;
  maxLength?: number;
};

export type RuntimeEnvItem = {
  key: RuntimeEnvKey;
  label: string;
  description: string;
  value: string;
  source: RuntimeEnvSource;
  configured: boolean;
  isSecret: boolean;
  isMultiline: boolean;
  updatedAt: string | null;
};

const RUNTIME_ENV_DEFINITIONS: RuntimeEnvDefinition[] = [
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI API Key',
    description: 'Kunci API untuk generate balasan AI.',
    defaultValue: '',
    isSecret: true,
    isMultiline: false,
  },
  {
    key: 'OPENAI_MODEL',
    label: 'OpenAI Model',
    description: 'Model OpenAI yang dipakai untuk chat completion.',
    defaultValue: 'gpt-4o',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'WAHA_URL',
    label: 'WAHA URL',
    description: 'Base URL instance WAHA.',
    defaultValue: 'http://localhost:3000',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'WAHA_SESSION',
    label: 'WAHA Session',
    description: 'Nama session WAHA aktif.',
    defaultValue: 'default',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'WAHA_API_KEY',
    label: 'WAHA API Key',
    description: 'Token otorisasi API WAHA.',
    defaultValue: '',
    isSecret: true,
    isMultiline: false,
  },
  {
    key: 'WAHA_NEW_LEAD_LABEL_NAME',
    label: 'WAHA Lead Label Name',
    description: 'Nama label yang dipakai saat lead selesai.',
    defaultValue: 'Lead Baru',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'WAHA_NEW_LEAD_LABEL_COLOR',
    label: 'WAHA Lead Label Color',
    description: 'Kode warna label WAHA (0-19).',
    defaultValue: '1',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'ALLOW_EXISTING_LEADS_FOR_TEST',
    label: 'Allow Existing Leads For Test',
    description: 'true/false untuk bypass gatekeeper existing lead.',
    defaultValue: 'false',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'NEW_LEAD_MAX_USER_MESSAGES',
    label: 'New Lead Max User Messages',
    description: 'Batas jumlah pesan user untuk klasifikasi lead baru.',
    defaultValue: '1',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram Bot Token',
    description: 'Token bot Telegram untuk notifikasi lead.',
    defaultValue: '',
    isSecret: true,
    isMultiline: false,
  },
  {
    key: 'TELEGRAM_CHAT_ID',
    label: 'Telegram Chat ID(s)',
    description:
      'Satu atau beberapa chat ID tujuan notifikasi Telegram (pisahkan dengan koma atau baris baru).',
    defaultValue: '',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'MERCHANT_PRICING_SHEET_URL',
    label: 'Merchant Pricing Sheet URL',
    description:
      'URL Google Spreadsheet katalog merchant untuk referensi harga/BEP AI.',
    defaultValue:
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vSCz5TL3fIx_hd9Z5pikqELuK4-wq2qX9Wy_aQ-Oop3NLvaUM65RCE7nBrvd0Nj9LlPCEVtZJlbtrTn/pub?gid=0&single=true&output=csv',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'GOOGLE_SHEET_ID',
    label: 'Google Sheet ID/URL',
    description: 'Spreadsheet target untuk penyimpanan lead.',
    defaultValue:
      'https://docs.google.com/spreadsheets/d/1kn23ILLqav6yn-FOSqsHxPIJNAeWKth-Jhk_jsJu6b0/edit?gid=2093370014#gid=2093370014',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'GOOGLE_SHEET_NAME',
    label: 'Google Sheet Tab Name',
    description: 'Nama tab sheet tujuan.',
    defaultValue: 'Informasi Client',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    label: 'Google Service Account Email',
    description: 'Email service account untuk akses Google Sheets.',
    defaultValue: '',
    isSecret: false,
    isMultiline: false,
  },
  {
    key: 'GOOGLE_PRIVATE_KEY',
    label: 'Google Private Key',
    description: 'Private key service account (PEM).',
    defaultValue: '',
    isSecret: true,
    isMultiline: true,
  },
];

const RUNTIME_ENV_DEFINITION_MAP = new Map<RuntimeEnvKey, RuntimeEnvDefinition>(
  RUNTIME_ENV_DEFINITIONS.map((definition) => [definition.key, definition])
);

type RuntimeEnvCache = {
  loadedAt: number;
  raw: Record<string, string>;
};

let runtimeEnvCache: RuntimeEnvCache | null = null;

function normalizeValue(value: string, isMultiline: boolean): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!isMultiline) {
    return normalized;
  }

  return normalized;
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

function getDefinition(key: RuntimeEnvKey): RuntimeEnvDefinition {
  const definition = RUNTIME_ENV_DEFINITION_MAP.get(key);
  if (!definition) {
    throw new Error(`Unsupported runtime env key: ${key}`);
  }

  return definition;
}

function getUpdatedAtFieldName(key: RuntimeEnvKey): string {
  return `${key}${UPDATED_AT_FIELD_SUFFIX}`;
}

function resolveFromEnvOrDefault(definition: RuntimeEnvDefinition): {
  value: string;
  source: RuntimeEnvSource;
} {
  const rawFromEnv = process.env[definition.key];
  const normalizedFromEnv =
    typeof rawFromEnv === 'string'
      ? normalizeValue(rawFromEnv, definition.isMultiline)
      : '';

  if (normalizedFromEnv) {
    return {
      value: normalizedFromEnv,
      source: 'env',
    };
  }

  return {
    value: normalizeValue(definition.defaultValue, definition.isMultiline),
    source: 'default',
  };
}

async function getRuntimeOverrideRawMap(force = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (
    !force &&
    runtimeEnvCache &&
    now - runtimeEnvCache.loadedAt < RUNTIME_ENV_CACHE_TTL_MS
  ) {
    return runtimeEnvCache.raw;
  }

  const client = await getRedisClient();
  if (!client) {
    runtimeEnvCache = {
      loadedAt: now,
      raw: {},
    };
    return {};
  }

  try {
    const raw = await client.hGetAll(REDIS_RUNTIME_ENV_KEY);
    runtimeEnvCache = {
      loadedAt: now,
      raw,
    };
    return raw;
  } catch (error) {
    console.error('[RuntimeEnv] Failed to load runtime env overrides:', error);
    runtimeEnvCache = {
      loadedAt: now,
      raw: {},
    };
    return {};
  }
}

function buildRuntimeEnvItemFromRaw(
  definition: RuntimeEnvDefinition,
  rawMap: Record<string, string>
): RuntimeEnvItem {
  const overrideRaw = rawMap[definition.key];
  const overrideValue =
    typeof overrideRaw === 'string'
      ? normalizeValue(overrideRaw, definition.isMultiline)
      : '';

  if (overrideValue) {
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      value: overrideValue,
      source: 'runtime',
      configured: true,
      isSecret: definition.isSecret,
      isMultiline: definition.isMultiline,
      updatedAt: normalizeUpdatedAt(rawMap[getUpdatedAtFieldName(definition.key)]),
    };
  }

  const fallback = resolveFromEnvOrDefault(definition);
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    value: fallback.value,
    source: fallback.source,
    configured: Boolean(fallback.value),
    isSecret: definition.isSecret,
    isMultiline: definition.isMultiline,
    updatedAt: null,
  };
}

function invalidateRuntimeEnvCache(): void {
  runtimeEnvCache = null;
}

export function listRuntimeEnvDefinitions(): RuntimeEnvDefinition[] {
  return [...RUNTIME_ENV_DEFINITIONS];
}

export async function getRuntimeEnvConfigItems(): Promise<RuntimeEnvItem[]> {
  const rawMap = await getRuntimeOverrideRawMap();
  return RUNTIME_ENV_DEFINITIONS.map((definition) =>
    buildRuntimeEnvItemFromRaw(definition, rawMap)
  );
}

export async function getRuntimeEnvValue(key: RuntimeEnvKey): Promise<string> {
  const definition = getDefinition(key);
  const rawMap = await getRuntimeOverrideRawMap();
  return buildRuntimeEnvItemFromRaw(definition, rawMap).value;
}

export async function getRuntimeEnvValues(
  keys: RuntimeEnvKey[]
): Promise<Record<RuntimeEnvKey, string>> {
  const rawMap = await getRuntimeOverrideRawMap();
  const result = {} as Record<RuntimeEnvKey, string>;

  for (const key of keys) {
    const definition = getDefinition(key);
    result[key] = buildRuntimeEnvItemFromRaw(definition, rawMap).value;
  }

  return result;
}

export async function saveRuntimeEnvValue(
  key: RuntimeEnvKey,
  value: string
): Promise<{ ok: boolean; error?: string; item?: RuntimeEnvItem }> {
  const definition = getDefinition(key);
  const normalized = normalizeValue(value, definition.isMultiline);

  if (!normalized) {
    return {
      ok: false,
      error: 'Value tidak boleh kosong. Gunakan action reset untuk kembali ke nilai default/env.',
    };
  }

  const maxLength = definition.maxLength ?? DEFAULT_MAX_RUNTIME_ENV_VALUE_LENGTH;
  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `Value terlalu panjang. Maksimal ${maxLength} karakter.`,
    };
  }

  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false,
      error: 'Redis tidak tersedia. Runtime env belum tersimpan.',
    };
  }

  try {
    const updatedAt = new Date().toISOString();

    await client.hSet(REDIS_RUNTIME_ENV_KEY, {
      [key]: normalized,
      [getUpdatedAtFieldName(key)]: updatedAt,
    });

    invalidateRuntimeEnvCache();
    const rawMap = await getRuntimeOverrideRawMap(true);

    return {
      ok: true,
      item: buildRuntimeEnvItemFromRaw(definition, rawMap),
    };
  } catch (error) {
    console.error('[RuntimeEnv] Failed to save runtime env value:', error);
    return {
      ok: false,
      error: 'Gagal menyimpan runtime env ke Redis.',
    };
  }
}

export async function resetRuntimeEnvValue(
  key: RuntimeEnvKey
): Promise<{ ok: boolean; error?: string; item?: RuntimeEnvItem }> {
  const definition = getDefinition(key);

  const client = await getRedisClient();
  if (!client) {
    return {
      ok: false,
      error: 'Redis tidak tersedia. Runtime env belum direset.',
    };
  }

  try {
    await client.hDel(REDIS_RUNTIME_ENV_KEY, [key, getUpdatedAtFieldName(key)]);

    invalidateRuntimeEnvCache();
    const rawMap = await getRuntimeOverrideRawMap(true);

    return {
      ok: true,
      item: buildRuntimeEnvItemFromRaw(definition, rawMap),
    };
  } catch (error) {
    console.error('[RuntimeEnv] Failed to reset runtime env value:', error);
    return {
      ok: false,
      error: 'Gagal reset runtime env dari Redis.',
    };
  }
}
