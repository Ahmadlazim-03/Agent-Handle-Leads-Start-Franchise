import {
  getNumberStatusOverride,
  isKnownLeadNumber,
  saveKnownLeadNumber,
} from './lead-numbers';
import { getRuntimeEnvValues } from './runtime-env';

const DEFAULT_WAHA_URL = 'http://localhost:3000';
const DEFAULT_WAHA_SESSION = 'default';
const DEFAULT_WAHA_NEW_LEAD_LABEL_NAME = 'Lead Baru';
const DEFAULT_WAHA_NEW_LEAD_LABEL_COLOR = 1;
const DEFAULT_NEW_LEAD_MAX_USER_MESSAGES = 1;
const WAHA_RUNTIME_CONFIG_CACHE_TTL_MS = 1500;

type WahaRuntimeConfig = {
  wahaUrl: string;
  wahaSession: string;
  wahaApiKey: string;
  allowExistingLeadsForTest: boolean;
  newLeadMaxUserMessages: number;
  wahaNewLeadLabelName: string;
  wahaNewLeadLabelColor: number;
};

let cachedWahaRuntimeConfig: {
  loadedAt: number;
  value: WahaRuntimeConfig;
} | null = null;

interface WAHAMessage {
  chatId: string;
  text: string;
  fromMe: boolean;
  timestamp: number;
}

interface WAHAContact {
  id: string;
  name: string;
  formattedName: string;
}

interface WAHALabel {
  id: string;
  name: string;
  color?: number;
  colorHex?: string;
}

export interface WhatsAppFilePayload {
  url: string;
  filename?: string;
  mimetype?: string;
  caption?: string;
}

type ChatHistoryResult =
  | { kind: 'ok'; messages: WAHAMessage[] }
  | { kind: 'not_found' }
  | { kind: 'error' };

type JsonRecord = Record<string, unknown>;

function parseNewLeadMaxUserMessages(value?: string): number {
  if (typeof value !== 'string') {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 1;
  }

  return parsed;
}

function parseLabelColor(value?: string): number {
  if (typeof value !== 'string') {
    return 1;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 19) {
    return 1;
  }

  return parsed;
}

function readWahaRuntimeConfig(): WahaRuntimeConfig {
  if (cachedWahaRuntimeConfig) {
    return cachedWahaRuntimeConfig.value;
  }

  const fallbackUrl = process.env.WAHA_URL?.trim() || DEFAULT_WAHA_URL;
  const fallbackSession = process.env.WAHA_SESSION?.trim() || DEFAULT_WAHA_SESSION;
  const fallbackApiKey = process.env.WAHA_API_KEY?.trim() || '';
  const fallbackAllowExistingLeadsForTest =
    process.env.ALLOW_EXISTING_LEADS_FOR_TEST?.trim().toLowerCase() === 'true';
  const fallbackNewLeadMaxUserMessages = parseNewLeadMaxUserMessages(
    process.env.NEW_LEAD_MAX_USER_MESSAGES
  );
  const fallbackWahaNewLeadLabelName =
    process.env.WAHA_NEW_LEAD_LABEL_NAME?.trim() || DEFAULT_WAHA_NEW_LEAD_LABEL_NAME;
  const fallbackWahaNewLeadLabelColor = parseLabelColor(
    process.env.WAHA_NEW_LEAD_LABEL_COLOR
  );

  return {
    wahaUrl: fallbackUrl,
    wahaSession: fallbackSession,
    wahaApiKey: fallbackApiKey,
    allowExistingLeadsForTest: fallbackAllowExistingLeadsForTest,
    newLeadMaxUserMessages:
      fallbackNewLeadMaxUserMessages || DEFAULT_NEW_LEAD_MAX_USER_MESSAGES,
    wahaNewLeadLabelName: fallbackWahaNewLeadLabelName,
    wahaNewLeadLabelColor:
      fallbackWahaNewLeadLabelColor || DEFAULT_WAHA_NEW_LEAD_LABEL_COLOR,
  };
}

async function loadWahaRuntimeConfig(force = false): Promise<WahaRuntimeConfig> {
  const now = Date.now();
  if (
    !force &&
    cachedWahaRuntimeConfig &&
    now - cachedWahaRuntimeConfig.loadedAt < WAHA_RUNTIME_CONFIG_CACHE_TTL_MS
  ) {
    return cachedWahaRuntimeConfig.value;
  }

  const runtimeValues = await getRuntimeEnvValues([
    'WAHA_URL',
    'WAHA_SESSION',
    'WAHA_API_KEY',
    'ALLOW_EXISTING_LEADS_FOR_TEST',
    'NEW_LEAD_MAX_USER_MESSAGES',
    'WAHA_NEW_LEAD_LABEL_NAME',
    'WAHA_NEW_LEAD_LABEL_COLOR',
  ]);

  const resolvedConfig: WahaRuntimeConfig = {
    wahaUrl: runtimeValues.WAHA_URL.trim() || DEFAULT_WAHA_URL,
    wahaSession: runtimeValues.WAHA_SESSION.trim() || DEFAULT_WAHA_SESSION,
    wahaApiKey: runtimeValues.WAHA_API_KEY.trim(),
    allowExistingLeadsForTest:
      runtimeValues.ALLOW_EXISTING_LEADS_FOR_TEST.trim().toLowerCase() === 'true',
    newLeadMaxUserMessages:
      parseNewLeadMaxUserMessages(runtimeValues.NEW_LEAD_MAX_USER_MESSAGES) ||
      DEFAULT_NEW_LEAD_MAX_USER_MESSAGES,
    wahaNewLeadLabelName:
      runtimeValues.WAHA_NEW_LEAD_LABEL_NAME.trim() ||
      DEFAULT_WAHA_NEW_LEAD_LABEL_NAME,
    wahaNewLeadLabelColor:
      parseLabelColor(runtimeValues.WAHA_NEW_LEAD_LABEL_COLOR) ||
      DEFAULT_WAHA_NEW_LEAD_LABEL_COLOR,
  };

  cachedWahaRuntimeConfig = {
    loadedAt: now,
    value: resolvedConfig,
  };

  return resolvedConfig;
}

export async function fetchWahaMediaAsBase64FromUrl(originalMediaUrl: string): Promise<string | null> {
  try {
    const config = await loadWahaRuntimeConfig();
    
    // Replace localhost or 127.0.0.1 with the configured WAHA_URL so it works in Docker/Coolify
    let fetchUrl = originalMediaUrl;
    if (fetchUrl.includes('localhost:') || fetchUrl.includes('127.0.0.1:')) {
      const urlObj = new URL(fetchUrl);
      fetchUrl = `${config.wahaUrl}${urlObj.pathname}${urlObj.search}`;
    }

    const response = await fetch(fetchUrl, {
      method: 'GET',
      headers: config.wahaApiKey ? { 'X-Api-Key': config.wahaApiKey } : {},
    });

    if (!response.ok) {
      console.error(`Failed to fetch WAHA cached media from ${fetchUrl}: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error(`Error fetching WAHA cached media from ${originalMediaUrl}:`, error);
    return null;
  }
}

export async function downloadWahaMediaAsBase64(messageId: string): Promise<string | null> {
  try {
    const config = await loadWahaRuntimeConfig();
    const url = `${config.wahaUrl}/api/${config.wahaSession}/messages/${encodeURIComponent(messageId)}/download`;

    const response = await fetch(url, {
      method: 'GET',
      headers: config.wahaApiKey ? { 'X-Api-Key': config.wahaApiKey } : {},
    });

    if (!response.ok) {
      console.error(`Failed to download WAHA media for ${messageId}: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error(`Error downloading WAHA media for ${messageId}:`, error);
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function formatChatId(chatId: string): string {
  const normalized = chatId.trim();
  if (!normalized) {
    return normalized;
  }

  // Preserve any explicit JID suffix (@lid, @s.whatsapp.net, @g.us, etc.).
  if (normalized.includes('@')) {
    return normalized;
  }

  return `${normalized}@c.us`;
}

function isGroupOrBroadcastChatId(chatId: string): boolean {
  const normalized = formatChatId(chatId).toLowerCase();
  return (
    normalized.endsWith('@g.us') ||
    normalized.includes('@broadcast') ||
    normalized.includes('status@broadcast')
  );
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

function getRelatedChatIds(chatId: string): string[] {
  const formatted = formatChatId(chatId);
  const lower = formatted.toLowerCase();
  const phoneNumber = normalizePhoneNumber(formatted);

  const related = new Set<string>([formatted]);

  if (!phoneNumber) {
    return [...related];
  }

  // Always probe all personal-chat JID variants because WAHA can store
  // history/labels under different suffixes for the same phone number.
  related.add(`${phoneNumber}@c.us`);
  related.add(`${phoneNumber}@s.whatsapp.net`);
  related.add(`${phoneNumber}@lid`);

  if (lower.endsWith('@lid')) {
    related.add(`${phoneNumber}@s.whatsapp.net`);
    related.add(`${phoneNumber}@c.us`);
  }

  if (lower.endsWith('@s.whatsapp.net') || lower.endsWith('@c.us')) {
    related.add(`${phoneNumber}@lid`);
  }

  return [...related];
}

function buildWahaUrl(path: string, params?: Record<string, string>): string {
  const config = readWahaRuntimeConfig();
  const url = new URL(path, config.wahaUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function buildWahaHeaders(): Record<string, string> {
  const config = readWahaRuntimeConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.wahaApiKey) {
    headers['X-Api-Key'] = config.wahaApiKey;
    headers.Authorization = `Bearer ${config.wahaApiKey}`;
  }

  return headers;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return false;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function normalizeColor(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeLabel(raw: unknown): WAHALabel | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const id = normalizeText(record.id);
  const name = normalizeText(record.name);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    color: normalizeColor(record.color),
    colorHex: normalizeText(record.colorHex),
  };
}

function parseLabels(payload: unknown): WAHALabel[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  return payload
    .map((item) => normalizeLabel(item))
    .filter((item): item is WAHALabel => item !== null);
}

function isNowebStoreDisabledError(status: number, body: string): boolean {
  return status === 400 && /Enable NOWEB store/i.test(body);
}

function logWahaLabelApiError(
  action: string,
  status: number,
  statusText: string,
  body: string
): void {
  if (isNowebStoreDisabledError(status, body)) {
    console.error(
      `[WAHA Labels] ${action} failed: NOWEB store is disabled. Enable config.noweb.store.enabled=true and config.noweb.store.fullSync=true when creating a new WAHA session.`
    );
    return;
  }

  console.error(
    `[WAHA Labels] ${action} failed: status=${status} statusText=${statusText} body=${body.slice(0, 500)}`
  );
}

function pickHistoryItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const candidates = [record.messages, record.data, record.results, record.items];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeHistoryMessage(raw: unknown, chatId: string): WAHAMessage | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const messageRecord = asRecord(record.message);
  const keyRecord = asRecord(record.key);

  const text =
    normalizeText(record.text) ||
    normalizeText(record.body) ||
    normalizeText(messageRecord?.text);

  if (!text) {
    return null;
  }

  const fromMe = normalizeBoolean(record.fromMe ?? keyRecord?.fromMe);
  const normalizedChatId =
    normalizeText(record.chatId) ||
    normalizeText(record.from) ||
    formatChatId(chatId);

  return {
    chatId: normalizedChatId,
    text,
    fromMe,
    timestamp: normalizeTimestamp(record.timestamp),
  };
}

function buildHistoryUrls(chatId: string): string[] {
  const config = readWahaRuntimeConfig();
  const formattedChatId = formatChatId(chatId);
  const encodedChatId = encodeURIComponent(formattedChatId);

  return [
    buildWahaUrl(
      buildSessionApiPath(`/chats/${encodedChatId}/messages`),
      { limit: '200' }
    ),
    buildWahaUrl('/api/messages', {
      chatId: formattedChatId,
      session: config.wahaSession,
      limit: '200',
    }),
    // Legacy fallback for old WAHA deployments.
    buildWahaUrl('/api/chatting/history', {
      chatId: formattedChatId,
      session: config.wahaSession,
    }),
  ];
}

function isOutboundInitiatedConversation(messages: WAHAMessage[]): boolean {
  const textMessages = messages.filter((message) => message.text.trim().length > 0);
  if (textMessages.length === 0) {
    return false;
  }

  const chronological = [...textMessages].sort(
    (left, right) => left.timestamp - right.timestamp
  );

  const firstOutboundIndex = chronological.findIndex((message) => message.fromMe);
  const firstInboundIndex = chronological.findIndex((message) => !message.fromMe);

  if (firstOutboundIndex === -1) {
    return false;
  }

  if (firstInboundIndex === -1) {
    return true;
  }

  return firstOutboundIndex < firstInboundIndex;
}

export async function sendWhatsAppMessage(
  chatId: string,
  message: string
): Promise<boolean> {
  const runtimeConfig = await loadWahaRuntimeConfig();
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return false;
  }

  if (isGroupOrBroadcastChatId(chatId)) {
    console.log(`[WAHA] Skip sendText to group/broadcast chatId=${formatChatId(chatId)}`);
    return false;
  }

  try {
    const response = await fetch(buildWahaUrl('/api/sendText'), {
      method: 'POST',
      headers: buildWahaHeaders(),
      body: JSON.stringify({
        chatId: formatChatId(chatId),
        text: trimmedMessage,
        session: runtimeConfig.wahaSession,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        `Failed to send WhatsApp message: status=${response.status} statusText=${response.statusText} body=${errorBody.slice(0, 500)}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return false;
  }
}

export async function sendWhatsAppFile(
  chatId: string,
  payload: WhatsAppFilePayload
): Promise<boolean> {
  const runtimeConfig = await loadWahaRuntimeConfig();
  const fileUrl = normalizeText(payload.url);
  if (!fileUrl) {
    return false;
  }

  if (isGroupOrBroadcastChatId(chatId)) {
    console.log(`[WAHA] Skip sendFile to group/broadcast chatId=${formatChatId(chatId)}`);
    return false;
  }

  const filename = normalizeText(payload.filename) || 'proposal.pdf';
  const mimetype = normalizeText(payload.mimetype) || 'application/pdf';
  const caption = normalizeText(payload.caption);

  try {
    const response = await fetch(buildWahaUrl('/api/sendFile'), {
      method: 'POST',
      headers: buildWahaHeaders(),
      body: JSON.stringify({
        chatId: formatChatId(chatId),
        file: {
          url: fileUrl,
          filename,
          mimetype,
        },
        caption: caption || undefined,
        session: runtimeConfig.wahaSession,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        `Failed to send WhatsApp file: status=${response.status} statusText=${response.statusText} body=${errorBody.slice(0, 500)}`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending WhatsApp file:', error);
    return false;
  }
}

export async function getChatHistory(
  chatId: string
): Promise<ChatHistoryResult> {
  await loadWahaRuntimeConfig();
  const candidateChatIds = getRelatedChatIds(chatId);
  let non404FailureCount = 0;

  for (const candidateChatId of candidateChatIds) {
    const historyUrls = buildHistoryUrls(candidateChatId);

    for (const historyUrl of historyUrls) {
      try {
        const response = await fetch(historyUrl, {
          method: 'GET',
          headers: buildWahaHeaders(),
        });

        if (response.status === 404) {
          continue;
        }

        if (!response.ok) {
          non404FailureCount += 1;
          const errorBody = await response.text().catch(() => '');
          console.error(
            `[Gatekeeper] Failed to get chat history for ${formatChatId(candidateChatId)} via ${historyUrl}: status=${response.status} statusText=${response.statusText} body=${errorBody.slice(0, 300)}`
          );
          continue;
        }

        const payload = (await response.json()) as unknown;
        const messages = pickHistoryItems(payload)
          .map((item) => normalizeHistoryMessage(item, candidateChatId))
          .filter((item): item is WAHAMessage => item !== null);

        if (messages.length === 0) {
          // Some WAHA endpoints can return 200 with empty arrays for a JID
          // variant that does not hold actual chat history.
          continue;
        }

        return { kind: 'ok', messages };
      } catch (error) {
        non404FailureCount += 1;
        console.error(
          `[Gatekeeper] Error getting chat history for ${formatChatId(candidateChatId)} via ${historyUrl}:`,
          error
        );
      }
    }
  }

  if (non404FailureCount > 0) {
    return { kind: 'error' };
  }

  console.warn(
    `[Gatekeeper] WAHA history returned 404 for all related IDs of ${chatId}; treating as no prior conversation.`
  );
  return { kind: 'not_found' };
}

export async function getContactInfo(
  chatId: string
): Promise<WAHAContact | null> {
  const runtimeConfig = await loadWahaRuntimeConfig();
  try {
    const response = await fetch(
      buildWahaUrl('/api/contacts', {
        session: runtimeConfig.wahaSession,
      }),
      {
        method: 'GET',
        headers: buildWahaHeaders(),
      }
    );

    if (!response.ok) {
      console.error(`Failed to get contact info: ${response.statusText}`);
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return null;
    }

    const targetChatId = formatChatId(chatId);

    const contact = payload
      .map((item) => asRecord(item))
      .find((item) => item && normalizeText(item.id) === targetChatId);

    if (!contact) {
      return null;
    }

    return {
      id: normalizeText(contact.id),
      name: normalizeText(contact.name),
      formattedName: normalizeText(contact.formattedName),
    };
  } catch (error) {
    console.error('Error getting contact info:', error);
    return null;
  }
}

function buildSessionApiPath(path: string): string {
  const config = readWahaRuntimeConfig();
  return `/api/${encodeURIComponent(config.wahaSession)}${path}`;
}

async function getSessionLabels(): Promise<WAHALabel[] | null> {
  try {
    const response = await fetch(buildWahaUrl(buildSessionApiPath('/labels')), {
      method: 'GET',
      headers: buildWahaHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logWahaLabelApiError('Get labels', response.status, response.statusText, body);
      return null;
    }

    const payload = (await response.json()) as unknown;
    const labels = parseLabels(payload);
    if (!labels) {
      console.error('[WAHA Labels] Get labels failed: unexpected response payload.');
      return null;
    }

    return labels;
  } catch (error) {
    console.error('[WAHA Labels] Get labels error:', error);
    return null;
  }
}

async function createSessionLabel(
  labelName: string,
  color: number
): Promise<WAHALabel | null> {
  try {
    const response = await fetch(buildWahaUrl(buildSessionApiPath('/labels')), {
      method: 'POST',
      headers: buildWahaHeaders(),
      body: JSON.stringify({
        name: labelName,
        color,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logWahaLabelApiError('Create label', response.status, response.statusText, body);
      return null;
    }

    const payload = (await response.json()) as unknown;
    const label = normalizeLabel(payload);
    if (label) {
      return label;
    }

    const labels = await getSessionLabels();
    if (!labels) {
      return null;
    }

    return (
      labels.find(
        (item) => item.name.toLowerCase() === labelName.trim().toLowerCase()
      ) || null
    );
  } catch (error) {
    console.error('[WAHA Labels] Create label error:', error);
    return null;
  }
}

async function getChatLabels(chatId: string): Promise<WAHALabel[] | null> {
  const targetChatId = formatChatId(chatId);

  try {
    const response = await fetch(
      buildWahaUrl(
        buildSessionApiPath(`/labels/chats/${encodeURIComponent(targetChatId)}/`)
      ),
      {
        method: 'GET',
        headers: buildWahaHeaders(),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logWahaLabelApiError(
        'Get labels by chat',
        response.status,
        response.statusText,
        body
      );
      return null;
    }

    const payload = (await response.json()) as unknown;
    const labelsFromArray = parseLabels(payload);
    if (labelsFromArray) {
      return labelsFromArray;
    }

    const payloadRecord = asRecord(payload);
    const labelsFromRecord = parseLabels(payloadRecord?.labels);
    if (labelsFromRecord) {
      return labelsFromRecord;
    }

    console.error('[WAHA Labels] Get labels by chat failed: unexpected response payload.');
    return null;
  } catch (error) {
    console.error('[WAHA Labels] Get labels by chat error:', error);
    return null;
  }
}

async function updateLabelsToChat(
  chatId: string,
  labelIds: string[]
): Promise<boolean> {
  const targetChatId = formatChatId(chatId);

  try {
    const response = await fetch(
      buildWahaUrl(
        buildSessionApiPath(`/labels/chats/${encodeURIComponent(targetChatId)}/`)
      ),
      {
        method: 'PUT',
        headers: buildWahaHeaders(),
        body: JSON.stringify({
          labels: labelIds.map((id) => ({ id })),
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logWahaLabelApiError(
        'Update labels to chat',
        response.status,
        response.statusText,
        body
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('[WAHA Labels] Update labels to chat error:', error);
    return false;
  }
}

export async function applyLeadCompletionLabel(chatId: string): Promise<boolean> {
  const runtimeConfig = await loadWahaRuntimeConfig();
  const labelName = runtimeConfig.wahaNewLeadLabelName.trim();

  if (!labelName) {
    console.warn('[WAHA Labels] WAHA_NEW_LEAD_LABEL_NAME is empty, skip label assignment.');
    return true;
  }

  const labels = await getSessionLabels();
  if (!labels) {
    return false;
  }

  let targetLabel: WAHALabel | null =
    labels.find((label) => label.name.toLowerCase() === labelName.toLowerCase()) ||
    null;

  if (!targetLabel) {
    targetLabel = await createSessionLabel(
      labelName,
      runtimeConfig.wahaNewLeadLabelColor
    );
    if (!targetLabel) {
      return false;
    }
  }

  const candidateChatIds = getRelatedChatIds(chatId);
  let updatedAny = false;

  for (const candidateChatId of candidateChatIds) {
    const chatLabels = await getChatLabels(candidateChatId);

    let labelIds: string[] = [targetLabel.id];
    if (chatLabels) {
      const mergedIds = new Set(chatLabels.map((label) => label.id));
      mergedIds.add(targetLabel.id);

      if (chatLabels.some((label) => label.id === targetLabel.id)) {
        console.log(
          `[WAHA Labels] Chat ${formatChatId(candidateChatId)} already has label "${targetLabel.name}".`
        );
        updatedAny = true;
        continue;
      }

      labelIds = [...mergedIds];
    } else {
      console.warn(
        `[WAHA Labels] Could not read existing labels for ${formatChatId(candidateChatId)}. Applying only target label as fallback.`
      );
    }

    const updated = await updateLabelsToChat(candidateChatId, labelIds);
    if (updated) {
      console.log(
        `[WAHA Labels] Label "${targetLabel.name}" applied to ${formatChatId(candidateChatId)}.`
      );
      updatedAny = true;
    }
  }

  return updatedAny;
}

function buildKnownLeadAliasCandidates(
  chatId: string,
  identifierAliases: string[]
): string[] {
  const candidates = new Set<string>();

  const appendCandidate = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    candidates.add(trimmed);

    for (const relatedChatId of getRelatedChatIds(trimmed)) {
      candidates.add(relatedChatId);
    }
  };

  appendCandidate(chatId);
  for (const alias of identifierAliases) {
    appendCandidate(alias);
  }

  return [...candidates];
}

export async function isKnownLeadByAliases(
  chatId: string,
  identifierAliases: string[] = []
): Promise<boolean> {
  const runtimeConfig = await loadWahaRuntimeConfig();

  if (runtimeConfig.allowExistingLeadsForTest) {
    return false;
  }

  const aliasCandidates = buildKnownLeadAliasCandidates(chatId, identifierAliases);
  for (const aliasCandidate of aliasCandidates) {
    const alreadyKnownInRedis = await isKnownLeadNumber(aliasCandidate);
    if (!alreadyKnownInRedis) {
      continue;
    }

    console.log(
      `[Gatekeeper] chatId=${chatId} matched Redis known-leads set via alias=${aliasCandidate}.`
    );
    return true;
  }

  return false;
}

export async function isNewLead(
  chatId: string,
  identifierAliases: string[] = []
): Promise<boolean> {
  const runtimeConfig = await loadWahaRuntimeConfig();

  if (runtimeConfig.allowExistingLeadsForTest) {
    console.log(
      `[Gatekeeper] ALLOW_EXISTING_LEADS_FOR_TEST=true, bypassing new-lead check for ${chatId}`
    );
    return true;
  }

  const statusOverride = await getNumberStatusOverride(chatId);
  if (statusOverride === 'selesai_berlabel') {
    console.log(
      `[Gatekeeper] Status override for ${chatId} is selesai_berlabel, skipping AI follow-up.`
    );
    return false;
  }

  if (statusOverride === 'pernah_chat' || statusOverride === 'proses_bot') {
    console.log(
      `[Gatekeeper] Status override for ${chatId} is ${statusOverride}, allowing AI conversation.`
    );
    return true;
  }

  const alreadyKnownInRedis = await isKnownLeadByAliases(chatId, identifierAliases);
  if (alreadyKnownInRedis) {
    return false;
  }

  const history = await getChatHistory(chatId);

  if (history.kind === 'not_found') {
    return true;
  }

  if (history.kind === 'error') {
    console.error(
      `[Gatekeeper] Failed to validate chat history for ${chatId}, message ignored.`
    );
    return false;
  }

  const startedByAgent = isOutboundInitiatedConversation(history.messages);
  if (startedByAgent) {
    console.log(
      `[Gatekeeper] chatId=${chatId} conversation was initiated by outbound message, skipping AI follow-up.`
    );
    await saveKnownLeadNumber(chatId);
    return false;
  }

  const userMessages = history.messages.filter(
    (msg) => !msg.fromMe && msg.text.length > 0
  );
  const isLeadFresh =
    userMessages.length <= runtimeConfig.newLeadMaxUserMessages;

  console.log(
    `[Gatekeeper] chatId=${chatId} userMessages=${userMessages.length} threshold=${runtimeConfig.newLeadMaxUserMessages} isNew=${isLeadFresh}`
  );

  if (!isLeadFresh) {
    await saveKnownLeadNumber(chatId);
  }

  return isLeadFresh;
}
