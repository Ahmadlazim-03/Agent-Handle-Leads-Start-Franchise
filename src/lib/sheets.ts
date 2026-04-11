import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { LeadData } from './openai';
import { getRuntimeEnvValues } from './runtime-env';
import { appendDashboardLog } from './dashboard-logs';

const DEFAULT_GOOGLE_SHEET_SOURCE =
  'https://docs.google.com/spreadsheets/d/1kn23ILLqav6yn-FOSqsHxPIJNAeWKth-Jhk_jsJu6b0/edit?gid=2093370014#gid=2093370014';
const DEFAULT_GOOGLE_SHEET_NAME = 'Informasi Client';

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

function normalizeLeadIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return '';
  }

  if (/@lid$/i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(/\D/g, '');
}

function pickValueForHeader(
  header: string,
  lead: LeadData,
  phoneNumber: string,
  timestamp: string
): string | null {
  const normalizedHeader = header.trim().toLowerCase();

  if (
    normalizedHeader === 'nomor' ||
    normalizedHeader === 'nomor wa' ||
    normalizedHeader === 'no wa' ||
    normalizedHeader === 'no_wa' ||
    normalizedHeader === 'lead id' ||
    normalizedHeader === 'lead_id' ||
    normalizedHeader === 'lid' ||
    normalizedHeader === 'phone' ||
    normalizedHeader === 'phone number' ||
    normalizedHeader === 'phone_number' ||
    normalizedHeader === 'whatsapp'
  ) {
    return normalizeLeadIdentifier(phoneNumber);
  }

  if (
    normalizedHeader === 'sumber info' ||
    normalizedHeader === 'sumber_info' ||
    normalizedHeader === 'sumber'
  ) {
    return lead.sumberInfo;
  }

  if (
    normalizedHeader === 'nama & kota' ||
    normalizedHeader === 'nama dan kota' ||
    normalizedHeader === 'nama kota' ||
    normalizedHeader === 'nama_kota' ||
    normalizedHeader === 'biodata'
  ) {
    return lead.biodata;
  }

  if (
    normalizedHeader === 'bidang usaha' ||
    normalizedHeader === 'bidang_usaha' ||
    normalizedHeader === 'usaha'
  ) {
    return lead.bidangUsaha;
  }

  if (normalizedHeader === 'budget' || normalizedHeader === 'anggaran') {
    return lead.budget;
  }

  if (
    normalizedHeader === 'rencana mulai' ||
    normalizedHeader === 'rencana_mulai' ||
    normalizedHeader === 'timeline'
  ) {
    return lead.rencanaMulai;
  }

  if (
    normalizedHeader === 'timestamp' ||
    normalizedHeader === 'waktu' ||
    normalizedHeader === 'created_at'
  ) {
    return timestamp;
  }

  return null;
}

type SheetsRuntimeConfig = {
  sheetId: string;
  sheetName: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
};

let cachedDocEntry: {
  cacheKey: string;
  doc: GoogleSpreadsheet;
} | null = null;

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeGooglePrivateKey(value: string): string {
  return stripWrappingQuotes(value.trim())
    .replace(/\\r\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function getJakartaTimestamp(): string {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
  });
}

function buildLeadRowForHeaders(
  headers: string[],
  lead: LeadData,
  phoneNumber: string,
  timestamp: string
): {
  rowObject: Record<string, string>;
  rowValues: string[];
  hasData: boolean;
} {
  const rowObject: Record<string, string> = {};
  const rowValues: string[] = [];
  let hasData = false;

  for (const header of headers) {
    const value = pickValueForHeader(header, lead, phoneNumber, timestamp);
    rowValues.push(value ?? '');

    if (value !== null && value !== '') {
      rowObject[header] = value;
      hasData = true;
    }
  }

  return { rowObject, rowValues, hasData };
}

async function getSheetsRuntimeConfig(): Promise<SheetsRuntimeConfig> {
  const runtimeValues = await getRuntimeEnvValues([
    'GOOGLE_SHEET_ID',
    'GOOGLE_SHEET_NAME',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
  ]);

  const sheetSource =
    runtimeValues.GOOGLE_SHEET_ID.trim() || DEFAULT_GOOGLE_SHEET_SOURCE;
  const sheetId = extractSpreadsheetId(sheetSource);
  const sheetName = runtimeValues.GOOGLE_SHEET_NAME.trim() || DEFAULT_GOOGLE_SHEET_NAME;
  const googleServiceAccountEmail = stripWrappingQuotes(
    runtimeValues.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()
  );
  const googlePrivateKey = normalizeGooglePrivateKey(
    runtimeValues.GOOGLE_PRIVATE_KEY
  );

  return {
    sheetId,
    sheetName,
    googleServiceAccountEmail,
    googlePrivateKey,
  };
}

function hasUsableServiceAccountCredentials(config: SheetsRuntimeConfig): boolean {
  const email = config.googleServiceAccountEmail;
  const privateKey = config.googlePrivateKey;

  if (!email || !privateKey) {
    return false;
  }

  if (email.includes('your-service-account@') || privateKey.includes('...')) {
    return false;
  }

  return privateKey.includes('BEGIN PRIVATE KEY');
}

function getGoogleCredentials(config: SheetsRuntimeConfig): {
  email: string;
  privateKey: string;
} {
  const email = config.googleServiceAccountEmail;
  const privateKey = config.googlePrivateKey;

  if (!email || !privateKey) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in environment variables.'
    );
  }

  const hasPlaceholderEmail = email.includes('your-service-account@');
  const hasPlaceholderKey = privateKey.includes('...');

  if (hasPlaceholderEmail || hasPlaceholderKey) {
    throw new Error(
      'Google Sheets credentials still use placeholder values. Please set real service account email and private key in .env.local.'
    );
  }

  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error(
      'GOOGLE_PRIVATE_KEY must be a PEM private key starting with -----BEGIN PRIVATE KEY-----.'
    );
  }

  return { email, privateKey };
}

function getSpreadsheetClient(config: SheetsRuntimeConfig): GoogleSpreadsheet {
  const cacheKey = `${config.sheetId}::${config.googleServiceAccountEmail}::${config.sheetName}`;

  if (cachedDocEntry && cachedDocEntry.cacheKey === cacheKey) {
    return cachedDocEntry.doc;
  }

  const { email, privateKey } = getGoogleCredentials(config);

  const serviceAccountAuth = new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(config.sheetId, serviceAccountAuth);
  cachedDocEntry = {
    cacheKey,
    doc,
  };
  return doc;
}

export async function appendLeadToSheet(
  lead: LeadData,
  phoneNumber = ''
): Promise<boolean> {
  try {
    const config = await getSheetsRuntimeConfig();

    if (!hasUsableServiceAccountCredentials(config)) {
      console.error(
        'No usable Google Sheets write credentials. Set valid GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in runtime config/dashboard or .env.local.'
      );
      void appendDashboardLog({
        level: 'warn',
        source: 'spreadsheet',
        message: 'Spreadsheet credentials belum valid untuk penulisan lead.',
      });
      return false;
    }

    const doc = getSpreadsheetClient(config);
    await doc.loadInfo();
    const sheet = config.sheetName
      ? doc.sheetsByTitle[config.sheetName]
      : doc.sheetsByIndex[0];

    if (!sheet) {
      throw new Error(
        `Google Sheet tab not found: ${config.sheetName || '(first sheet)'}`
      );
    }

    await sheet.loadHeaderRow();

    const timestamp = getJakartaTimestamp();
    const { rowObject, hasData } = buildLeadRowForHeaders(
      sheet.headerValues,
      lead,
      phoneNumber,
      timestamp
    );

    if (!hasData) {
      throw new Error('No matching headers were found in the target sheet.');
    }

    await sheet.addRow(rowObject);

    console.log(`Lead appended to Google Sheets: ${lead.biodata}`);
    void appendDashboardLog({
      level: 'info',
      source: 'spreadsheet',
      message: 'Lead berhasil ditulis ke Google Sheets.',
      details: {
        sheetName: config.sheetName,
        phoneNumber: normalizeLeadIdentifier(phoneNumber),
        biodata: lead.biodata,
      },
    });
    return true;
  } catch (error) {
    console.error('Error appending lead to Google Sheets:', error);
    void appendDashboardLog({
      level: 'error',
      source: 'spreadsheet',
      message: 'Gagal menulis lead ke Google Sheets.',
      details: error,
    });
    return false;
  }
}
