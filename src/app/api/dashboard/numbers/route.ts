import { NextRequest, NextResponse } from 'next/server';
import {
  ManagedNumberStatus,
  clearAllManagedNumbers,
  clearNumberStatusOverride,
  fetchIncomingLeadNumbers,
  fetchKnownLeadNumbers,
  fetchProcessingLeadNumbers,
  fetchNumberStatusOverrides,
  removeKnownLeadNumber,
  saveIncomingLeadNumbers,
  saveKnownLeadNumber,
  setNumberStatusOverride,
} from '@/lib/lead-numbers';
import {
  listConversationStates,
  resetAllConversations,
  resetConversationByPhoneNumber,
} from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;

type DashboardRow = {
  phoneNumber: string;
  displayName: string;
  pushName: string;
  isIncoming: boolean;
  isKnown: boolean;
  fromWahaChat: boolean;
  chatIds: string[];
  labelNames: string[];
  isInConversation: boolean;
  isConversationComplete: boolean;
  lastActivityAt: string | null;
  statusAuto: ManagedNumberStatus;
  statusManual: ManagedNumberStatus | null;
  statusCurrent: ManagedNumberStatus;
};

type WahaChat = {
  id: string;
  name: string;
  pushName: string;
};

type WahaContact = {
  id: string;
  number: string;
  name: string;
  pushName: string;
};

type WahaLabel = {
  id: string;
  name: string;
};

type WahaFetchResult<T> = {
  items: T[];
  error: string | null;
};

type WahaSetFetchResult = {
  items: Set<string>;
  error: string | null;
};

const WAHA_URL = process.env.WAHA_URL || 'http://localhost:3000';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const WAHA_API_KEY = process.env.WAHA_API_KEY?.trim() || '';
const WAHA_NEW_LEAD_LABEL_NAME =
  process.env.WAHA_NEW_LEAD_LABEL_NAME?.trim() || 'Lead Baru';

const MANAGED_STATUSES: ManagedNumberStatus[] = [
  'pernah_chat',
  'proses_bot',
  'selesai_berlabel',
];

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeManagedStatus(value: string): ManagedNumberStatus | null {
  const normalized = value.trim().toLowerCase() as ManagedNumberStatus;
  if (!MANAGED_STATUSES.includes(normalized)) {
    return null;
  }

  return normalized;
}

function isGroupOrBroadcast(chatId: string): boolean {
  const normalized = chatId.toLowerCase();
  return (
    normalized.endsWith('@g.us') ||
    normalized.includes('@broadcast') ||
    normalized.includes('status@broadcast')
  );
}

function buildWahaHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (WAHA_API_KEY) {
    headers['X-Api-Key'] = WAHA_API_KEY;
    headers.Authorization = `Bearer ${WAHA_API_KEY}`;
  }

  return headers;
}

function buildWahaUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, WAHA_URL);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function statusLabel(status: ManagedNumberStatus): string {
  if (status === 'proses_bot') {
    return 'Proses Bot';
  }

  if (status === 'selesai_berlabel') {
    return 'Selesai + Berlabel';
  }

  return 'Pernah Chat';
}

async function fetchWahaChats(limit = 300): Promise<WahaFetchResult<WahaChat>> {
  try {
    const response = await fetch(
      buildWahaUrl(`/api/${encodeURIComponent(WAHA_SESSION)}/chats`, {
        limit: String(limit),
        offset: '0',
      }),
      {
        method: 'GET',
        headers: buildWahaHeaders(),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        items: [],
        error: `WAHA chats fetch failed: ${response.status} ${response.statusText} ${body.slice(0, 180)}`,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return {
        items: [],
        error: 'WAHA chats fetch failed: unexpected payload shape.',
      };
    }

    const items = payload
      .map((raw) => {
        const record = asRecord(raw);
        if (!record) {
          return null;
        }

        const id = normalizeText(record.id);
        if (!id || isGroupOrBroadcast(id)) {
          return null;
        }

        return {
          id,
          name:
            normalizeText(record.name) ||
            normalizeText(record.formattedTitle) ||
            normalizeText(record.pushName),
          pushName: normalizeText(record.pushName),
        };
      })
      .filter((item): item is WahaChat => item !== null);

    return {
      items,
      error: null,
    };
  } catch (error) {
    return {
      items: [],
      error: `WAHA chats fetch error: ${String(error)}`,
    };
  }
}

async function fetchWahaContacts(limit = 500): Promise<WahaFetchResult<WahaContact>> {
  try {
    const response = await fetch(
      buildWahaUrl('/api/contacts/all', {
        session: WAHA_SESSION,
        limit: String(limit),
        offset: '0',
      }),
      {
        method: 'GET',
        headers: buildWahaHeaders(),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        items: [],
        error: `WAHA contacts fetch failed: ${response.status} ${response.statusText} ${body.slice(0, 180)}`,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return {
        items: [],
        error: 'WAHA contacts fetch failed: unexpected payload shape.',
      };
    }

    const items = payload
      .map((raw) => {
        const record = asRecord(raw);
        if (!record) {
          return null;
        }

        const id = normalizeText(record.id);
        const number = normalizeText(record.number) || normalizePhoneNumber(id);

        if (!id && !number) {
          return null;
        }

        return {
          id,
          number,
          name: normalizeText(record.name),
          pushName: normalizeText(record.pushname),
        };
      })
      .filter((item): item is WahaContact => item !== null);

    return {
      items,
      error: null,
    };
  } catch (error) {
    return {
      items: [],
      error: `WAHA contacts fetch error: ${String(error)}`,
    };
  }
}

async function fetchWahaLabels(): Promise<WahaFetchResult<WahaLabel>> {
  try {
    const response = await fetch(
      buildWahaUrl(`/api/${encodeURIComponent(WAHA_SESSION)}/labels`),
      {
        method: 'GET',
        headers: buildWahaHeaders(),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        items: [],
        error: `WAHA labels fetch failed: ${response.status} ${response.statusText} ${body.slice(0, 180)}`,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return {
        items: [],
        error: 'WAHA labels fetch failed: unexpected payload shape.',
      };
    }

    const items = payload
      .map((raw) => {
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
        };
      })
      .filter((item): item is WahaLabel => item !== null);

    return {
      items,
      error: null,
    };
  } catch (error) {
    return {
      items: [],
      error: `WAHA labels fetch error: ${String(error)}`,
    };
  }
}

async function fetchChatsByLabelId(labelId: string): Promise<WahaSetFetchResult> {
  try {
    const response = await fetch(
      buildWahaUrl(
        `/api/${encodeURIComponent(WAHA_SESSION)}/labels/${encodeURIComponent(labelId)}/chats`
      ),
      {
        method: 'GET',
        headers: buildWahaHeaders(),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        items: new Set<string>(),
        error: `WAHA label chats fetch failed: ${response.status} ${response.statusText} ${body.slice(0, 180)}`,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return {
        items: new Set<string>(),
        error: 'WAHA label chats fetch failed: unexpected payload shape.',
      };
    }

    const chatIds = new Set<string>();

    for (const raw of payload) {
      if (typeof raw === 'string') {
        const normalized = normalizeText(raw);
        if (normalized && !isGroupOrBroadcast(normalized)) {
          chatIds.add(normalized);
        }
        continue;
      }

      const record = asRecord(raw);
      if (!record) {
        continue;
      }

      const id =
        normalizeText(record.id) ||
        normalizeText(record.chatId) ||
        normalizeText(record.jid);

      if (!id || isGroupOrBroadcast(id)) {
        continue;
      }

      chatIds.add(id);
    }

    return {
      items: chatIds,
      error: null,
    };
  } catch (error) {
    return {
      items: new Set<string>(),
      error: `WAHA label chats fetch error: ${String(error)}`,
    };
  }
}

function buildDashboardRows(input: {
  incomingNumbers: string[];
  knownNumbers: string[];
  processingNumbers: string[];
  statusOverrides: Record<string, ManagedNumberStatus>;
  chats: WahaChat[];
  contacts: WahaContact[];
  conversationStates: ReturnType<typeof listConversationStates>;
  labeledChatIds: Set<string>;
  leadLabelName: string;
}) {
  const incomingSet = new Set(
    input.incomingNumbers.map((value) => normalizePhoneNumber(value)).filter(Boolean)
  );
  const knownSet = new Set(
    input.knownNumbers.map((value) => normalizePhoneNumber(value)).filter(Boolean)
  );
  const processingSet = new Set(
    input.processingNumbers
      .map((value) => normalizePhoneNumber(value))
      .filter(Boolean)
  );

  const contactByPhone = new Map<string, WahaContact>();
  for (const contact of input.contacts) {
    const phoneNumber = normalizePhoneNumber(contact.number || contact.id);
    if (!phoneNumber || contactByPhone.has(phoneNumber)) {
      continue;
    }

    contactByPhone.set(phoneNumber, contact);
  }

  const chatNameById = new Map<string, { name: string; pushName: string }>();
  const chatIdsByPhone = new Map<string, Set<string>>();
  const phoneHasWahaChat = new Set<string>();

  const attachChatId = (chatId: string, fromWahaChat = false) => {
    const phoneNumber = normalizePhoneNumber(chatId);
    if (!phoneNumber || isGroupOrBroadcast(chatId)) {
      return;
    }

    if (!chatIdsByPhone.has(phoneNumber)) {
      chatIdsByPhone.set(phoneNumber, new Set<string>());
    }

    chatIdsByPhone.get(phoneNumber)?.add(chatId);

    if (fromWahaChat) {
      phoneHasWahaChat.add(phoneNumber);
    }
  };

  for (const chat of input.chats) {
    attachChatId(chat.id, true);
    chatNameById.set(chat.id, {
      name: chat.name,
      pushName: chat.pushName,
    });
  }

  for (const chatId of input.labeledChatIds) {
    attachChatId(chatId, false);
  }

  const conversationsByPhone = new Map<
    string,
    ReturnType<typeof listConversationStates>
  >();
  for (const state of input.conversationStates) {
    const phoneNumber = normalizePhoneNumber(state.chatId);
    if (!phoneNumber) {
      continue;
    }

    attachChatId(state.chatId, false);

    if (!conversationsByPhone.has(phoneNumber)) {
      conversationsByPhone.set(phoneNumber, []);
    }

    conversationsByPhone.get(phoneNumber)?.push(state);
  }

  const labeledPhones = new Set<string>();
  for (const chatId of input.labeledChatIds) {
    const phoneNumber = normalizePhoneNumber(chatId);
    if (phoneNumber) {
      labeledPhones.add(phoneNumber);
    }
  }

  const allPhones = new Set<string>();
  for (const phone of incomingSet) allPhones.add(phone);
  for (const phone of knownSet) allPhones.add(phone);
  for (const phone of chatIdsByPhone.keys()) allPhones.add(phone);
  for (const phone of conversationsByPhone.keys()) allPhones.add(phone);
  for (const phone of labeledPhones) allPhones.add(phone);

  const rows: DashboardRow[] = [...allPhones].map((phoneNumber) => {
    const chatIds = [...(chatIdsByPhone.get(phoneNumber) || [])].sort((a, b) =>
      a.localeCompare(b)
    );

    const contact = contactByPhone.get(phoneNumber);
    const firstChatMeta = chatIds.length ? chatNameById.get(chatIds[0]) : null;

    const conversationStates = conversationsByPhone.get(phoneNumber) || [];
    const isInConversation =
      processingSet.has(phoneNumber) ||
      conversationStates.some((state) => !state.isComplete);
    const isConversationComplete = conversationStates.some((state) => state.isComplete);

    const latestActivity = conversationStates.reduce<number>(
      (max, state) => Math.max(max, state.lastActivity),
      0
    );

    const hasLeadLabel = labeledPhones.has(phoneNumber);

    const statusAuto: ManagedNumberStatus = hasLeadLabel
      ? 'selesai_berlabel'
      : isInConversation
        ? 'proses_bot'
        : 'pernah_chat';

    const statusManual = input.statusOverrides[phoneNumber] || null;
    const statusCurrent = statusManual || statusAuto;

    return {
      phoneNumber,
      displayName: contact?.name || firstChatMeta?.name || '-',
      pushName: contact?.pushName || firstChatMeta?.pushName || '-',
      isIncoming: incomingSet.has(phoneNumber),
      isKnown: knownSet.has(phoneNumber),
      fromWahaChat: phoneHasWahaChat.has(phoneNumber),
      chatIds,
      labelNames: hasLeadLabel ? [input.leadLabelName] : [],
      isInConversation,
      isConversationComplete,
      lastActivityAt: latestActivity ? new Date(latestActivity).toISOString() : null,
      statusAuto,
      statusManual,
      statusCurrent,
    };
  });

  const statusOrder: Record<ManagedNumberStatus, number> = {
    proses_bot: 0,
    selesai_berlabel: 1,
    pernah_chat: 2,
  };

  rows.sort((a, b) => {
    const statusDiff = statusOrder[a.statusCurrent] - statusOrder[b.statusCurrent];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return a.phoneNumber.localeCompare(b.phoneNumber);
  });

  return rows;
}

function buildSummary(rows: DashboardRow[]) {
  const pernahChatCount = rows.filter(
    (row) => row.statusCurrent === 'pernah_chat'
  ).length;
  const prosesBotCount = rows.filter(
    (row) => row.statusCurrent === 'proses_bot'
  ).length;
  const selesaiBerlabelCount = rows.filter(
    (row) => row.statusCurrent === 'selesai_berlabel'
  ).length;

  const knownCount = rows.filter((row) => row.isKnown).length;
  const labeledCount = rows.filter((row) => row.labelNames.length > 0).length;

  return {
    totalNumbers: rows.length,
    pernahChatCount,
    prosesBotCount,
    selesaiBerlabelCount,
    knownCount,
    labeledCount,
  };
}

export async function GET() {
  try {
    const [
      incomingNumbers,
      knownNumbers,
      processingNumbers,
      statusOverrides,
      chatsResult,
      contactsResult,
      conversationStates,
      labelsResult,
    ] = await Promise.all([
      fetchIncomingLeadNumbers(400),
      fetchKnownLeadNumbers(400),
      fetchProcessingLeadNumbers(400),
      fetchNumberStatusOverrides(),
      fetchWahaChats(350),
      fetchWahaContacts(700),
      Promise.resolve(listConversationStates()),
      fetchWahaLabels(),
    ]);

    const leadLabel = labelsResult.items.find(
      (label) =>
        label.name.toLowerCase() === WAHA_NEW_LEAD_LABEL_NAME.toLowerCase()
    );

    let labeledChatIds = new Set<string>();
    let labelChatsError: string | null = null;

    if (leadLabel) {
      const labelChatsResult = await fetchChatsByLabelId(leadLabel.id);
      labeledChatIds = labelChatsResult.items;
      labelChatsError = labelChatsResult.error;
    }

    const rows = buildDashboardRows({
      incomingNumbers,
      knownNumbers,
      processingNumbers,
      statusOverrides,
      chats: chatsResult.items,
      contacts: contactsResult.items,
      conversationStates,
      labeledChatIds,
      leadLabelName: WAHA_NEW_LEAD_LABEL_NAME,
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      leadLabelName: WAHA_NEW_LEAD_LABEL_NAME,
      statusOptions: MANAGED_STATUSES.map((status) => ({
        value: status,
        label: statusLabel(status),
      })),
      summary: buildSummary(rows),
      diagnostics: {
        chatsError: chatsResult.error,
        contactsError: contactsResult.error,
        labelsError: labelsResult.error,
        labelChatsError,
      },
      rows,
    });
  } catch (error) {
    console.error('[Dashboard API] Failed to load dashboard data:', error);
    return NextResponse.json(
      {
        error: 'Failed to load dashboard data',
      },
      {
        status: 500,
      }
    );
  }
}

type DashboardMutationBody = {
  action?: string;
  phoneNumber?: string;
  status?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DashboardMutationBody;
    const action = normalizeText(body.action);

    if (!action) {
      return NextResponse.json(
        {
          error: 'action is required',
        },
        { status: 400 }
      );
    }

    if (action === 'clear_all_numbers') {
      const clearedRedis = await clearAllManagedNumbers();
      const clearedConversations = resetAllConversations();

      return NextResponse.json({
        ok: clearedRedis,
        action,
        clearedConversations,
      });
    }

    if (action === 'refetch_contacts') {
      const contactsResult = await fetchWahaContacts(1500);
      if (contactsResult.error) {
        return NextResponse.json(
          {
            ok: false,
            action,
            error: contactsResult.error,
          },
          {
            status: 502,
          }
        );
      }

      const sourceValues = contactsResult.items.map(
        (contact) => contact.number || contact.id
      );
      const addedIncoming = await saveIncomingLeadNumbers(sourceValues);

      return NextResponse.json({
        ok: true,
        action,
        fetchedContacts: contactsResult.items.length,
        addedIncoming,
      });
    }

    const phoneNumber = normalizePhoneNumber(normalizeText(body.phoneNumber));

    if (!phoneNumber) {
      return NextResponse.json(
        {
          error: 'phoneNumber is required for this action',
        },
        { status: 400 }
      );
    }

    if (action === 'mark_known') {
      const ok = await saveKnownLeadNumber(phoneNumber);
      return NextResponse.json({ ok, action, phoneNumber });
    }

    if (action === 'unmark_known') {
      const ok = await removeKnownLeadNumber(phoneNumber);
      return NextResponse.json({ ok, action, phoneNumber });
    }

    if (action === 'set_status') {
      const status = normalizeManagedStatus(normalizeText(body.status));
      if (!status) {
        return NextResponse.json(
          {
            error: 'status is required and must be valid',
          },
          { status: 400 }
        );
      }

      const ok = await setNumberStatusOverride(phoneNumber, status);
      const clearedConversations = resetConversationByPhoneNumber(phoneNumber);

      if (ok && status === 'selesai_berlabel') {
        await saveKnownLeadNumber(phoneNumber);
      }

      if (ok && (status === 'pernah_chat' || status === 'proses_bot')) {
        await removeKnownLeadNumber(phoneNumber);
      }

      return NextResponse.json({
        ok,
        action,
        phoneNumber,
        status,
        clearedConversations,
      });
    }

    if (action === 'clear_status') {
      const ok = await clearNumberStatusOverride(phoneNumber);
      return NextResponse.json({ ok, action, phoneNumber });
    }

    return NextResponse.json(
      {
        error: 'Unsupported action',
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Dashboard API] Mutation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to execute action',
      },
      {
        status: 500,
      }
    );
  }
}
