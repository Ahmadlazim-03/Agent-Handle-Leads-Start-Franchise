import { NextRequest, NextResponse } from 'next/server';
import { openai, AI_MODEL } from '@/lib/openai';
import {
  sendWhatsAppMessage,
  isNewLead,
  applyLeadCompletionLabel,
} from '@/lib/waha';
import { appendLeadToSheet } from '@/lib/sheets';
import { sendTelegramNotification } from '@/lib/telegram';
import {
  saveIncomingLeadNumber,
  saveKnownLeadNumber,
  saveProcessingLeadNumber,
  removeProcessingLeadNumber,
} from '@/lib/lead-numbers';
import {
  SYSTEM_PROMPT,
  parseLeadFromMessage,
  stripLeadPayload,
} from '@/prompts/agent';
import {
  getConversationState,
  createConversationState,
  addMessageToState,
  updateConversationState,
  markConversationComplete,
} from '@/lib/store';
import {
  listAvailableProposalBrands,
  resolveBrandProposalRequest,
} from '@/lib/proposals';

export const runtime = 'nodejs';

const AI_RESPONSE_DELAY_MS = 2000;
const DUPLICATE_MESSAGE_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map<string, number>();

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
  let dedupeMarked = false;

  try {
    const body = (await request.json()) as unknown;
    const payload = extractPayload(body);

    if (!payload) {
      console.log('Invalid payload shape, ignoring...');
      return NextResponse.json({ status: 'ignored_invalid_payload' });
    }

    const chatIdentifier = extractChatIdentifier(payload);
    if (isGroupOrBroadcastPayload(payload)) {
      console.log(
        `Ignoring group/broadcast message source=${chatIdentifier || 'unknown'}`
      );
      return NextResponse.json({ status: 'ignored_group_or_broadcast' });
    }

    const chatId = extractChatId(payload);
    const messageText = extractMessageText(payload);

    if (!chatId || !messageText) {
      console.log('Invalid payload, ignoring...');
      return NextResponse.json({ status: 'ignored_invalid_message' });
    }

    if (isFromMe(payload)) {
      return NextResponse.json({ status: 'ignored_from_me' });
    }

    const incomingSavedToRedis = await saveIncomingLeadNumber(chatId);
    if (!incomingSavedToRedis) {
      console.warn(
        `[Redis] Incoming number for ${chatId} was not persisted (Redis unavailable or write failed).`
      );
    }

    messageId = extractMessageId(payload);
    if (!shouldProcessMessage(messageId)) {
      console.log(`Duplicate webhook ignored for messageId=${messageId}`);
      return NextResponse.json({ status: 'ignored_duplicate' });
    }
    dedupeMarked = messageId !== null;

    const isComplete = await handleConversation(chatId, messageText);

    return NextResponse.json({ status: isComplete ? 'complete' : 'processed' });
  } catch (error) {
    if (dedupeMarked && messageId) {
      processedMessageIds.delete(messageId);
    }

    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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

function normalizeBudgetText(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\bjt\b/gi, 'juta')
    .replace(/\bm\b/gi, 'miliar');
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

  return {
    sumberInfo: extractSourceInfo(normalizedMessage),
    biodata: extractBiodata(normalizedMessage),
    bidangUsaha: extractBusinessField(normalizedMessage),
    budget: extractBudget(normalizedMessage),
    rencanaMulai: extractStartPlan(normalizedMessage),
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

function keepTwoShortSentences(content: string): string {
  const normalized = normalizeWhitespace(content);
  if (!normalized) {
    return '';
  }

  const chunks =
    normalized.match(/[^.!?]+[.!?]?/g)?.map((chunk) => chunk.trim()).filter(Boolean) ||
    [normalized];

  return chunks.slice(0, 2).join(' ');
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

function enforceFranchiseeReplyStyle(content: string): string {
  let next = keepTwoShortSentences(stripRolePrefixes(content));

  if (!next) {
    next = 'Terima kasih sudah menghubungi StartFranchise.id.';
  }

  next = ensurePreferredAddress(next);

  if (!hasUrgencyMessage(next)) {
    next = `${next} ${DEFAULT_URGENCY_MESSAGE}`;
  }

  if (!hasMeetingInvite(next)) {
    next = `${next} ${REQUIRED_MEETING_INVITE}`;
  }

  if (!hasTimeSlotQuestion(next)) {
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

async function handleConversation(
  chatId: string,
  messageText: string
): Promise<boolean> {
  if (isGroupOrBroadcastIdentifier(chatId)) {
    console.log(`Conversation ignored for non-personal chatId=${chatId}`);
    return false;
  }

  let state = getConversationState(chatId);

  if (!state) {
    const isLeadNew = await isNewLead(chatId);
    if (!isLeadNew) {
      console.log(`Chat ID ${chatId} is not a new lead, ignoring...`);
      return false;
    }

    state = createConversationState(chatId);
    state.messages.push({ role: 'system', content: SYSTEM_PROMPT });
  }

  if (state.isComplete) {
    console.log(`Conversation for ${chatId} is already complete, ignoring...`);
    await removeProcessingLeadNumber(chatId);
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

  const proposalLookup = await resolveBrandProposalRequest(messageText);
  if (proposalLookup.isProposalIntent) {
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
        console.error(
          `Missing conversation state for ${chatId} when saving proposal clarification`
        );
      }

      return false;
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
      console.error(`Missing conversation state for ${chatId} when saving proposal reply`);
    }

    return false;
  }

  const missingFieldsBeforeReply = getMissingLeadFields(
    stateWithUserMessage.collectedData
  );

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: stateWithUserMessage.messages,
    temperature: 0.7,
    max_tokens: 500,
  });

  const aiReply = response.choices[0]?.message?.content?.trim() || '';

  if (!aiReply) {
    console.error('Empty AI response');
    return false;
  }

  const leadData = parseLeadFromMessage(aiReply);

  if (leadData) {
    stateWithUserMessage.collectedData = {
      ...stateWithUserMessage.collectedData,
      ...leadData,
    };
    updateConversationState(chatId, stateWithUserMessage);
  }

  const aiReplyForDelivery =
    leadData || missingFieldsBeforeReply.length !== 2
      ? aiReply
      : ensureTwoFieldFollowUp(aiReply, missingFieldsBeforeReply);

  const cleanReply = stripLeadPayload(aiReplyForDelivery);
  const outgoingReply = enforceFranchiseeReplyStyle(
    cleanReply ||
      'Terima kasih, datanya sudah kami catat. Tim kami akan segera menghubungi Anda.'
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

  if (leadData) {
    console.log('Lead complete! Processing final actions...');

    const sheetSaved = await appendLeadToSheet(leadData, chatId);
    const telegramSent = await sendTelegramNotification(leadData, chatId);
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
