'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ManagedNumberStatus = 'pernah_chat' | 'proses_bot' | 'selesai_berlabel';

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

type DashboardResponse = {
  generatedAt: string;
  leadLabelName: string;
  statusOptions: Array<{ value: ManagedNumberStatus; label: string }>;
  summary: {
    totalNumbers: number;
    pernahChatCount: number;
    prosesBotCount: number;
    selesaiBerlabelCount: number;
    knownCount: number;
    labeledCount: number;
  };
  diagnostics: {
    chatsError: string | null;
    contactsError: string | null;
    labelsError: string | null;
    labelChatsError: string | null;
  };
  rows: DashboardRow[];
};

type PromptSource = 'default' | 'redis-custom';

type PromptResponse = {
  ok?: boolean;
  error?: string;
  prompt?: string;
  defaultPrompt?: string;
  source?: PromptSource;
  isCustom?: boolean;
  updatedAt?: string | null;
  promptLength?: number;
};

type IntegrationKey = 'redis' | 'waha' | 'telegram' | 'spreadsheet';

type IntegrationService = {
  key: IntegrationKey;
  label: string;
  connected: boolean;
  configured: boolean;
  message: string;
  latencyMs: number | null;
  checkedAt: string;
};

type IntegrationsResponse = {
  ok?: boolean;
  error?: string;
  checkedAt?: string;
  summary?: {
    connected: number;
    total: number;
  };
  services?: IntegrationService[];
};

type RuntimeEnvSource = 'runtime' | 'env' | 'default';

type RuntimeEnvItem = {
  key: string;
  label: string;
  description: string;
  value: string;
  source: RuntimeEnvSource;
  configured: boolean;
  isSecret: boolean;
  isMultiline: boolean;
  updatedAt: string | null;
};

type RuntimeEnvResponse = {
  ok?: boolean;
  error?: string;
  checkedAt?: string;
  items?: RuntimeEnvItem[];
};

type RuntimeEnvMutationResponse = {
  ok?: boolean;
  error?: string;
  action?: string;
  item?: RuntimeEnvItem;
};

type DashboardLogLevel = 'info' | 'warn' | 'error';

type DashboardLogItem = {
  id: string;
  level: DashboardLogLevel;
  source: string;
  message: string;
  details: string;
  createdAt: string;
};

type DashboardLogsResponse = {
  ok?: boolean;
  error?: string;
  checkedAt?: string;
  redisAvailable?: boolean;
  storage?: 'redis' | 'memory';
  logs?: DashboardLogItem[];
};

const EMPTY_DASHBOARD: DashboardResponse = {
  generatedAt: '',
  leadLabelName: 'Lead Baru',
  statusOptions: [
    { value: 'pernah_chat', label: 'Pernah Chat' },
    { value: 'proses_bot', label: 'Proses Bot' },
    { value: 'selesai_berlabel', label: 'Selesai + Berlabel' },
  ],
  summary: {
    totalNumbers: 0,
    pernahChatCount: 0,
    prosesBotCount: 0,
    selesaiBerlabelCount: 0,
    knownCount: 0,
    labeledCount: 0,
  },
  diagnostics: {
    chatsError: null,
    contactsError: null,
    labelsError: null,
    labelChatsError: null,
  },
  rows: [],
};

const EMPTY_INTEGRATIONS: IntegrationService[] = [
  {
    key: 'redis',
    label: 'Redis',
    connected: false,
    configured: false,
    message: 'Belum dicek.',
    latencyMs: null,
    checkedAt: '',
  },
  {
    key: 'waha',
    label: 'WAHA',
    connected: false,
    configured: false,
    message: 'Belum dicek.',
    latencyMs: null,
    checkedAt: '',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    connected: false,
    configured: false,
    message: 'Belum dicek.',
    latencyMs: null,
    checkedAt: '',
  },
  {
    key: 'spreadsheet',
    label: 'Spreadsheet',
    connected: false,
    configured: false,
    message: 'Belum dicek.',
    latencyMs: null,
    checkedAt: '',
  },
];

type StatusFilter = 'all' | ManagedNumberStatus;
type SourceFilter =
  | 'all'
  | 'incoming'
  | 'known'
  | 'waha_chat'
  | 'in_progress'
  | 'berlabel';

type LogsLevelFilter = 'all' | DashboardLogLevel;

function formatGeneratedAt(value: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('id-ID', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusBadgeClass(status: ManagedNumberStatus): string {
  if (status === 'proses_bot') {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }

  if (status === 'selesai_berlabel') {
    return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }

  return 'bg-zinc-700/50 text-zinc-300 border-zinc-600';
}

function integrationStatusBadgeClass(service: IntegrationService): string {
  if (service.connected) {
    return 'bg-emerald-500/15 text-emerald-300';
  }

  if (!service.configured) {
    return 'bg-amber-500/15 text-amber-300';
  }

  return 'bg-rose-500/15 text-rose-300';
}

function integrationStatusLabel(service: IntegrationService): string {
  if (service.connected) {
    return 'Connected';
  }

  if (!service.configured) {
    return 'Not Configured';
  }

  return 'Disconnected';
}

function runtimeEnvSourceLabel(source: RuntimeEnvSource): string {
  if (source === 'runtime') {
    return 'Runtime Override';
  }

  if (source === 'env') {
    return 'Env Fallback';
  }

  return 'Default Fallback';
}

function logsLevelBadgeClass(level: DashboardLogLevel): string {
  if (level === 'error') {
    return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  }

  if (level === 'warn') {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  }

  return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
}

function logsLevelLabel(level: DashboardLogLevel): string {
  if (level === 'error') {
    return 'ERROR';
  }

  if (level === 'warn') {
    return 'WARN';
  }

  return 'INFO';
}

export default function DashboardPage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardResponse>(EMPTY_DASHBOARD);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [statusText, setStatusText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [busyActionKey, setBusyActionKey] = useState('');
  const [activePrompt, setActivePrompt] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptSource, setPromptSource] = useState<PromptSource>('default');
  const [promptUpdatedAt, setPromptUpdatedAt] = useState<string | null>(null);
  const [isPromptLoading, setIsPromptLoading] = useState(true);
  const [isPromptSaving, setIsPromptSaving] = useState(false);
  const [promptStatusText, setPromptStatusText] = useState('');
  const [promptErrorText, setPromptErrorText] = useState('');
  const [integrations, setIntegrations] = useState<IntegrationService[]>(
    EMPTY_INTEGRATIONS
  );
  const [integrationCheckedAt, setIntegrationCheckedAt] = useState('');
  const [isIntegrationLoading, setIsIntegrationLoading] = useState(true);
  const [integrationErrorText, setIntegrationErrorText] = useState('');
  const [runtimeEnvItems, setRuntimeEnvItems] = useState<RuntimeEnvItem[]>([]);
  const [runtimeEnvDrafts, setRuntimeEnvDrafts] = useState<Record<string, string>>({});
  const [runtimeEnvCheckedAt, setRuntimeEnvCheckedAt] = useState('');
  const [isRuntimeEnvLoading, setIsRuntimeEnvLoading] = useState(true);
  const [runtimeEnvBusyKey, setRuntimeEnvBusyKey] = useState('');
  const [runtimeEnvStatusText, setRuntimeEnvStatusText] = useState('');
  const [runtimeEnvErrorText, setRuntimeEnvErrorText] = useState('');
  const [dashboardLogs, setDashboardLogs] = useState<DashboardLogItem[]>([]);
  const [logCheckedAt, setLogCheckedAt] = useState('');
  const [isLogLoading, setIsLogLoading] = useState(true);
  const [logErrorText, setLogErrorText] = useState('');
  const [logStatusText, setLogStatusText] = useState('');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<LogsLevelFilter>('all');
  const [logStorageMode, setLogStorageMode] = useState<'redis' | 'memory'>('memory');
  const [isLogsClearing, setIsLogsClearing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const isBulkRunning =
    busyActionKey === 'bulk:clear_all_numbers' ||
    busyActionKey === 'bulk:refetch_contacts';
  const isPromptDirty = promptDraft.trim() !== activePrompt.trim();
  const runtimeEnvConnectedCount = runtimeEnvItems.filter(
    (item) => item.configured
  ).length;
  const logErrorCount = dashboardLogs.filter((entry) => entry.level === 'error').length;

  const loadDashboard = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setErrorText('');

    try {
      const response = await fetch('/api/dashboard/numbers', {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json()) as DashboardResponse | { error?: string };

      if (!response.ok) {
        const message =
          typeof (payload as { error?: string })?.error === 'string'
            ? (payload as { error?: string }).error
            : 'Gagal memuat data dashboard.';
        throw new Error(message);
      }

      setDashboard(payload as DashboardResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terjadi kesalahan.';
      setErrorText(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadPromptConfig = useCallback(async (showRefreshing = false) => {
    if (!showRefreshing) {
      setIsPromptLoading(true);
    }

    setPromptErrorText('');

    try {
      const response = await fetch('/api/dashboard/prompt', {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json()) as PromptResponse;

      if (!response.ok || !payload.ok || typeof payload.prompt !== 'string') {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal memuat prompt AI.';
        throw new Error(message);
      }

      const loadedPrompt = payload.prompt;

      setActivePrompt(loadedPrompt);
      setPromptDraft(loadedPrompt);
      setDefaultPrompt(typeof payload.defaultPrompt === 'string' ? payload.defaultPrompt : '');
      setPromptSource(payload.source === 'redis-custom' ? 'redis-custom' : 'default');
      setPromptUpdatedAt(payload.updatedAt ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memuat prompt AI.';
      setPromptErrorText(message);
    } finally {
      setIsPromptLoading(false);
    }
  }, []);

  const loadIntegrationStatus = useCallback(async () => {
    setIsIntegrationLoading(true);
    setIntegrationErrorText('');

    try {
      const response = await fetch('/api/dashboard/integrations', {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json()) as IntegrationsResponse;

      if (!response.ok || !payload.ok || !Array.isArray(payload.services)) {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal memuat status koneksi integrasi.';
        throw new Error(message);
      }

      setIntegrations(payload.services);
      setIntegrationCheckedAt(
        typeof payload.checkedAt === 'string'
          ? payload.checkedAt
          : new Date().toISOString()
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Gagal memuat status koneksi integrasi.';
      setIntegrationErrorText(message);
    } finally {
      setIsIntegrationLoading(false);
    }
  }, []);

  const loadRuntimeEnvConfig = useCallback(async () => {
    setIsRuntimeEnvLoading(true);
    setRuntimeEnvErrorText('');

    try {
      const response = await fetch('/api/dashboard/env', {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json()) as RuntimeEnvResponse;

      if (!response.ok || !payload.ok || !Array.isArray(payload.items)) {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal memuat runtime env config.';
        throw new Error(message);
      }

      setRuntimeEnvItems(payload.items);
      setRuntimeEnvDrafts(
        payload.items.reduce<Record<string, string>>((acc, item) => {
          acc[item.key] = item.value;
          return acc;
        }, {})
      );
      setRuntimeEnvCheckedAt(
        typeof payload.checkedAt === 'string'
          ? payload.checkedAt
          : new Date().toISOString()
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Gagal memuat runtime env config.';
      setRuntimeEnvErrorText(message);
    } finally {
      setIsRuntimeEnvLoading(false);
    }
  }, []);

  const loadDashboardLogs = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLogLoading(true);
    }

    setLogErrorText('');

    try {
      const response = await fetch('/api/dashboard/logs?limit=160', {
        method: 'GET',
        cache: 'no-store',
      });

      const payload = (await response.json()) as DashboardLogsResponse;

      if (!response.ok || !payload.ok || !Array.isArray(payload.logs)) {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal memuat dashboard logs.';
        throw new Error(message);
      }

      setDashboardLogs(payload.logs);
      setLogStorageMode(payload.storage === 'redis' ? 'redis' : 'memory');
      setLogCheckedAt(
        typeof payload.checkedAt === 'string'
          ? payload.checkedAt
          : new Date().toISOString()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal memuat dashboard logs.';
      setLogErrorText(message);
    } finally {
      setIsLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      loadDashboard(false),
      loadPromptConfig(false),
      loadIntegrationStatus(),
      loadRuntimeEnvConfig(),
      loadDashboardLogs(),
    ]);
  }, [
    loadDashboard,
    loadPromptConfig,
    loadIntegrationStatus,
    loadRuntimeEnvConfig,
    loadDashboardLogs,
  ]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadDashboardLogs(false);
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, [loadDashboardLogs]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return dashboard.rows.filter((row) => {
      if (statusFilter !== 'all' && row.statusCurrent !== statusFilter) {
        return false;
      }

      if (sourceFilter === 'incoming' && !row.isIncoming) {
        return false;
      }

      if (sourceFilter === 'known' && !row.isKnown) {
        return false;
      }

      if (sourceFilter === 'waha_chat' && !row.fromWahaChat) {
        return false;
      }

      if (sourceFilter === 'in_progress' && !row.isInConversation) {
        return false;
      }

      if (sourceFilter === 'berlabel' && row.labelNames.length === 0) {
        return false;
      }

      if (!query) {
        return true;
      }

      const inChatId = row.chatIds.some((chatId) => chatId.toLowerCase().includes(query));
      const inLabels = row.labelNames.some((label) => label.toLowerCase().includes(query));

      return (
        row.phoneNumber.includes(query) ||
        row.displayName.toLowerCase().includes(query) ||
        row.pushName.toLowerCase().includes(query) ||
        inChatId ||
        inLabels
      );
    });
  }, [dashboard.rows, searchQuery, sourceFilter, statusFilter]);

  const filteredLogs = useMemo(() => {
    const query = logSearchQuery.trim().toLowerCase();

    return dashboardLogs.filter((entry) => {
      if (logLevelFilter !== 'all' && entry.level !== logLevelFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        entry.message.toLowerCase().includes(query) ||
        entry.details.toLowerCase().includes(query) ||
        entry.source.toLowerCase().includes(query)
      );
    });
  }, [dashboardLogs, logLevelFilter, logSearchQuery]);

  const handleClearDashboardLogs = useCallback(async () => {
    const approved = window.confirm('Hapus semua dashboard logs yang tersimpan?');
    if (!approved) {
      return;
    }

    setIsLogsClearing(true);
    setLogStatusText('');
    setLogErrorText('');

    try {
      const response = await fetch('/api/dashboard/logs', {
        method: 'DELETE',
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        removed?: number;
      };

      if (!response.ok || !payload.ok) {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal menghapus dashboard logs.';
        throw new Error(message);
      }

      setLogStatusText(`Dashboard logs dibersihkan. Item terhapus: ${payload.removed ?? 0}.`);
      await loadDashboardLogs(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Gagal menghapus dashboard logs.';
      setLogErrorText(message);
    } finally {
      setIsLogsClearing(false);
    }
  }, [loadDashboardLogs]);

  const handleKnownMutation = useCallback(
    async (action: 'mark_known' | 'unmark_known', phoneNumber: string) => {
      const key = `${action}:${phoneNumber}`;
      setBusyActionKey(key);
      setStatusText('');
      setErrorText('');

      try {
        const response = await fetch('/api/dashboard/numbers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action,
            phoneNumber,
          }),
        });

        const payload = (await response.json()) as { ok?: boolean; error?: string };

        if (!response.ok || !payload.ok) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : 'Aksi gagal diproses. Pastikan Redis tersedia.';
          throw new Error(message);
        }

        setStatusText(
          action === 'mark_known'
            ? `Nomor ${phoneNumber} ditandai known dan state percakapan direset.`
            : `Nomor ${phoneNumber} ditandai unknown (force pernah_chat) dan state percakapan direset.`
        );
        await loadDashboard(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Aksi gagal.';
        setErrorText(message);
      } finally {
        setBusyActionKey('');
      }
    },
    [loadDashboard]
  );

  const handleStatusOverride = useCallback(
    async (phoneNumber: string, target: string) => {
      const key = `status:${phoneNumber}`;
      setBusyActionKey(key);
      setStatusText('');
      setErrorText('');

      try {
        const isAuto = target === 'auto';

        const response = await fetch('/api/dashboard/numbers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            isAuto
              ? {
                  action: 'clear_status',
                  phoneNumber,
                }
              : {
                  action: 'set_status',
                  phoneNumber,
                  status: target,
                }
          ),
        });

        const payload = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : 'Gagal mengubah status nomor.';
          throw new Error(message);
        }

        setStatusText(
          isAuto
            ? `Status manual ${phoneNumber} dikembalikan ke mode otomatis.`
            : `Status ${phoneNumber} diubah menjadi ${target}.`
        );

        await loadDashboard(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Gagal ubah status.';
        setErrorText(message);
      } finally {
        setBusyActionKey('');
      }
    },
    [loadDashboard]
  );

  const handleBulkAction = useCallback(
    async (action: 'clear_all_numbers' | 'refetch_contacts') => {
      if (action === 'clear_all_numbers') {
        const approved = window.confirm(
          'Hapus semua data nomor (incoming, known, processing, override status) dan reset semua conversation state?'
        );

        if (!approved) {
          return;
        }
      }

      const key = `bulk:${action}`;
      setBusyActionKey(key);
      setStatusText('');
      setErrorText('');

      try {
        const response = await fetch('/api/dashboard/numbers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action }),
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          fetchedContacts?: number;
          addedIncoming?: number;
          addedKnown?: number;
          clearedConversations?: number;
        };

        if (!response.ok || !payload.ok) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : 'Aksi bulk gagal diproses.';
          throw new Error(message);
        }

        if (action === 'clear_all_numbers') {
          setStatusText(
            `Semua nomor Redis berhasil direset. Conversation yang direset: ${payload.clearedConversations ?? 0}. Catatan: riwayat WAHA tetap ada, aktifkan mode test bila ingin nomor lama tetap dibalas.`
          );
        } else {
          setStatusText(
            `Fetch kontak berhasil. Kontak terbaca: ${payload.fetchedContacts ?? 0}, ditambahkan ke incoming: ${payload.addedIncoming ?? 0}, ditambahkan ke known: ${payload.addedKnown ?? 0}.`
          );
        }

        await loadDashboard(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Aksi bulk gagal.';
        setErrorText(message);
      } finally {
        setBusyActionKey('');
      }
    },
    [loadDashboard]
  );

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      router.replace('/login');
      router.refresh();
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, router]);

  const handleSavePrompt = useCallback(async () => {
    setIsPromptSaving(true);
    setPromptStatusText('');
    setPromptErrorText('');

    try {
      const response = await fetch('/api/dashboard/prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'save',
          prompt: promptDraft,
        }),
      });

      const payload = (await response.json()) as PromptResponse;
      if (!response.ok || !payload.ok || typeof payload.prompt !== 'string') {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal menyimpan prompt AI.';
        throw new Error(message);
      }

      const savedPrompt = payload.prompt;

      setActivePrompt(savedPrompt);
      setPromptDraft(savedPrompt);
      setPromptSource(payload.source === 'redis-custom' ? 'redis-custom' : 'default');
      setPromptUpdatedAt(payload.updatedAt ?? null);
      setPromptStatusText('Prompt AI berhasil disimpan dan langsung menjadi prompt aktif.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Gagal menyimpan prompt AI.';
      setPromptErrorText(message);
    } finally {
      setIsPromptSaving(false);
    }
  }, [promptDraft]);

  const handleResetPromptToDefault = useCallback(async () => {
    const approved = window.confirm(
      'Reset prompt AI ke default bawaan? Prompt custom saat ini akan dihapus dari Redis.'
    );

    if (!approved) {
      return;
    }

    setIsPromptSaving(true);
    setPromptStatusText('');
    setPromptErrorText('');

    try {
      const response = await fetch('/api/dashboard/prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'reset',
        }),
      });

      const payload = (await response.json()) as PromptResponse;
      if (!response.ok || !payload.ok || typeof payload.prompt !== 'string') {
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : 'Gagal reset prompt AI.';
        throw new Error(message);
      }

      const resetPrompt = payload.prompt;

      setActivePrompt(resetPrompt);
      setPromptDraft(resetPrompt);
      setPromptSource(payload.source === 'redis-custom' ? 'redis-custom' : 'default');
      setPromptUpdatedAt(payload.updatedAt ?? null);
      setPromptStatusText('Prompt AI berhasil direset ke default bawaan.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal reset prompt AI.';
      setPromptErrorText(message);
    } finally {
      setIsPromptSaving(false);
    }
  }, []);

  const isRuntimeEnvDirty = useCallback(
    (item: RuntimeEnvItem) => {
      const draftValue = runtimeEnvDrafts[item.key] ?? '';
      return draftValue !== item.value;
    },
    [runtimeEnvDrafts]
  );

  const handleRuntimeEnvDraftChange = useCallback((key: string, value: string) => {
    setRuntimeEnvDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleSaveRuntimeEnv = useCallback(
    async (item: RuntimeEnvItem) => {
      const draftValue = runtimeEnvDrafts[item.key] ?? '';
      const busyKey = `save:${item.key}`;

      setRuntimeEnvBusyKey(busyKey);
      setRuntimeEnvStatusText('');
      setRuntimeEnvErrorText('');

      try {
        const response = await fetch('/api/dashboard/env', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'save',
            key: item.key,
            value: draftValue,
          }),
        });

        const payload = (await response.json()) as RuntimeEnvMutationResponse;
        if (!response.ok || !payload.ok || !payload.item) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : `Gagal menyimpan ${item.key}.`;
          throw new Error(message);
        }

        const updatedItem = payload.item;
        setRuntimeEnvItems((current) =>
          current.map((entry) => (entry.key === updatedItem.key ? updatedItem : entry))
        );
        setRuntimeEnvDrafts((current) => ({
          ...current,
          [updatedItem.key]: updatedItem.value,
        }));
        setRuntimeEnvCheckedAt(new Date().toISOString());
        setRuntimeEnvStatusText(
          `Konfigurasi ${updatedItem.key} berhasil disimpan dan langsung aktif.`
        );

        await Promise.all([loadIntegrationStatus(), loadDashboard(true)]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `Gagal menyimpan ${item.key}.`;
        setRuntimeEnvErrorText(message);
      } finally {
        setRuntimeEnvBusyKey('');
      }
    },
    [loadDashboard, loadIntegrationStatus, runtimeEnvDrafts]
  );

  const handleResetRuntimeEnv = useCallback(
    async (item: RuntimeEnvItem) => {
      const approved = window.confirm(
        `Reset ${item.key} ke fallback ENV/Default? Override runtime di Redis akan dihapus.`
      );

      if (!approved) {
        return;
      }

      const busyKey = `reset:${item.key}`;
      setRuntimeEnvBusyKey(busyKey);
      setRuntimeEnvStatusText('');
      setRuntimeEnvErrorText('');

      try {
        const response = await fetch('/api/dashboard/env', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'reset',
            key: item.key,
          }),
        });

        const payload = (await response.json()) as RuntimeEnvMutationResponse;
        if (!response.ok || !payload.ok || !payload.item) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : `Gagal reset ${item.key}.`;
          throw new Error(message);
        }

        const updatedItem = payload.item;
        setRuntimeEnvItems((current) =>
          current.map((entry) => (entry.key === updatedItem.key ? updatedItem : entry))
        );
        setRuntimeEnvDrafts((current) => ({
          ...current,
          [updatedItem.key]: updatedItem.value,
        }));
        setRuntimeEnvCheckedAt(new Date().toISOString());
        setRuntimeEnvStatusText(
          `Konfigurasi ${updatedItem.key} direset ke ${runtimeEnvSourceLabel(updatedItem.source)}.`
        );

        await Promise.all([loadIntegrationStatus(), loadDashboard(true)]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : `Gagal reset ${item.key}.`;
        setRuntimeEnvErrorText(message);
      } finally {
        setRuntimeEnvBusyKey('');
      }
    },
    [loadDashboard, loadIntegrationStatus]
  );

  const statCards = [
    {
      label: 'Semua Nomor Pernah Chat',
      value: dashboard.summary.totalNumbers,
      tone: 'from-indigo-600/80 to-blue-600/80 border-indigo-500/30',
      icon: '💬',
    },
    {
      label: 'Sedang Proses Bot',
      value: dashboard.summary.prosesBotCount,
      tone: 'from-amber-600/80 to-orange-600/80 border-amber-500/30',
      icon: '⚡',
    },
    {
      label: 'Selesai + Berlabel',
      value: dashboard.summary.selesaiBerlabelCount,
      tone: 'from-emerald-600/80 to-teal-600/80 border-emerald-500/30',
      icon: '✅',
    },
    {
      label: 'Known Leads',
      value: dashboard.summary.knownCount,
      tone: 'from-fuchsia-600/80 to-pink-600/80 border-fuchsia-500/30',
      icon: '👤',
    },
  ];

  return (
    <div className="min-h-screen text-zinc-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="glass-card mb-8 rounded-3xl p-6 glow-accent">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="mb-2 inline-flex rounded-full bg-indigo-600/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                WA Lead Lifecycle
              </span>
              <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard Manajemen Nomor Chat</h1>
              <p className="mt-2 text-sm text-zinc-400">
                Tabel terpusat untuk nomor yang pernah chat, sedang diproses bot, atau sudah
                selesai dan berlabel.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleBulkAction('clear_all_numbers')}
                disabled={isBulkRunning || isRefreshing || isLoading || isLoggingOut}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyActionKey === 'bulk:clear_all_numbers'
                  ? 'Menghapus...'
                  : 'Reset Semua Nomor Redis'}
              </button>
              <button
                type="button"
                onClick={() => void handleBulkAction('refetch_contacts')}
                disabled={isBulkRunning || isRefreshing || isLoading || isLoggingOut}
                className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyActionKey === 'bulk:refetch_contacts'
                  ? 'Fetching...'
                  : 'Fetch Kontak -> Simpan Redis'}
              </button>
              <Link
                href="/"
                className="rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
              >
                Kembali
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
                className="rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoggingOut ? 'Logging out...' : 'Logout'}
              </button>
              <button
                type="button"
                onClick={() =>
                  void Promise.all([
                    loadDashboard(true),
                    loadPromptConfig(true),
                    loadIntegrationStatus(),
                    loadRuntimeEnvConfig(),
                    loadDashboardLogs(false),
                  ])
                }
                disabled={
                  isBulkRunning ||
                  isRefreshing ||
                  isLoading ||
                  isPromptLoading ||
                  isIntegrationLoading ||
                  isRuntimeEnvLoading ||
                  isLogLoading ||
                  isLogsClearing ||
                  isLoggingOut
                }
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshing ||
                isPromptLoading ||
                isIntegrationLoading ||
                isRuntimeEnvLoading ||
                isLogLoading
                  ? 'Refreshing...'
                  : 'Refresh Data'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <span className="rounded-lg bg-zinc-800 px-2 py-1">
              Data terakhir: {formatGeneratedAt(dashboard.generatedAt)}
            </span>
            <span className="rounded-lg bg-zinc-800 px-2 py-1">
              Label target: {dashboard.leadLabelName}
            </span>
            <span className="rounded-lg bg-zinc-800 px-2 py-1">
              Total berlabel: {dashboard.summary.labeledCount}
            </span>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-2xl border bg-gradient-to-br ${card.tone} p-5 text-white shadow-lg`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.15em] text-white/70">{card.label}</p>
                <span className="text-lg">{card.icon}</span>
              </div>
              <p className="mt-2 text-3xl font-bold">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 glass-card rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex rounded-full bg-indigo-600/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
                Integrations Health
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Status Koneksi Layanan
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Cek koneksi real-time untuk Redis, WAHA, Telegram, dan Spreadsheet.
                Gunakan panel ini untuk memastikan semua integrasi aktif sebelum run
                bot production.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-lg bg-zinc-800 px-2 py-1 font-semibold">
                Terhubung: {integrations.filter((service) => service.connected).length}/
                {integrations.length}
              </span>
              <span className="rounded-lg bg-zinc-800 px-2 py-1">
                Dicek: {formatGeneratedAt(integrationCheckedAt)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {integrations.map((service) => (
              <div
                key={service.key}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{service.label}</p>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${integrationStatusBadgeClass(
                      service
                    )}`}
                  >
                    {integrationStatusLabel(service)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{service.message}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                  {service.latencyMs === null
                    ? 'Latency: -'
                    : `Latency: ${service.latencyMs} ms`}
                </p>
              </div>
            ))}
          </div>

          {integrationErrorText ? (
            <p className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-300">
              {integrationErrorText}
            </p>
          ) : null}
        </div>

        <div className="mb-6 glass-card rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex rounded-full bg-indigo-600/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
                Runtime Logs
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">Logs Aktivitas Bot</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Monitoring event webhook, notifikasi Telegram, dan penulisan Spreadsheet
                secara real-time untuk mempercepat debugging production.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-lg bg-zinc-800 px-2 py-1 font-semibold">
                Total: {dashboardLogs.length}
              </span>
              <span className="rounded-lg bg-rose-500/15 px-2 py-1 font-semibold text-rose-300">
                Error: {logErrorCount}
              </span>
              <span className="rounded-lg bg-zinc-800 px-2 py-1 font-semibold">
                Storage: {logStorageMode === 'redis' ? 'Redis' : 'Memory'}
              </span>
              <span className="rounded-lg bg-zinc-800 px-2 py-1">
                Dicek: {formatGeneratedAt(logCheckedAt)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
            <input
              value={logSearchQuery}
              onChange={(event) => setLogSearchQuery(event.target.value)}
              placeholder="Cari source, message, atau detail..."
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-100 outline-none ring-indigo-500/40 transition focus:ring md:col-span-2"
            />

            <select
              value={logLevelFilter}
              onChange={(event) => setLogLevelFilter(event.target.value as LogsLevelFilter)}
              className="rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 outline-none ring-indigo-500/40 transition focus:ring"
            >
              <option value="all">Semua Level</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
            </select>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadDashboardLogs(false)}
                disabled={isLogLoading || isLogsClearing}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLogLoading ? 'Loading...' : 'Refresh Logs'}
              </button>
              <button
                type="button"
                onClick={() => void handleClearDashboardLogs()}
                disabled={isLogLoading || isLogsClearing}
                className="w-full rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLogsClearing ? 'Clearing...' : 'Clear Logs'}
              </button>
            </div>
          </div>

          {logStatusText ? (
            <p className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-300">
              {logStatusText}
            </p>
          ) : null}

          {logErrorText ? (
            <p className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-300">
              {logErrorText}
            </p>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800 bg-slate-950">
            <div className="max-h-[440px] overflow-y-auto">
              {isLogLoading ? (
                <p className="px-4 py-10 text-center text-sm text-zinc-400">Memuat logs...</p>
              ) : filteredLogs.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-zinc-500">
                  Tidak ada log yang cocok dengan filter saat ini.
                </p>
              ) : (
                <div className="divide-y divide-slate-800">
                  {filteredLogs.map((entry) => (
                    <div key={entry.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded-full border px-2 py-1 font-semibold ${logsLevelBadgeClass(
                            entry.level
                          )}`}
                        >
                          {logsLevelLabel(entry.level)}
                        </span>
                        <span className="rounded-full bg-slate-800 px-2 py-1 font-semibold uppercase tracking-wide text-slate-200">
                          {entry.source}
                        </span>
                        <span className="text-zinc-500">{formatGeneratedAt(entry.createdAt)}</span>
                      </div>

                      <p className="mt-2 font-mono text-[13px] leading-6 text-slate-100">
                        {entry.message}
                      </p>

                      {entry.details ? (
                        <details className="mt-2 rounded-lg border border-slate-800 bg-slate-900/80 p-2">
                          <summary className="cursor-pointer text-xs font-semibold text-zinc-400">
                            Detail
                          </summary>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-zinc-400">
                            {entry.details}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6 glass-card rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex rounded-full bg-indigo-600/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
                AI Prompt Editor
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">Edit Prompt Runtime AI</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Perubahan prompt di panel ini hanya mempengaruhi gaya dan strategi balasan AI.
                Core logic seperti penyimpanan spreadsheet, notifikasi Telegram, labeling WAHA,
                dan lifecycle lead tetap menggunakan flow existing.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span
                className={`rounded-lg px-2 py-1 font-semibold ${
                  promptSource === 'redis-custom'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                Source: {promptSource === 'redis-custom' ? 'Custom (Redis)' : 'Default'}
              </span>
              <span className="rounded-lg bg-zinc-800 px-2 py-1">
                Updated: {formatGeneratedAt(promptUpdatedAt || '')}
              </span>
              <span className="rounded-lg bg-zinc-800 px-2 py-1">
                Panjang: {promptDraft.length} karakter
              </span>
            </div>
          </div>

          <div className="mt-4">
            <textarea
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              placeholder="Masukkan prompt runtime AI di sini..."
              disabled={isPromptLoading || isPromptSaving}
              className="min-h-70 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-3 font-mono text-sm leading-6 text-white outline-none ring-indigo-500/40 transition focus:ring disabled:cursor-not-allowed disabled:bg-zinc-900/50"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadPromptConfig(true)}
                disabled={isPromptLoading || isPromptSaving}
                className="rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Muat Ulang Prompt
              </button>
              <button
                type="button"
                onClick={() => setPromptDraft(activePrompt)}
                disabled={isPromptLoading || isPromptSaving || !isPromptDirty}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset Draft
              </button>
              <button
                type="button"
                onClick={() => void handleResetPromptToDefault()}
                disabled={isPromptLoading || isPromptSaving}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPromptSaving ? 'Memproses...' : 'Reset ke Default'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleSavePrompt()}
              disabled={isPromptLoading || isPromptSaving || !isPromptDirty}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPromptSaving ? 'Menyimpan...' : 'Simpan Prompt'}
            </button>
          </div>

          {promptStatusText ? (
            <p className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-300">
              {promptStatusText}
            </p>
          ) : null}

          {promptErrorText ? (
            <p className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-300">
              {promptErrorText}
            </p>
          ) : null}

          {!defaultPrompt ? null : (
            <details className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-300">
                Lihat Prompt Default
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-zinc-300">
                {defaultPrompt}
              </pre>
            </details>
          )}
        </div>

        <div className="mb-6 glass-card rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex rounded-full bg-indigo-600/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
                Runtime Env Editor
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Edit Konfigurasi .env Secara Live
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Panel ini menyimpan override config di Redis, sehingga perubahan key dapat
                langsung dipakai runtime tanpa deploy ulang. Saat reset, nilai kembali ke
                fallback ENV atau default.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="rounded-lg bg-zinc-800 px-2 py-1 font-semibold">
                Configured: {runtimeEnvConnectedCount}/{runtimeEnvItems.length}
              </span>
              <span className="rounded-lg bg-zinc-800 px-2 py-1">
                Dicek: {formatGeneratedAt(runtimeEnvCheckedAt)}
              </span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {runtimeEnvItems.map((item) => {
              const saveBusy = runtimeEnvBusyKey === `save:${item.key}`;
              const resetBusy = runtimeEnvBusyKey === `reset:${item.key}`;
              const itemBusy = saveBusy || resetBusy;
              const draftValue = runtimeEnvDrafts[item.key] ?? '';
              const isDirty = isRuntimeEnvDirty(item);

              return (
                <div
                  key={item.key}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <p className="text-xs text-zinc-500">{item.key}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        item.source === 'runtime'
                          ? 'bg-emerald-100 text-emerald-700'
                          : item.source === 'env'
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {runtimeEnvSourceLabel(item.source)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-slate-600">{item.description}</p>

                  <div className="mt-3">
                    {item.isMultiline ? (
                      <textarea
                        value={draftValue}
                        onChange={(event) =>
                          handleRuntimeEnvDraftChange(item.key, event.target.value)
                        }
                        disabled={isRuntimeEnvLoading || itemBusy}
                        className="min-h-32 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 font-mono text-xs leading-5 text-white outline-none ring-indigo-500/40 transition focus:ring disabled:cursor-not-allowed disabled:bg-zinc-800"
                      />
                    ) : (
                      <input
                        value={draftValue}
                        onChange={(event) =>
                          handleRuntimeEnvDraftChange(item.key, event.target.value)
                        }
                        disabled={isRuntimeEnvLoading || itemBusy}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 font-mono text-xs text-white outline-none ring-indigo-500/40 transition focus:ring disabled:cursor-not-allowed disabled:bg-zinc-800"
                      />
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-zinc-500">
                      Updated: {formatGeneratedAt(item.updatedAt || '')}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleResetRuntimeEnv(item)}
                        disabled={isRuntimeEnvLoading || itemBusy}
                        className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resetBusy ? 'Resetting...' : 'Reset'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveRuntimeEnv(item)}
                        disabled={isRuntimeEnvLoading || itemBusy || !isDirty}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saveBusy ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {runtimeEnvStatusText ? (
            <p className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-300">
              {runtimeEnvStatusText}
            </p>
          ) : null}

          {runtimeEnvErrorText ? (
            <p className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-300">
              {runtimeEnvErrorText}
            </p>
          ) : null}
        </div>

        <div className="mb-6 glass-card rounded-2xl p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search nomor, nama, chatId, label..."
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-sm text-zinc-100 outline-none ring-indigo-500/40 transition focus:ring md:col-span-2"
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 outline-none ring-indigo-500/40 transition focus:ring"
            >
              <option value="all">Filter Status: Semua</option>
              {dashboard.statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
              className="rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 outline-none ring-indigo-500/40 transition focus:ring"
            >
              <option value="all">Filter Sumber: Semua</option>
              <option value="incoming">Incoming Redis</option>
              <option value="known">Known Leads</option>
              <option value="waha_chat">Ada WAHA Chat</option>
              <option value="in_progress">Sedang Proses Bot</option>
              <option value="berlabel">Sudah Berlabel</option>
            </select>
          </div>

          <div className="mt-3 text-xs text-zinc-400">
            Menampilkan {filteredRows.length} dari {dashboard.summary.totalNumbers} nomor.
          </div>

          {statusText ? (
            <p className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-300">
              {statusText}
            </p>
          ) : null}

          {errorText ? (
            <p className="mt-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-300">{errorText}</p>
          ) : null}

          {dashboard.diagnostics.chatsError ? (
            <p className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-300">
              WAHA chats warning: {dashboard.diagnostics.chatsError}
            </p>
          ) : null}

          {dashboard.diagnostics.contactsError ? (
            <p className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-300">
              WAHA contacts warning: {dashboard.diagnostics.contactsError}
            </p>
          ) : null}

          {dashboard.diagnostics.labelsError ? (
            <p className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-300">
              WAHA labels warning: {dashboard.diagnostics.labelsError}
            </p>
          ) : null}

          {dashboard.diagnostics.labelChatsError ? (
            <p className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-300">
              WAHA label-chats warning: {dashboard.diagnostics.labelChatsError}
            </p>
          ) : null}
        </div>

        <div className="glass-card rounded-2xl p-4">
          <h2 className="mb-3 text-lg font-semibold">Tabel Lifecycle Nomor</h2>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-widest text-zinc-500">
                  <th className="px-3 py-3">Nomor</th>
                  <th className="px-3 py-3">Kontak</th>
                  <th className="px-3 py-3">Chat IDs</th>
                  <th className="px-3 py-3">Label</th>
                  <th className="px-3 py-3">Status Otomatis</th>
                  <th className="px-3 py-3">Status Aktif</th>
                  <th className="px-3 py-3">Sumber/Flag</th>
                  <th className="px-3 py-3">Last Activity</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                      Memuat data nomor...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                      Tidak ada data yang cocok dengan filter.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const statusBusy = busyActionKey === `status:${row.phoneNumber}`;
                    const markBusy = busyActionKey === `mark_known:${row.phoneNumber}`;
                    const unmarkBusy = busyActionKey === `unmark_known:${row.phoneNumber}`;

                    return (
                      <tr key={row.phoneNumber} className="border-b border-zinc-800/50 align-top">
                        <td className="px-3 py-3 font-semibold text-zinc-200">{row.phoneNumber}</td>
                        <td className="px-3 py-3 text-xs text-zinc-300">
                          <div className="font-medium">{row.displayName || '-'}</div>
                          <div className="text-zinc-500">{row.pushName || '-'}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-zinc-400">
                          {row.chatIds.length ? row.chatIds.join(', ') : '-'}
                        </td>
                        <td className="px-3 py-3 text-xs text-zinc-300">
                          {row.labelNames.length ? row.labelNames.join(', ') : '-'}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(
                              row.statusAuto
                            )}`}
                          >
                            {dashboard.statusOptions.find((s) => s.value === row.statusAuto)?.label}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-2">
                            <span
                              className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(
                                row.statusCurrent
                              )}`}
                            >
                              {dashboard.statusOptions.find((s) => s.value === row.statusCurrent)?.label}
                            </span>
                            <select
                              value={row.statusManual ?? 'auto'}
                              disabled={statusBusy || isBulkRunning}
                              onChange={(event) =>
                                void handleStatusOverride(row.phoneNumber, event.target.value)
                              }
                              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-200"
                            >
                              <option value="auto">Auto</option>
                              {dashboard.statusOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  Manual: {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-zinc-400">
                          <div>{row.isIncoming ? 'Incoming' : '-'}</div>
                          <div>{row.isKnown ? 'Known' : 'Not Known'}</div>
                          <div>{row.fromWahaChat ? 'WAHA Chat' : '-'}</div>
                          <div>{row.isInConversation ? 'In Progress' : 'Idle'}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-zinc-400">
                          {formatGeneratedAt(row.lastActivityAt || '')}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="inline-flex flex-col gap-2">
                            {row.isKnown ? (
                              <button
                                type="button"
                                disabled={unmarkBusy || isBulkRunning}
                                onClick={() =>
                                  void handleKnownMutation('unmark_known', row.phoneNumber)
                                }
                                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {unmarkBusy ? 'Memproses...' : 'Unmark Known'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={markBusy || isBulkRunning}
                                onClick={() =>
                                  void handleKnownMutation('mark_known', row.phoneNumber)
                                }
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {markBusy ? 'Memproses...' : 'Mark Known'}
                              </button>
                            )}
                            <a
                              href={`https://wa.me/${row.phoneNumber}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-center text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800"
                            >
                              Buka WA
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
