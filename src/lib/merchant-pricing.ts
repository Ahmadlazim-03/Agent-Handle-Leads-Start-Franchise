import axios from 'axios';
import { getRuntimeEnvValues } from './runtime-env';

const DEFAULT_MERCHANT_PRICING_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSCz5TL3fIx_hd9Z5pikqELuK4-wq2qX9Wy_aQ-Oop3NLvaUM65RCE7nBrvd0Nj9LlPCEVtZJlbtrTn/pub?gid=0&single=true&output=csv';
const MERCHANT_PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MERCHANT_CONTEXT_ITEMS = 120;

type MerchantPricingItem = {
  name: string;
  price: string;
  bep: string;
  system: string;
};

type MerchantPricingCache = {
  loadedAt: number;
  context: string;
};

let merchantPricingCache: MerchantPricingCache | null = null;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function resolveCsvUrl(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return DEFAULT_MERCHANT_PRICING_SHEET_URL;
  }

  try {
    const url = new URL(trimmed);

    if (url.searchParams.get('output')?.toLowerCase() === 'csv') {
      return url.toString();
    }

    if (/^\/spreadsheets\/d\/[^/]+/i.test(url.pathname)) {
      const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/i);
      if (match?.[1]) {
        const gid = url.searchParams.get('gid') || '0';
        return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
      }
    }

    if (/^\/spreadsheets\/d\/e\/[^/]+\/pub/i.test(url.pathname)) {
      url.searchParams.set('output', 'csv');
      return url.toString();
    }

    return url.toString();
  } catch {
    return trimmed;
  }
}

function mapRowsToMerchantItems(rows: string[][]): MerchantPricingItem[] {
  const items: MerchantPricingItem[] = [];

  for (const row of rows) {
    const cells = row.map((value) => normalizeText(value));
    const firstCell = (cells[0] || '').toLowerCase();
    const secondCell = cells[1] || '';

    if (!secondCell || firstCell === 'no' || secondCell.toLowerCase() === 'nama') {
      continue;
    }

    items.push({
      name: secondCell,
      price: cells[2] || '-',
      bep: cells[3] || '-',
      system: cells[4] || '-',
    });
  }

  return items;
}

function buildMerchantPricingContext(csvUrl: string, items: MerchantPricingItem[]): string {
  if (items.length === 0) {
    return '';
  }

  const catalogLines = items
    .slice(0, MAX_MERCHANT_CONTEXT_ITEMS)
    .map(
      (item, index) =>
        `${index + 1}. ${item.name} | Harga: ${item.price} | BEP: ${item.bep} | Sistem: ${item.system}`
    )
    .join('\n');

  return [
    'KATALOG MERCHANT STARTFRANCHISE (REFERENSI HARGA TERBARU):',
    `Sumber CSV: ${csvUrl}`,
    catalogLines,
    'Aturan penting:',
    '- Jika user menanyakan harga atau BEP brand tertentu, jawab berdasarkan katalog ini.',
    '- Jika brand tidak ditemukan, katakan data belum tersedia lalu tawarkan alternatif sesuai budget user.',
    '- Jangan mengarang harga di luar katalog.',
  ].join('\n');
}

export async function getMerchantPricingPromptSection(): Promise<string> {
  const now = Date.now();
  if (
    merchantPricingCache &&
    now - merchantPricingCache.loadedAt < MERCHANT_PRICING_CACHE_TTL_MS
  ) {
    return merchantPricingCache.context;
  }

  const runtimeValues = await getRuntimeEnvValues(['MERCHANT_PRICING_SHEET_URL']);
  const csvUrl = resolveCsvUrl(runtimeValues.MERCHANT_PRICING_SHEET_URL);

  try {
    const response = await axios.get<string>(csvUrl, {
      timeout: 15_000,
      responseType: 'text',
    });

    const rows = parseCsvRows(String(response.data || ''));
    const items = mapRowsToMerchantItems(rows);
    const context = buildMerchantPricingContext(csvUrl, items);

    merchantPricingCache = {
      loadedAt: now,
      context,
    };

    return context;
  } catch (error) {
    console.error('[MerchantPricing] Failed to load merchant pricing CSV:', error);

    if (merchantPricingCache?.context) {
      return merchantPricingCache.context;
    }

    merchantPricingCache = {
      loadedAt: now,
      context: '',
    };

    return '';
  }
}
