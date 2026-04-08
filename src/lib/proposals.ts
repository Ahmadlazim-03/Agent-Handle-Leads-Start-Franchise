import axios from 'axios';

type JsonRecord = Record<string, unknown>;

interface ParsedProposalEntry {
  brandName: string;
  aliases: string[];
  fileUrl: string;
  filename: string;
  caption?: string;
}

interface RawProposalEntry {
  url?: unknown;
  driveUrl?: unknown;
  name?: unknown;
  aliases?: unknown;
  filename?: unknown;
  caption?: unknown;
}

export interface BrandProposalFile {
  brandName: string;
  fileUrl: string;
  filename: string;
  caption?: string;
  mimetype: 'application/pdf';
}

export interface ProposalLookupResult {
  isProposalIntent: boolean;
  proposal: BrandProposalFile | null;
}

interface DriveFileRecord {
  id?: unknown;
  name?: unknown;
}

interface DriveFilesListResponse {
  nextPageToken?: unknown;
  files?: unknown;
}

const PROPOSAL_INTENT_TERMS = [
  'proposal',
  'brosur',
  'brochure',
  'prospektus',
  'deck',
  'company profile',
  'profil brand',
  'pdf',
];

const BRAND_PROPOSAL_FILES_JSON =
  process.env.BRAND_PROPOSAL_FILES_JSON?.trim() || '';
const BRAND_PROPOSAL_DRIVE_FOLDER_INPUT =
  process.env.BRAND_PROPOSAL_DRIVE_FOLDER_ID?.trim() ||
  process.env.BRAND_PROPOSAL_DRIVE_FOLDER_URL?.trim() ||
  '';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY?.trim() || '';
const DRIVE_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

let envProposalCatalogCache: ParsedProposalEntry[] | null = null;
let driveProposalCatalogCache:
  | {
      expiresAt: number;
      entries: ParsedProposalEntry[];
    }
  | null = null;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesTerm(normalizedMessage: string, term: string): boolean {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  const pattern = normalizedTerm
    .split(' ')
    .map((segment) => escapeRegExp(segment))
    .join('\\s+');

  return new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`, 'i').test(normalizedMessage);
}

function extractGoogleDriveFileId(input: string): string | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const directIdMatch = trimmedInput.match(/^[a-zA-Z0-9_-]{20,}$/);
  if (directIdMatch) {
    return directIdMatch[0];
  }

  try {
    const parsedUrl = new URL(trimmedInput);
    const host = parsedUrl.hostname.toLowerCase();

    if (!host.includes('drive.google.com')) {
      return null;
    }

    const queryId = parsedUrl.searchParams.get('id');
    if (queryId && queryId.trim().length > 0) {
      return queryId.trim();
    }

    const path = parsedUrl.pathname;
    const filePathMatch = path.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (filePathMatch) {
      return filePathMatch[1];
    }

    const genericPathMatch = path.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (genericPathMatch) {
      return genericPathMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

function toDriveDownloadUrl(input: string): string {
  const fileId = extractGoogleDriveFileId(input);
  if (!fileId) {
    return input.trim();
  }

  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function toTitleCase(input: string): string {
  return normalizeWhitespace(input)
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function toBrandNameFromFilename(input: string): string {
  let normalized = normalizeWhitespace(input).replace(/\.pdf$/i, '');

  normalized = normalized
    .replace(/^copy\s+of\s+/i, '')
    .replace(/^proposal\s+/i, '')
    .replace(/^peluang\s+bisnis\s+/i, '')
    .replace(/\(\d+\)\s*$/g, '')
    .trim();

  if (!normalized) {
    return 'Proposal Brand';
  }

  const hasLowercase = /[a-z]/.test(normalized);
  if (hasLowercase) {
    return normalized;
  }

  return toTitleCase(normalized.toLowerCase());
}

function sanitizeFilename(input: string): string {
  const normalized = normalizeWhitespace(input)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const withFallback = normalized || 'proposal-brand';
  if (withFallback.toLowerCase().endsWith('.pdf')) {
    return withFallback;
  }

  return `${withFallback}.pdf`;
}

function parseAliases(
  brandKey: string,
  brandName: string,
  rawAliases: unknown
): string[] {
  const aliases = new Set<string>();

  const appendAlias = (value: string): void => {
    const normalizedAlias = normalizeSearchText(value);
    if (normalizedAlias) {
      aliases.add(normalizedAlias);
    }
  };

  appendAlias(brandKey);
  appendAlias(brandName);

  if (Array.isArray(rawAliases)) {
    rawAliases
      .filter((item): item is string => typeof item === 'string')
      .forEach((alias) => appendAlias(alias));
  }

  return [...aliases];
}

function parseEntry(brandKey: string, rawValue: unknown): ParsedProposalEntry | null {
  const normalizedBrandKey = normalizeWhitespace(brandKey);
  if (!normalizedBrandKey) {
    return null;
  }

  let brandName = toTitleCase(normalizedBrandKey);
  let rawUrl = '';
  let rawAliases: unknown = undefined;
  let filename = '';
  let caption: string | undefined;

  if (typeof rawValue === 'string') {
    rawUrl = normalizeWhitespace(rawValue);
  } else {
    const record = asRecord(rawValue) as RawProposalEntry | null;
    if (!record) {
      return null;
    }

    if (typeof record.name === 'string' && record.name.trim().length > 0) {
      brandName = normalizeWhitespace(record.name);
    }

    if (typeof record.url === 'string') {
      rawUrl = normalizeWhitespace(record.url);
    } else if (typeof record.driveUrl === 'string') {
      rawUrl = normalizeWhitespace(record.driveUrl);
    }

    rawAliases = record.aliases;

    if (typeof record.filename === 'string') {
      filename = normalizeWhitespace(record.filename);
    }

    if (typeof record.caption === 'string') {
      const trimmedCaption = normalizeWhitespace(record.caption);
      if (trimmedCaption) {
        caption = trimmedCaption;
      }
    }
  }

  if (!rawUrl) {
    console.warn(
      `[Proposal] Skip brand "${normalizedBrandKey}" because URL is missing in BRAND_PROPOSAL_FILES_JSON.`
    );
    return null;
  }

  const aliases = parseAliases(normalizedBrandKey, brandName, rawAliases);
  if (aliases.length === 0) {
    return null;
  }

  const generatedFilename = sanitizeFilename(filename || `${brandName}-proposal.pdf`);

  return {
    brandName,
    aliases,
    fileUrl: toDriveDownloadUrl(rawUrl),
    filename: generatedFilename,
    caption,
  };
}

function parseCatalogFromEnv(): ParsedProposalEntry[] {
  if (!BRAND_PROPOSAL_FILES_JSON) {
    return [];
  }

  try {
    const parsed = JSON.parse(BRAND_PROPOSAL_FILES_JSON) as unknown;
    const parsedRecord = asRecord(parsed);

    if (!parsedRecord) {
      console.error('[Proposal] BRAND_PROPOSAL_FILES_JSON must be a JSON object.');
      return [];
    }

    return Object.entries(parsedRecord)
      .map(([brandKey, value]) => parseEntry(brandKey, value))
      .filter((entry): entry is ParsedProposalEntry => entry !== null);
  } catch (error) {
    console.error('[Proposal] Failed to parse BRAND_PROPOSAL_FILES_JSON:', error);
    return [];
  }
}

function extractGoogleDriveFolderId(input: string): string | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const directIdMatch = trimmedInput.match(/^[a-zA-Z0-9_-]{20,}$/);
  if (directIdMatch) {
    return directIdMatch[0];
  }

  try {
    const parsedUrl = new URL(trimmedInput);
    const host = parsedUrl.hostname.toLowerCase();

    if (!host.includes('drive.google.com')) {
      return null;
    }

    const queryId = parsedUrl.searchParams.get('id');
    if (queryId && queryId.trim().length > 0) {
      return queryId.trim();
    }

    const folderPathMatch = parsedUrl.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderPathMatch) {
      return folderPathMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeDriveFile(raw: unknown): { id: string; name: string } | null {
  const record = asRecord(raw) as DriveFileRecord | null;
  if (!record) {
    return null;
  }

  const id = normalizeWhitespace(String(record.id ?? ''));
  const name = normalizeWhitespace(String(record.name ?? ''));

  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function toDriveDownloadUrlById(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

async function fetchCatalogFromDriveFolder(): Promise<ParsedProposalEntry[]> {
  const folderId = extractGoogleDriveFolderId(BRAND_PROPOSAL_DRIVE_FOLDER_INPUT);

  if (!folderId || !GOOGLE_API_KEY) {
    return [];
  }

  const dedupeByName = new Set<string>();
  const entries: ParsedProposalEntry[] = [];

  let nextPageToken = '';

  try {
    while (true) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
        fields: 'nextPageToken,files(id,name)',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        pageSize: '1000',
        key: GOOGLE_API_KEY,
      });

      if (nextPageToken) {
        params.set('pageToken', nextPageToken);
      }

      const response = await axios.get<DriveFilesListResponse>(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
        {
          timeout: 20000,
        }
      );

      const payload = response.data;
      const files = Array.isArray(payload.files) ? payload.files : [];

      for (const rawFile of files) {
        const file = normalizeDriveFile(rawFile);
        if (!file) {
          continue;
        }

        const brandName = toBrandNameFromFilename(file.name);
        const brandKey = normalizeSearchText(brandName);

        if (!brandKey || dedupeByName.has(brandKey)) {
          continue;
        }

        dedupeByName.add(brandKey);

        entries.push({
          brandName,
          aliases: parseAliases(brandName, brandName, undefined),
          fileUrl: toDriveDownloadUrlById(file.id),
          filename: sanitizeFilename(file.name),
        });
      }

      nextPageToken =
        typeof payload.nextPageToken === 'string'
          ? payload.nextPageToken.trim()
          : '';

      if (!nextPageToken) {
        break;
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const body = JSON.stringify(error.response?.data || error.message).slice(
        0,
        500
      );
      console.error(
        `[Proposal] Failed to list Google Drive folder files via axios: status=${status ?? 'unknown'} body=${body}`
      );
      return [];
    }

    console.error('[Proposal] Unexpected error when listing Drive folder:', error);
    return [];
  }

  return entries;
}

function getCatalogFromEnv(): ParsedProposalEntry[] {
  if (!envProposalCatalogCache) {
    envProposalCatalogCache = parseCatalogFromEnv();
  }

  return envProposalCatalogCache;
}

async function getCatalogFromDriveFolder(): Promise<ParsedProposalEntry[]> {
  if (!BRAND_PROPOSAL_DRIVE_FOLDER_INPUT) {
    return [];
  }

  const cache = driveProposalCatalogCache;
  if (cache && cache.expiresAt > Date.now()) {
    return cache.entries;
  }

  const entries = await fetchCatalogFromDriveFolder();
  driveProposalCatalogCache = {
    entries,
    expiresAt: Date.now() + DRIVE_CATALOG_CACHE_TTL_MS,
  };

  return entries;
}

async function getProposalCatalog(): Promise<ParsedProposalEntry[]> {
  const envCatalog = getCatalogFromEnv();
  const driveCatalog = await getCatalogFromDriveFolder();

  if (envCatalog.length === 0) {
    return driveCatalog;
  }

  if (driveCatalog.length === 0) {
    return envCatalog;
  }

  const envBrandKeys = new Set(
    envCatalog.map((entry) => normalizeSearchText(entry.brandName))
  );

  const merged = [...envCatalog];
  for (const driveEntry of driveCatalog) {
    const brandKey = normalizeSearchText(driveEntry.brandName);
    if (!brandKey || envBrandKeys.has(brandKey)) {
      continue;
    }

    merged.push(driveEntry);
  }

  return merged;
}

function hasProposalIntent(messageText: string): boolean {
  const normalizedMessage = normalizeSearchText(messageText);
  if (!normalizedMessage) {
    return false;
  }

  return PROPOSAL_INTENT_TERMS.some((term) => matchesTerm(normalizedMessage, term));
}

export async function listAvailableProposalBrands(): Promise<string[]> {
  const catalog = await getProposalCatalog();
  return catalog.map((entry) => entry.brandName);
}

export async function resolveBrandProposalRequest(
  messageText: string
): Promise<ProposalLookupResult> {
  if (!hasProposalIntent(messageText)) {
    return {
      isProposalIntent: false,
      proposal: null,
    };
  }

  const normalizedMessage = normalizeSearchText(messageText);
  const catalog = [...(await getProposalCatalog())].sort(
    (a, b) =>
      Math.max(...b.aliases.map((alias) => alias.length)) -
      Math.max(...a.aliases.map((alias) => alias.length))
  );

  const matched =
    catalog.find((entry) =>
      entry.aliases.some((alias) => matchesTerm(normalizedMessage, alias))
    ) || null;

  if (!matched) {
    return {
      isProposalIntent: true,
      proposal: null,
    };
  }

  return {
    isProposalIntent: true,
    proposal: {
      brandName: matched.brandName,
      fileUrl: matched.fileUrl,
      filename: matched.filename,
      caption: matched.caption,
      mimetype: 'application/pdf',
    },
  };
}
