import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { LeadData } from './openai';

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

function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '');
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
    normalizedHeader === 'phone' ||
    normalizedHeader === 'phone number' ||
    normalizedHeader === 'phone_number' ||
    normalizedHeader === 'whatsapp'
  ) {
    return normalizePhoneNumber(phoneNumber);
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

const GOOGLE_SHEET_SOURCE =
  process.env.GOOGLE_SHEET_ID?.trim() || DEFAULT_GOOGLE_SHEET_SOURCE;
const GOOGLE_SHEET_ID = extractSpreadsheetId(GOOGLE_SHEET_SOURCE);
const GOOGLE_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME?.trim() || DEFAULT_GOOGLE_SHEET_NAME;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY?.trim() || '';

let cachedDoc: GoogleSpreadsheet | null = null;

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
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

function hasUsableServiceAccountCredentials(): boolean {
  const email = stripWrappingQuotes(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || ''
  );
  const rawPrivateKey = stripWrappingQuotes(
    process.env.GOOGLE_PRIVATE_KEY?.trim() || ''
  );
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

  if (!email || !privateKey) {
    return false;
  }

  if (email.includes('your-service-account@') || privateKey.includes('...')) {
    return false;
  }

  return privateKey.includes('BEGIN PRIVATE KEY');
}

function getGoogleCredentials(): { email: string; privateKey: string } {
  const email = stripWrappingQuotes(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || ''
  );
  const rawPrivateKey = stripWrappingQuotes(
    process.env.GOOGLE_PRIVATE_KEY?.trim() || ''
  );
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

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

function getSpreadsheetClient(): GoogleSpreadsheet {
  if (cachedDoc) {
    return cachedDoc;
  }

  const { email, privateKey } = getGoogleCredentials();

  const serviceAccountAuth = new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  cachedDoc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  return cachedDoc;
}

export async function appendLeadToSheet(
  lead: LeadData,
  phoneNumber = ''
): Promise<boolean> {
  try {
    if (GOOGLE_API_KEY) {
      console.warn(
        'GOOGLE_API_KEY is configured, but Google Sheets append requires OAuth/service account credentials. API key is ignored for write operations.'
      );
    }

    if (!hasUsableServiceAccountCredentials()) {
      console.error(
        'No usable Google Sheets write credentials. Set valid GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local. GOOGLE_API_KEY alone cannot append rows.'
      );
      return false;
    }

    const doc = getSpreadsheetClient();
    await doc.loadInfo();
    const sheet = GOOGLE_SHEET_NAME
      ? doc.sheetsByTitle[GOOGLE_SHEET_NAME]
      : doc.sheetsByIndex[0];

    if (!sheet) {
      throw new Error(
        `Google Sheet tab not found: ${GOOGLE_SHEET_NAME || '(first sheet)'}`
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
    return true;
  } catch (error) {
    console.error('Error appending lead to Google Sheets:', error);
    return false;
  }
}
