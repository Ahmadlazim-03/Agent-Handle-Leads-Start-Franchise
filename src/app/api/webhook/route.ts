import { NextRequest, NextResponse } from 'next/server';
import { createOpenAIClient, getOpenAIModel } from '@/lib/openai';
import {
  sendWhatsAppMessage,
  isKnownLeadByAliases,
  isNewLead,
  applyLeadCompletionLabel,
} from '@/lib/waha';
import { appendLeadToSheet } from '@/lib/sheets';
import {
  sendTelegramNotification,
  sendTelegramDealMeetingNotification,
} from '@/lib/telegram';
import {
  saveIncomingLeadNumber,
  saveKnownLeadNumber,
  saveProcessingLeadNumber,
  removeProcessingLeadNumber,
} from '@/lib/lead-numbers';
import {
  parseLeadFromMessage,
  stripLeadPayload,
} from '@/prompts/agent';
import { DEFAULT_RUNTIME_SYSTEM_PROMPT } from '@/prompts/runtime-system';
import {
  getConversationState,
  createConversationState,
  addMessageToState,
  updateConversationState,
  markConversationComplete,
  resetConversationByPhoneNumber,
} from '@/lib/store';
import {
  listAvailableProposalBrands,
  resolveBrandProposalRequest,
} from '@/lib/proposals';
import { getRuntimeSystemPrompt } from '@/lib/prompt-config';

export const runtime = 'nodejs';

const AI_RESPONSE_DELAY_MS = 2000;
const DUPLICATE_MESSAGE_TTL_MS = 10 * 60 * 1000;
const MAX_MODEL_CONTEXT_MESSAGES = 8;
const MAX_PRIMARY_RESPONSE_SENTENCES = 3;
const processedMessageIds = new Map<string, number>();
const activeChatRequests = new Set<string>();

type LeadField =
  | 'sumberInfo'
  | 'biodata'
  | 'bidangUsaha'
  | 'budget'
  | 'rencanaMulai';

type JsonRecord = Record<string, unknown>;

const LEAD_FIELDS: LeadField[] = [
  'sumberInfo',
  'biodata',
  'bidangUsaha',
  'budget',
  'rencanaMulai',
];

const BUDGET_AMBIGUOUS_TERMS = [
  'belum tahu',
  'belum tau',
  'masih lihat',
  'masih liat',
  'fleksibel',
  'saran aja',
  'tergantung',
  'nanti dulu',
];

const REQUIRED_MEETING_INVITE =
  'Kakak, boleh lanjut meeting singkat 5-10 menit dengan Business Manager StartFranchise.id?';
const REQUIRED_TIME_SLOT_QUESTION =
  'Kakak lebih nyaman jam 10.00 atau 14.00?';
const DEFAULT_URGENCY_MESSAGE =
  'Promo diskon 10% masih aktif dan kuota di kota Kakak terbatas.';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function extractPayload(body: unknown): JsonRecord | null {
  const bodyRecord = asRecord(body);
  if (!bodyRecord) {
    return null;
  }

  const nestedPayload = asRecord(bodyRecord.payload);
  return nestedPayload ?? bodyRecord;
}

function normalizeChatId(chatId: string): string {
  return chatId
    .replace(/@c\.us$/i, '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .trim();
}

function resolveLeadIdentifier(
  rawChatIdentifier: string | null,
  normalizedChatId: string
): string {
  const raw = rawChatIdentifier?.trim() || '';
  if (raw && /@lid$/i.test(raw)) {
    return raw;
  }

  if (/@lid$/i.test(normalizedChatId)) {
    return normalizedChatId;
  }

  const digitsFromRaw = raw.replace(/\D/g, '');
  if (digitsFromRaw) {
    return `${digitsFromRaw}@lid`;
  }

  const digitsFromNormalized = normalizedChatId.replace(/\D/g, '');
  if (digitsFromNormalized) {
    return `${digitsFromNormalized}@lid`;
  }

  return normalizedChatId;
}

function extractChatIdentifier(payload: JsonRecord): string | null {
  const directKey = asRecord(payload.key);

  const directIdentifier =
    typeof payload.chatId === 'string'
      ? payload.chatId
      : typeof payload.from === 'string'
        ? payload.from
        : typeof payload.to === 'string'
          ? payload.to
          : typeof directKey?.remoteJid === 'string'
            ? directKey.remoteJid
          : null;

  if (directIdentifier && directIdentifier.trim().length > 0) {
    return directIdentifier.trim();
  }

  const nestedMessage = asRecord(payload.message);
  if (!nestedMessage) {
    return null;
  }

  const nestedIdentifier =
    typeof nestedMessage.chatId === 'string'
      ? nestedMessage.chatId
      : typeof nestedMessage.from === 'string'
        ? nestedMessage.from
        : typeof asRecord(nestedMessage.key)?.remoteJid === 'string'
          ? (asRecord(nestedMessage.key)?.remoteJid as string)
        : null;

  if (!nestedIdentifier || nestedIdentifier.trim().length === 0) {
    return null;
  }

  return nestedIdentifier.trim();
}

function collectIdentifierCandidates(payload: JsonRecord): string[] {
  const identifiers = new Set<string>();

  const appendIdentifier = (value: unknown): void => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    identifiers.add(trimmed);
  };

  appendIdentifier(payload.chatId);
  appendIdentifier(payload.from);
  appendIdentifier(payload.to);
  appendIdentifier(payload.author);
  appendIdentifier(payload.participant);

  const directKey = asRecord(payload.key);
  appendIdentifier(directKey?.remoteJid);
  appendIdentifier(directKey?.participant);

  const nestedMessage = asRecord(payload.message);
  if (nestedMessage) {
    appendIdentifier(nestedMessage.chatId);
    appendIdentifier(nestedMessage.from);
    appendIdentifier(nestedMessage.to);
    appendIdentifier(nestedMessage.author);
    appendIdentifier(nestedMessage.participant);

    const nestedKey = asRecord(nestedMessage.key);
    appendIdentifier(nestedKey?.remoteJid);
    appendIdentifier(nestedKey?.participant);
  }

  return [...identifiers];
}

function isGroupOrBroadcastIdentifier(identifier: string): boolean {
  const normalized = identifier.trim().toLowerCase();

  return (
    normalized.endsWith('@g.us') ||
    normalized.includes('@broadcast') ||
    normalized.includes('status@broadcast')
  );
}

function isGroupOrBroadcastPayload(payload: JsonRecord): boolean {
  const nestedMessage = asRecord(payload.message);
  const nestedChat = asRecord(payload.chat);

  const hasGroupFlag =
    extractBoolean(payload.isGroup) ||
    extractBoolean(nestedMessage?.isGroup) ||
    extractBoolean(nestedChat?.isGroup);

  const hasBroadcastFlag =
    extractBoolean(payload.broadcast) ||
    extractBoolean(payload.isBroadcast) ||
    extractBoolean(nestedMessage?.broadcast) ||
    extractBoolean(nestedMessage?.isBroadcast);

  if (hasGroupFlag || hasBroadcastFlag) {
    return true;
  }

  const chatIdentifier = extractChatIdentifier(payload);
  if (!chatIdentifier) {
    return false;
  }

  return isGroupOrBroadcastIdentifier(chatIdentifier);
}

export async function POST(request: NextRequest) {
  let messageId: string | null = null;
  let dedupeKey: string | null = null;
  let dedupeMarked = false;
  let lockedChatId: string | null = null;

  try {
    const body = (await request.json()) as unknown;
    const payload = extractPayload(body);

    if (!payload) {
      console.log('Invalid payload shape, ignoring...');
      return NextResponse.json({ status: 'ignored_invalid_payload' });
    }

    const chatIdentifier = extractChatIdentifier(payload);
    const identifierCandidates = collectIdentifierCandidates(payload);
    if (isGroupOrBroadcastPayload(payload)) {
      console.log(
        `Ignoring group/broadcast message source=${chatIdentifier || 'unknown'}`
      );
      return NextResponse.json({ status: 'ignored_group_or_broadcast' });
    }

    const chatId = extractChatId(payload);
    if (isFromMe(payload)) {
      if (chatId && !isGroupOrBroadcastIdentifier(chatId)) {
        const incomingSeeded = await saveIncomingLeadNumber(chatId);
        const knownSeeded = await saveKnownLeadNumber(chatId);
        const processingCleared = await removeProcessingLeadNumber(chatId);

        if (!incomingSeeded || !knownSeeded) {
          console.warn(
            `[Gatekeeper] Outbound seed failed for ${chatId}: incomingSeeded=${incomingSeeded}, knownSeeded=${knownSeeded}`
          );
        } else {
          console.log(
            `[Gatekeeper] Outbound message detected for ${chatId}, Redis seed completed (known + incoming).`
          );
        }

        if (!processingCleared) {
          console.warn(
            `[Gatekeeper] Failed to clear processing set for outbound chatId=${chatId}.`
          );
        }
      }

      return NextResponse.json({ status: 'ignored_from_me' });
    }

    const messageText = extractMessageText(payload);

    if (chatId && isGroupOrBroadcastIdentifier(chatId)) {
      console.log(`Ignoring group/broadcast chatId=${chatId}`);
      return NextResponse.json({ status: 'ignored_group_or_broadcast' });
    }

    if (!chatId || !messageText) {
      console.log(
        `Ignoring non-text webhook event source=${chatIdentifier || 'unknown'}`
      );
      return NextResponse.json({ status: 'ignored_non_text_event' });
    }

    if (activeChatRequests.has(chatId)) {
      console.log(
        `[RaceGuard] Concurrent webhook ignored for busy chatId=${chatId}`
      );
      return NextResponse.json({ status: 'ignored_chat_busy' });
    }

    activeChatRequests.add(chatId);
    lockedChatId = chatId;

    const incomingSavedToRedis = await saveIncomingLeadNumber(chatId);
    if (!incomingSavedToRedis) {
      console.warn(
        `[Redis] Incoming number for ${chatId} was not persisted (Redis unavailable or write failed).`
      );
    }

    messageId = extractMessageId(payload);
    dedupeKey = messageId ?? buildSyntheticMessageId(payload, chatId, messageText);

    if (!shouldProcessMessage(dedupeKey)) {
      console.log(
        `Duplicate webhook ignored for key=${dedupeKey || 'unknown'}`
      );
      return NextResponse.json({ status: 'ignored_duplicate' });
    }
    dedupeMarked = dedupeKey !== null;

    const leadIdentifier = resolveLeadIdentifier(chatIdentifier, chatId);
    const runtimeSystemPrompt = await getRuntimeSystemPrompt();
    const isComplete = await handleConversation(
      chatId,
      messageText,
      leadIdentifier,
      identifierCandidates,
      runtimeSystemPrompt
    );

    return NextResponse.json({ status: isComplete ? 'complete' : 'processed' });
  } catch (error) {
    if (dedupeMarked && dedupeKey) {
      processedMessageIds.delete(dedupeKey);
    }

    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    if (lockedChatId) {
      activeChatRequests.delete(lockedChatId);
    }
  }
}

function extractChatId(payload: JsonRecord): string | null {
  const rawChatId = extractChatIdentifier(payload);

  if (!rawChatId) {
    return null;
  }

  const normalized = normalizeChatId(rawChatId);
  if (!normalized) {
    return null;
  }

  return normalized;
}

function extractTextValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractMessageText(payload: JsonRecord): string | null {
  const directText = extractTextValue(payload.body) ?? extractTextValue(payload.text);
  if (directText) {
    return directText;
  }

  const nestedMessage = asRecord(payload.message);
  if (nestedMessage) {
    const nestedDirect =
      extractTextValue(nestedMessage.text) ??
      extractTextValue(nestedMessage.conversation);

    if (nestedDirect) {
      return nestedDirect;
    }

    const extendedText = asRecord(nestedMessage.extendedTextMessage);
    const imageMessage = asRecord(nestedMessage.imageMessage);
    const videoMessage = asRecord(nestedMessage.videoMessage);
    const documentMessage = asRecord(nestedMessage.documentMessage);
    const buttonsResponse = asRecord(nestedMessage.buttonsResponseMessage);
    const templateButtonReply = asRecord(
      nestedMessage.templateButtonReplyMessage
    );
    const listResponse = asRecord(nestedMessage.listResponseMessage);
    const singleSelectReply = asRecord(listResponse?.singleSelectReply);

    return (
      extractTextValue(extendedText?.text) ||
      extractTextValue(imageMessage?.caption) ||
      extractTextValue(videoMessage?.caption) ||
      extractTextValue(documentMessage?.caption) ||
      extractTextValue(buttonsResponse?.selectedDisplayText) ||
      extractTextValue(buttonsResponse?.selectedButtonId) ||
      extractTextValue(templateButtonReply?.selectedDisplayText) ||
      extractTextValue(templateButtonReply?.selectedId) ||
      extractTextValue(listResponse?.title) ||
      extractTextValue(singleSelectReply?.selectedRowId)
    );
  }

  return null;
}

function extractBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return false;
}

function isFromMe(payload: JsonRecord): boolean {
  const directKey = asRecord(payload.key);
  const nestedMessage = asRecord(payload.message);
  const nestedKey = asRecord(nestedMessage?.key);

  return (
    extractBoolean(payload.fromMe) ||
    extractBoolean(directKey?.fromMe) ||
    extractBoolean(nestedKey?.fromMe)
  );
}

function extractMessageId(payload: JsonRecord): string | null {
  const directKey = asRecord(payload.key);

  const directId =
    typeof payload.id === 'string'
      ? payload.id
      : typeof payload.messageId === 'string'
        ? payload.messageId
        : typeof directKey?.id === 'string'
          ? directKey.id
        : null;

  if (directId && directId.trim().length > 0) {
    return directId.trim();
  }

  const nestedMessage = asRecord(payload.message);
  if (!nestedMessage) {
    return null;
  }

  if (typeof nestedMessage.id === 'string') {
    const nestedId = nestedMessage.id.trim();
    return nestedId.length > 0 ? nestedId : null;
  }

  const nestedKey = asRecord(nestedMessage.key);
  if (!nestedKey || typeof nestedKey.id !== 'string') {
    return null;
  }

  const nestedId = nestedKey.id.trim();
  return nestedId.length > 0 ? nestedId : null;
}

function extractMessageTimestamp(payload: JsonRecord): number | null {
  const nestedMessage = asRecord(payload.message);
  const nestedKey = asRecord(payload.key);

  const candidates: unknown[] = [
    payload.timestamp,
    payload.messageTimestamp,
    nestedMessage?.timestamp,
    nestedMessage?.messageTimestamp,
    nestedKey?.timestamp,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.trunc(candidate);
    }

    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
  }

  return null;
}

function buildSyntheticMessageId(
  payload: JsonRecord,
  chatId: string,
  messageText: string
): string | null {
  const normalizedText = normalizeWhitespace(messageText)
    .toLowerCase()
    .slice(0, 180);

  if (!normalizedText) {
    return null;
  }

  const extractedTimestamp = extractMessageTimestamp(payload);
  const keyTimestamp = extractedTimestamp ?? Math.floor(Date.now() / 3000);

  return `synthetic:${chatId}:${keyTimestamp}:${normalizedText}`;
}

function cleanupProcessedMessages(): void {
  const now = Date.now();

  for (const [messageId, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > DUPLICATE_MESSAGE_TTL_MS) {
      processedMessageIds.delete(messageId);
    }
  }
}

function shouldProcessMessage(messageId: string | null): boolean {
  cleanupProcessedMessages();

  if (!messageId) {
    return true;
  }

  if (processedMessageIds.has(messageId)) {
    return false;
  }

  processedMessageIds.set(messageId, Date.now());
  return true;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function summarizeFieldValue(value?: string): string {
  if (!value || value.trim().length === 0) {
    return '-';
  }

  return normalizeWhitespace(value);
}

function buildRuntimeSystemMessage(
  runtimeSystemPrompt: string,
  collectedData: Record<string, string>
): string {
  const snapshot = [
    `sumberInfo=${summarizeFieldValue(collectedData.sumberInfo)}`,
    `biodata=${summarizeFieldValue(collectedData.biodata)}`,
    `bidangUsaha=${summarizeFieldValue(collectedData.bidangUsaha)}`,
    `budget=${summarizeFieldValue(collectedData.budget)}`,
    `rencanaMulai=${summarizeFieldValue(collectedData.rencanaMulai)}`,
  ].join('; ');

  const missingFields = getMissingLeadFields(collectedData);
  const missingSummary = missingFields.length > 0 ? missingFields.join(', ') : 'tidak ada';

  const basePrompt = runtimeSystemPrompt.trim() || DEFAULT_RUNTIME_SYSTEM_PROMPT;
  return `${basePrompt}\nDATA SAAT INI: ${snapshot}\nFIELD BELUM LENGKAP: ${missingSummary}.`;
}

function normalizeBudgetText(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\bjt\b/gi, 'juta')
    .replace(/\bm\b/gi, 'miliar');
}

function extractLabeledFieldValue(text: string, labelPattern: string): string {
  const pattern = new RegExp(
    `${labelPattern}\\s*:\\s*([\\s\\S]*?)(?=\\b(?:sumber\\s*info|sumber|biodata|bidang\\s*usaha|budget|anggaran|rencana\\s*mulai|timeline)\\b\\s*:|$)`,
    'i'
  );

  const match = text.match(pattern);
  if (!match?.[1]) {
    return '';
  }

  return match[1]
    .replace(/^[-:|;,\s]+/, '')
    .replace(/[-:|;,\s]+$/, '')
    .trim();
}

function extractSourceInfo(text: string): string {
  const sourceMatch = text.match(
    /(?:dari|via|lewat|tau dari|tahu dari|taunya dari)\s+(google|instagram|ig|tiktok|facebook|fb|youtube|website|web|referral(?: teman)?|teman|iklan)/i
  );

  if (!sourceMatch) {
    return '';
  }

  const source = sourceMatch[1].trim().toLowerCase();
  const sourceMap: Record<string, string> = {
    ig: 'Instagram',
    fb: 'Facebook',
    web: 'Website',
    'referral teman': 'Referral Teman',
  };

  const mapped = sourceMap[source];
  if (mapped) {
    return mapped;
  }

  return source.charAt(0).toUpperCase() + source.slice(1);
}

function extractBiodata(text: string): string {
  const patterns = [
    /(?:nama\s+saya|saya|aku|perkenalkan\s+saya)\s+([A-Za-z][A-Za-z' .-]{1,40}?)\s+dari\s+([A-Za-z][A-Za-z' .-]{1,40})/i,
    /(?:nama\s+saya|saya|aku|perkenalkan\s+saya)\s+([A-Za-z][A-Za-z' .-]{1,40}?)[,\s]+(?:asal|domisili)\s+([A-Za-z][A-Za-z' .-]{1,40})/i,
    /([A-Za-z][A-Za-z' .-]{1,40})\s+(?:dari|asal)\s+([A-Za-z][A-Za-z' .-]{1,40})/i,
  ];

  const match = patterns
    .map((pattern) => text.match(pattern))
    .find((result) => Boolean(result));

  if (!match) {
    return '';
  }

  const name = normalizeWhitespace(match[1]);
  const city = normalizeWhitespace(match[2]);

  if (!name || !city) {
    return '';
  }

  return `${name} - ${city}`;
}

function extractBusinessField(text: string): string {
  const match = text.match(
    /(?:usaha|bisnis)(?:\s+saya|\s+yang\s+saya\s+jalankan|\s+yang\s+mau\s+saya\s+jalankan|\s+yang\s+ingin\s+saya\s+buka)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9&/.,'\- ]{2,80})/i
  );

  if (!match) {
    return '';
  }

  return normalizeWhitespace(match[1]).replace(/[.!?]+$/, '');
}

function extractBudget(text: string): string {
  const lower = text.toLowerCase();
  const hasAmbiguousBudgetTerm = BUDGET_AMBIGUOUS_TERMS.some((term) =>
    lower.includes(term)
  );

  if (hasAmbiguousBudgetTerm) {
    return '';
  }

  const numericBudgetMatch = text.match(
    /(?:rp\.?\s*)?\d{1,3}(?:[.,]\d{3})*(?:\s*(?:juta|jt|miliar|m|ribu|rb))?(?:\s*(?:-|sampai|hingga|sd)\s*(?:rp\.?\s*)?\d{1,3}(?:[.,]\d{3})*(?:\s*(?:juta|jt|miliar|m|ribu|rb))?)?/i
  );
  if (numericBudgetMatch) {
    return normalizeBudgetText(numericBudgetMatch[0]);
  }

  const rangeBudgetMatch = text.match(/(?:<|>|<=|>=)?\s*\d+\s*(?:juta|jt|miliar|m)/i);
  if (rangeBudgetMatch) {
    return normalizeBudgetText(rangeBudgetMatch[0]);
  }

  return '';
}

function extractStartPlan(text: string): string {
  const lower = text.toLowerCase();
  const directPlanMatch = lower.match(
    /(bulan depan|minggu depan|tahun depan|tahun ini|bulan ini|akhir bulan ini|awal bulan depan|secepatnya|segera|q[1-4]|kuartal\s*[1-4])/i
  );
  if (directPlanMatch) {
    return normalizeWhitespace(directPlanMatch[0]);
  }

  const monthPlanMatch = lower.match(
    /(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*\d{0,4}/i
  );
  if (monthPlanMatch) {
    return normalizeWhitespace(monthPlanMatch[0]);
  }

  return '';
}

function inferLeadDataFromUserMessage(
  messageText: string
): Partial<Record<LeadField, string>> {
  const normalizedMessage = normalizeWhitespace(messageText);
  const labeledSource = extractLabeledFieldValue(
    normalizedMessage,
    'sumber\\s*info|sumber'
  );
  const labeledBiodata = extractLabeledFieldValue(
    normalizedMessage,
    'biodata|nama\\s*&\\s*kota|nama\\s+dan\\s+kota'
  );
  const labeledBusinessField = extractLabeledFieldValue(
    normalizedMessage,
    'bidang\\s*usaha|usaha'
  );
  const labeledBudget = extractLabeledFieldValue(
    normalizedMessage,
    'budget|anggaran'
  );
  const labeledStartPlan = extractLabeledFieldValue(
    normalizedMessage,
    'rencana\\s*mulai|timeline'
  );

  return {
    sumberInfo: labeledSource || extractSourceInfo(normalizedMessage),
    biodata: labeledBiodata || extractBiodata(normalizedMessage),
    bidangUsaha:
      (labeledBusinessField &&
        normalizeWhitespace(labeledBusinessField).replace(/[.!?]+$/, '')) ||
      extractBusinessField(normalizedMessage),
    budget:
      (labeledBudget && normalizeBudgetText(labeledBudget)) ||
      extractBudget(normalizedMessage),
    rencanaMulai:
      (labeledStartPlan && normalizeWhitespace(labeledStartPlan)) ||
      extractStartPlan(normalizedMessage),
  };
}

function mergeCollectedData(
  current: Record<string, string>,
  incoming: Partial<Record<LeadField, string>>
): Record<string, string> {
  for (const [field, value] of Object.entries(incoming)) {
    if (!value) {
      continue;
    }

    const existing = current[field];
    if (!existing || existing.trim().length === 0) {
      current[field] = value;
    }
  }

  return current;
}

function getMissingLeadFields(collectedData: Record<string, string>): LeadField[] {
  return LEAD_FIELDS.filter((field) => {
    const value = collectedData[field];
    return !value || value.trim().length === 0;
  });
}

function asksForBudget(content: string): boolean {
  return /\b(budget|anggaran|kisaran|estimasi)\b/i.test(content);
}

function asksForStartPlan(content: string): boolean {
  return /\b(rencana\s+mulai|mulai\s+kapan|kapan\s+mulai|timeline|target\s+mulai|rencana\s+start)\b/i.test(
    content
  );
}

function stripRolePrefixes(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/^\s*(Bot|User|Assistant)\s*:\s*/i, '').trimEnd())
    .join('\n')
    .trim();
}

function hasUrgencyMessage(content: string): boolean {
  return /diskon\s*10%|grand\s*opening|kuota\s+franchise|stok\s+franchise|tinggal\s+sedikit/i.test(
    content
  );
}

function hasMeetingInvite(content: string): boolean {
  return /meeting|business\s+manager|startfranchise\.id/i.test(
    content
  );
}

function hasTimeSlotQuestion(content: string): boolean {
  return /jam\s*10|10\.?00|jam\s*2|14\.?00|available\s+jam\s+berapa|lebih\s+nyaman\s+jam/i.test(
    content
  );
}

function hasEmpathyMessage(content: string): boolean {
  return /paham|mengerti|wajar|tenang|senang\s+dengar|terima\s+kasih\s+sudah\s+sharing|apresiasi/i.test(
    content
  );
}

function buildEmpathyLine(userMessage: string): string {
  const normalized = normalizeWhitespace(userMessage.toLowerCase());

  if (/takut|khawatir|ragu|bingung|galau|mahal|risiko|resiko/i.test(normalized)) {
    return 'Saya paham kekhawatiran Kakak, itu sangat wajar.';
  }

  if (/tertarik|semangat|penasaran|mantap|bagus|suka|cocok/i.test(normalized)) {
    return 'Senang dengar antusias Kakak.';
  }

  if (/belum\s+tahu|masih\s+lihat|masih\s+bingung|masih\s+pertimbangkan/i.test(normalized)) {
    return 'Tidak apa-apa Kakak, kita bahas pelan-pelan supaya jelas.';
  }

  return '';
}

function hasHighIntentSignal(content: string): boolean {
  return /serius|lanjut|deal|investasi|modal|proposal|ketemu|meeting|jadwal|buka\s+franchise|franchise\s+apa/i.test(
    content
  );
}

function countCollectedLeadFields(collectedData: Record<string, string>): number {
  const missingCount = getMissingLeadFields(collectedData).length;
  return LEAD_FIELDS.length - missingCount;
}

function hasAssistantMentionedMeeting(messages: Array<{ role: string; content: string }>): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      (hasMeetingInvite(message.content) || hasTimeSlotQuestion(message.content))
  );
}

function hasAssistantMentionedUrgency(messages: Array<{ role: string; content: string }>): boolean {
  return messages.some(
    (message) => message.role === 'assistant' && hasUrgencyMessage(message.content)
  );
}

function hasDealSignal(content: string): boolean {
  return /\b(deal|setuju|sepakat|fix|oke\s*deal|ok\s*deal|siap\s*deal|jadi\s*deal|ambil\s*paket)\b/i.test(
    content
  );
}

function extractMeetingSchedule(content: string): string {
  const normalized = normalizeWhitespace(content.toLowerCase());
  const hasMeetingContext = /\b(meeting|ketemu|jadwal|call|zoom|gmeet|jam|pukul)\b/i.test(
    normalized
  );

  if (!hasMeetingContext) {
    return '';
  }

  const dateHintMatch = normalized.match(
    /\b(hari\s*ini|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/i
  );
  const dateHint = dateHintMatch ? dateHintMatch[1] : '';

  if (/\b(10\.?00|jam\s*10|10\s*pagi|pukul\s*10)\b/i.test(normalized)) {
    return `${dateHint ? `${dateHint} ` : ''}jam 10.00`.trim();
  }

  if (/\b(14\.?00|jam\s*14|jam\s*2|2\s*siang|pukul\s*14)\b/i.test(normalized)) {
    return `${dateHint ? `${dateHint} ` : ''}jam 14.00`.trim();
  }

  return dateHint || '';
}

function buildDealMeetingConfirmationMessage(meetingSchedule: string): string {
  const normalizedSchedule = meetingSchedule.trim();
  if (!normalizedSchedule) {
    return 'Siap Kakak, meeting dengan Business Manager kami sudah kami catat. Tim kami akan segera konfirmasi jadwalnya.';
  }

  return `Siap Kakak, meeting dengan Business Manager kami sudah kami catat untuk ${normalizedSchedule}. Tim kami akan segera konfirmasi.`;
}

function toLeadDataFromCollectedData(collectedData: Record<string, string>): {
  sumberInfo: string;
  biodata: string;
  bidangUsaha: string;
  budget: string;
  rencanaMulai: string;
} | null {
  if (getMissingLeadFields(collectedData).length > 0) {
    return null;
  }

  return {
    sumberInfo: normalizeWhitespace(collectedData.sumberInfo),
    biodata: normalizeWhitespace(collectedData.biodata),
    bidangUsaha: normalizeWhitespace(collectedData.bidangUsaha),
    budget: normalizeWhitespace(collectedData.budget),
    rencanaMulai: normalizeWhitespace(collectedData.rencanaMulai),
  };
}

function keepTwoShortSentences(content: string): string {
  const normalized = normalizeWhitespace(content);
  if (!normalized) {
    return '';
  }

  const chunks =
    normalized.match(/[^.!?]+[.!?]?/g)?.map((chunk) => chunk.trim()).filter(Boolean) ||
    [normalized];

  return chunks.slice(0, MAX_PRIMARY_RESPONSE_SENTENCES).join(' ');
}

function ensurePreferredAddress(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return 'Kakak';
  }

  if (/\bkakak\b/i.test(trimmed)) {
    return trimmed;
  }

  if (/\bkak\b/i.test(trimmed)) {
    return trimmed.replace(/\bkak\b/i, 'Kakak');
  }

  return `Kakak, ${trimmed}`;
}

function ensureEndsWithQuestion(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return REQUIRED_TIME_SLOT_QUESTION;
  }

  if (trimmed.endsWith('?')) {
    return trimmed;
  }

  return `${trimmed}?`;
}

function enforceFranchiseeReplyStyle(
  content: string,
  options: {
    includeUrgency: boolean;
    includeMeetingOffer: boolean;
    empathyLine?: string;
  }
): string {
  let next = keepTwoShortSentences(stripRolePrefixes(content));

  if (!next) {
    next = 'Terima kasih sudah menghubungi StartFranchise.id.';
  }

  next = ensurePreferredAddress(next);

  if (options.empathyLine && !hasEmpathyMessage(next)) {
    next = `${options.empathyLine} ${next}`;
  }

  if (options.includeUrgency && !hasUrgencyMessage(next)) {
    next = `${next} ${DEFAULT_URGENCY_MESSAGE}`;
  }

  if (options.includeMeetingOffer && !hasMeetingInvite(next)) {
    next = `${next} ${REQUIRED_MEETING_INVITE}`;
  }

  if (options.includeMeetingOffer && !hasTimeSlotQuestion(next)) {
    next = `${next} ${REQUIRED_TIME_SLOT_QUESTION}`;
  }

  return ensureEndsWithQuestion(normalizeWhitespace(next));
}

function ensureTwoFieldFollowUp(content: string, missingFields: LeadField[]): string {
  const hasBudgetGap = missingFields.includes('budget');
  const hasStartPlanGap = missingFields.includes('rencanaMulai');

  if (missingFields.length !== 2 || !hasBudgetGap || !hasStartPlanGap) {
    return content;
  }

  if (asksForBudget(content) && asksForStartPlan(content)) {
    return content;
  }

  const followUp =
    'Agar kami bantu cepat, info kisaran budget (<50 juta, 50-100 juta, atau >100 juta) dan rencana mulai usaha kapan, Kakak?';
  const separator = /[.!?]$/.test(content.trim()) ? '\n\n' : '.\n\n';

  console.log(
    '[Conversation] Enforcing combined follow-up for missing budget + rencanaMulai.'
  );

  return `${content.trim()}${separator}${followUp}`;
}

async function buildProposalClarificationMessage(): Promise<string> {
  const availableBrands = await listAvailableProposalBrands();

  if (availableBrands.length === 0) {
    return 'Kakak, katalog proposal brand belum terpasang. Boleh sebutkan brand yang Kakak cari supaya tim kami kirim manual?';
  }

  const visibleBrands = availableBrands.slice(0, 8);
  const brandsText = visibleBrands.join(', ');
  const hasMoreBrands = availableBrands.length > visibleBrands.length;

  if (hasMoreBrands) {
    return `Kakak sedang cari proposal brand apa? Saat ini yang tersedia: ${brandsText}, dan brand lainnya. Kakak pilih yang mana?`;
  }

  return `Kakak sedang cari proposal brand apa? Saat ini yang tersedia: ${brandsText}. Kakak pilih yang mana?`;
}

function buildProposalCaption(brandName: string, customCaption?: string): string {
  const normalizedCustomCaption = customCaption?.trim();

  if (normalizedCustomCaption) {
    return ensureEndsWithQuestion(
      ensurePreferredAddress(keepTwoShortSentences(stripRolePrefixes(normalizedCustomCaption)))
    );
  }

  return `Kakak, berikut link proposal ${brandName}. Kakak mau lanjut bahas paket yang paling cocok?`;
}

function buildProposalLinkMessage(
  brandName: string,
  fileUrl: string,
  customCaption?: string
): string {
  const caption = buildProposalCaption(brandName, customCaption);
  return `${caption}\n\nLink proposal ${brandName}: ${fileUrl}`;
}

async function tryHandleProposalIntent(
  chatId: string,
  messageText: string
): Promise<boolean> {
  const proposalLookup = await resolveBrandProposalRequest(messageText);
  if (!proposalLookup.isProposalIntent) {
    return false;
  }

  if (!proposalLookup.proposal) {
    const clarificationMessage = await buildProposalClarificationMessage();

    await delay(AI_RESPONSE_DELAY_MS);

    const clarificationSent = await sendWhatsAppMessage(chatId, clarificationMessage);
    if (!clarificationSent) {
      console.error(`Failed to send proposal clarification to ${chatId}`);
    }

    const assistantState = addMessageToState(
      chatId,
      'assistant',
      clarificationMessage
    );
    if (!assistantState) {
      console.warn(
        `[Conversation] Missing state for ${chatId} when saving proposal clarification`
      );
    }

    return true;
  }

  const proposal = proposalLookup.proposal;
  const proposalMessage = buildProposalLinkMessage(
    proposal.brandName,
    proposal.fileUrl,
    proposal.caption
  );

  await delay(AI_RESPONSE_DELAY_MS);

  const linkSent = await sendWhatsAppMessage(chatId, proposalMessage);
  if (!linkSent) {
    console.error(
      `Failed to send proposal link message for ${chatId} brand=${proposal.brandName}`
    );
  }

  const assistantState = addMessageToState(chatId, 'assistant', proposalMessage);
  if (!assistantState) {
    console.warn(`[Conversation] Missing state for ${chatId} when saving proposal reply`);
  }

  return true;
}

async function handleConversation(
  chatId: string,
  messageText: string,
  leadIdentifier: string,
  identifierCandidates: string[],
  runtimeSystemPrompt: string
): Promise<boolean> {
  if (isGroupOrBroadcastIdentifier(chatId)) {
    console.log(`Conversation ignored for non-personal chatId=${chatId}`);
    return false;
  }

  const matchedKnownAlias = await isKnownLeadByAliases(
    chatId,
    identifierCandidates
  );
  if (matchedKnownAlias) {
    resetConversationByPhoneNumber(chatId);
    const removedFromProcessing = await removeProcessingLeadNumber(chatId);
    if (!removedFromProcessing) {
      console.warn(`[Redis] Failed to unmark processing for known chatId=${chatId}.`);
    }

    console.log(`Chat ID ${chatId} is not a new lead, ignoring...`);
    return false;
  }

  let state = getConversationState(chatId);

  if (!state) {
    const isLeadNew = await isNewLead(chatId, identifierCandidates);
    if (!isLeadNew) {
      console.log(`Chat ID ${chatId} is not a new lead, ignoring...`);
      return false;
    }

    state = createConversationState(chatId);
  }

  if (state.isComplete) {
    const proposalHandled = await tryHandleProposalIntent(chatId, messageText);
    const removedFromProcessing = await removeProcessingLeadNumber(chatId);
    if (!removedFromProcessing) {
      console.warn(`[Redis] Failed to unmark processing for ${chatId} on complete state.`);
    }

    if (proposalHandled) {
      return false;
    }

    console.log(`Conversation for ${chatId} is already complete, ignoring...`);
    return true;
  }

  const markedAsProcessing = await saveProcessingLeadNumber(chatId);
  if (!markedAsProcessing) {
    console.warn(`[Redis] Failed to mark ${chatId} as processing.`);
  }

  const stateWithUserMessage = addMessageToState(chatId, 'user', messageText);
  if (!stateWithUserMessage) {
    console.error(`Missing conversation state for ${chatId} when adding user message`);
    return false;
  }

  const inferredData = inferLeadDataFromUserMessage(messageText);
  stateWithUserMessage.collectedData = mergeCollectedData(
    stateWithUserMessage.collectedData,
    inferredData
  );
  updateConversationState(chatId, stateWithUserMessage);

  const meetingSchedule = extractMeetingSchedule(messageText);
  const isDealAndMeetingFinalized =
    hasDealSignal(messageText) && meetingSchedule.length > 0;

  if (isDealAndMeetingFinalized) {
    const confirmationMessage = buildDealMeetingConfirmationMessage(meetingSchedule);

    await delay(AI_RESPONSE_DELAY_MS);

    const confirmationSent = await sendWhatsAppMessage(chatId, confirmationMessage);
    if (!confirmationSent) {
      console.error(`Failed to send deal+meeting confirmation to ${chatId}`);
    }

    const assistantState = addMessageToState(chatId, 'assistant', confirmationMessage);
    if (!assistantState) {
      console.error(
        `Missing conversation state for ${chatId} when saving deal+meeting confirmation`
      );
    }

    const leadFromState = toLeadDataFromCollectedData(
      stateWithUserMessage.collectedData
    );

    const telegramDealSent = await sendTelegramDealMeetingNotification({
      phoneNumber: leadIdentifier,
      meetingSchedule,
      latestUserMessage: messageText,
      collectedData: stateWithUserMessage.collectedData,
    });

    let sheetSaved = true;
    let labelTagged = true;

    if (leadFromState) {
      sheetSaved = await appendLeadToSheet(leadFromState, leadIdentifier);
      labelTagged = await applyLeadCompletionLabel(chatId);
    }

    const removedFromProcessing = await removeProcessingLeadNumber(chatId);
    const knownSavedToRedis = await saveKnownLeadNumber(chatId);

    if (
      !telegramDealSent ||
      !sheetSaved ||
      !labelTagged ||
      !removedFromProcessing ||
      !knownSavedToRedis
    ) {
      console.error(
        `Deal+meeting flow completed with errors for ${chatId}: telegramDealSent=${telegramDealSent}, sheetSaved=${sheetSaved}, labelTagged=${labelTagged}, removedFromProcessing=${removedFromProcessing}, knownSavedToRedis=${knownSavedToRedis}`
      );
    }

    markConversationComplete(chatId);
    return true;
  }

  const proposalHandled = await tryHandleProposalIntent(chatId, messageText);
  if (proposalHandled) {
    return false;
  }

  const missingFieldsBeforeReply = getMissingLeadFields(
    stateWithUserMessage.collectedData
  );

  const runtimeSystemMessage = buildRuntimeSystemMessage(
    runtimeSystemPrompt,
    stateWithUserMessage.collectedData
  );
  const recentConversationMessages = stateWithUserMessage.messages.slice(
    -MAX_MODEL_CONTEXT_MESSAGES
  );

  const openaiClient = await createOpenAIClient();
  if (!openaiClient) {
    console.error('OPENAI_API_KEY is missing. AI reply cannot be generated.');
    return false;
  }

  const openaiModel = await getOpenAIModel();

  const response = await openaiClient.chat.completions.create({
    model: openaiModel,
    messages: [
      {
        role: 'system',
        content: runtimeSystemMessage,
      },
      ...recentConversationMessages,
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  const aiReply = response.choices[0]?.message?.content?.trim() || '';

  if (!aiReply) {
    console.error('Empty AI response');
    return false;
  }

  const parsedLeadData = parseLeadFromMessage(aiReply);

  if (parsedLeadData) {
    stateWithUserMessage.collectedData = {
      ...stateWithUserMessage.collectedData,
      ...parsedLeadData,
    };
    updateConversationState(chatId, stateWithUserMessage);
  }

  const fallbackLeadData = toLeadDataFromCollectedData(
    stateWithUserMessage.collectedData
  );
  const finalLeadData = parsedLeadData ?? fallbackLeadData;
  const completedFromStateFallback = !parsedLeadData && Boolean(finalLeadData);

  if (completedFromStateFallback) {
    console.warn(
      `[Lead] Completing ${chatId} from collected state fallback because LEAD_COMPLETE payload was not detected.`
    );
  }

  const aiReplyForDelivery =
    finalLeadData || missingFieldsBeforeReply.length !== 2
      ? aiReply
      : ensureTwoFieldFollowUp(aiReply, missingFieldsBeforeReply);

  const cleanReply = stripLeadPayload(aiReplyForDelivery);
  const collectedFieldCount = countCollectedLeadFields(
    stateWithUserMessage.collectedData
  );
  const completionReplyFallback =
    'Terima kasih, Kakak. Informasi Kakak sudah lengkap dan sudah kami catat. Kakak mau lihat proposal brand apa?';
  const replySeed = completedFromStateFallback
    ? completionReplyFallback
    : cleanReply ||
      'Terima kasih, datanya sudah kami catat. Tim kami akan segera menghubungi Anda.';
  const leadIsComplete = Boolean(finalLeadData);
  const shouldOfferMeeting =
    !leadIsComplete &&
    collectedFieldCount >= 3 &&
    hasHighIntentSignal(messageText) &&
    !hasAssistantMentionedMeeting(stateWithUserMessage.messages);
  const shouldIncludeUrgency =
    !leadIsComplete &&
    shouldOfferMeeting &&
    !hasAssistantMentionedUrgency(stateWithUserMessage.messages);
  const empathyLine = buildEmpathyLine(messageText);

  const outgoingReply = enforceFranchiseeReplyStyle(
    replySeed,
    {
      includeUrgency: shouldIncludeUrgency,
      includeMeetingOffer: shouldOfferMeeting,
      empathyLine,
    }
  );

  await delay(AI_RESPONSE_DELAY_MS);

  const sendResult = await sendWhatsAppMessage(chatId, outgoingReply);
  if (!sendResult) {
    console.error(`Failed to deliver WhatsApp reply to ${chatId}`);
  }

  const assistantState = addMessageToState(chatId, 'assistant', outgoingReply);
  if (!assistantState) {
    console.error(`Missing conversation state for ${chatId} when adding assistant message`);
  }

  if (finalLeadData) {
    console.log('Lead complete! Processing final actions...');

    const sheetSaved = await appendLeadToSheet(finalLeadData, leadIdentifier);
    const telegramSent = await sendTelegramNotification(
      finalLeadData,
      leadIdentifier
    );
    const labelTagged = await applyLeadCompletionLabel(chatId);
    const removedFromProcessing = await removeProcessingLeadNumber(chatId);
    const knownSavedToRedis = await saveKnownLeadNumber(chatId);

    if (
      !sheetSaved ||
      !telegramSent ||
      !labelTagged ||
      !removedFromProcessing ||
      !knownSavedToRedis
    ) {
      console.error(
        `Lead integrations completed with errors for ${chatId}: sheetSaved=${sheetSaved}, telegramSent=${telegramSent}, labelTagged=${labelTagged}, removedFromProcessing=${removedFromProcessing}, knownSavedToRedis=${knownSavedToRedis}`
      );
    }

    markConversationComplete(chatId);
    return true;
  }

  return false;
}
