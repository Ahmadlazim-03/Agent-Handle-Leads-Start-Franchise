'use client';

import Link from 'next/link';
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

type StatusFilter = 'all' | ManagedNumberStatus;
type SourceFilter =
  | 'all'
  | 'incoming'
  | 'known'
  | 'waha_chat'
  | 'in_progress'
  | 'berlabel';

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
    return 'bg-amber-100 text-amber-700 border-amber-300';
  }

  if (status === 'selesai_berlabel') {
    return 'bg-emerald-100 text-emerald-700 border-emerald-300';
  }

  return 'bg-slate-100 text-slate-700 border-slate-300';
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse>(EMPTY_DASHBOARD);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [statusText, setStatusText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [busyActionKey, setBusyActionKey] = useState('');

  const isBulkRunning =
    busyActionKey === 'bulk:clear_all_numbers' ||
    busyActionKey === 'bulk:refetch_contacts';

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

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

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
            ? `Nomor ${phoneNumber} ditandai known.`
            : `Nomor ${phoneNumber} dihapus dari known.`
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
            `Semua nomor berhasil dihapus. Conversation yang direset: ${payload.clearedConversations ?? 0}.`
          );
        } else {
          setStatusText(
            `Fetch ulang kontak berhasil. Kontak terbaca: ${payload.fetchedContacts ?? 0}, nomor ditambahkan: ${payload.addedIncoming ?? 0}.`
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

  const statCards = [
    {
      label: 'Semua Nomor Pernah Chat',
      value: dashboard.summary.totalNumbers,
      tone: 'from-cyan-500 to-blue-600',
    },
    {
      label: 'Sedang Proses Bot',
      value: dashboard.summary.prosesBotCount,
      tone: 'from-amber-500 to-orange-600',
    },
    {
      label: 'Selesai + Berlabel',
      value: dashboard.summary.selesaiBerlabelCount,
      tone: 'from-emerald-500 to-teal-600',
    },
    {
      label: 'Known Leads',
      value: dashboard.summary.knownCount,
      tone: 'from-fuchsia-500 to-pink-600',
    },
  ];

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-100 via-zinc-50 to-slate-200 text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-8 rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="mb-2 inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
                WA Lead Lifecycle
              </p>
              <h1 className="text-3xl font-bold tracking-tight">Dashboard Manajemen Nomor Chat</h1>
              <p className="mt-2 text-sm text-slate-600">
                Tabel terpusat untuk nomor yang pernah chat, sedang diproses bot, atau sudah
                selesai dan berlabel.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleBulkAction('clear_all_numbers')}
                disabled={isBulkRunning || isRefreshing || isLoading}
                className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyActionKey === 'bulk:clear_all_numbers'
                  ? 'Menghapus...'
                  : 'Hapus Semua Nomor'}
              </button>
              <button
                type="button"
                onClick={() => void handleBulkAction('refetch_contacts')}
                disabled={isBulkRunning || isRefreshing || isLoading}
                className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyActionKey === 'bulk:refetch_contacts'
                  ? 'Fetching...'
                  : 'Fetch Ulang Get All Contact'}
              </button>
              <Link
                href="/"
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                Kembali
              </Link>
              <button
                type="button"
                onClick={() => void loadDashboard(true)}
                disabled={isBulkRunning || isRefreshing || isLoading}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="rounded-lg bg-slate-100 px-2 py-1">
              Data terakhir: {formatGeneratedAt(dashboard.generatedAt)}
            </span>
            <span className="rounded-lg bg-slate-100 px-2 py-1">
              Label target: {dashboard.leadLabelName}
            </span>
            <span className="rounded-lg bg-slate-100 px-2 py-1">
              Total berlabel: {dashboard.summary.labeledCount}
            </span>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-2xl bg-linear-to-br ${card.tone} p-5 text-white shadow-md`}
            >
              <p className="text-xs uppercase tracking-[0.15em] text-white/80">{card.label}</p>
              <p className="mt-2 text-3xl font-bold">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search nomor, nama, chatId, label..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-cyan-400 transition focus:ring md:col-span-2"
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-cyan-400 transition focus:ring"
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
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-cyan-400 transition focus:ring"
            >
              <option value="all">Filter Sumber: Semua</option>
              <option value="incoming">Incoming Redis</option>
              <option value="known">Known Leads</option>
              <option value="waha_chat">Ada WAHA Chat</option>
              <option value="in_progress">Sedang Proses Bot</option>
              <option value="berlabel">Sudah Berlabel</option>
            </select>
          </div>

          <div className="mt-3 text-xs text-slate-600">
            Menampilkan {filteredRows.length} dari {dashboard.summary.totalNumbers} nomor.
          </div>

          {statusText ? (
            <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {statusText}
            </p>
          ) : null}

          {errorText ? (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorText}</p>
          ) : null}

          {dashboard.diagnostics.chatsError ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              WAHA chats warning: {dashboard.diagnostics.chatsError}
            </p>
          ) : null}

          {dashboard.diagnostics.contactsError ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              WAHA contacts warning: {dashboard.diagnostics.contactsError}
            </p>
          ) : null}

          {dashboard.diagnostics.labelsError ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              WAHA labels warning: {dashboard.diagnostics.labelsError}
            </p>
          ) : null}

          {dashboard.diagnostics.labelChatsError ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              WAHA label-chats warning: {dashboard.diagnostics.labelChatsError}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Tabel Lifecycle Nomor</h2>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-widest text-slate-500">
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
                    <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                      Memuat data nomor...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                      Tidak ada data yang cocok dengan filter.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const statusBusy = busyActionKey === `status:${row.phoneNumber}`;
                    const markBusy = busyActionKey === `mark_known:${row.phoneNumber}`;
                    const unmarkBusy = busyActionKey === `unmark_known:${row.phoneNumber}`;

                    return (
                      <tr key={row.phoneNumber} className="border-b border-slate-100 align-top">
                        <td className="px-3 py-3 font-semibold text-slate-800">{row.phoneNumber}</td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          <div className="font-medium">{row.displayName || '-'}</div>
                          <div className="text-slate-500">{row.pushName || '-'}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">
                          {row.chatIds.length ? row.chatIds.join(', ') : '-'}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">
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
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
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
                        <td className="px-3 py-3 text-xs text-slate-600">
                          <div>{row.isIncoming ? 'Incoming' : '-'}</div>
                          <div>{row.isKnown ? 'Known' : 'Not Known'}</div>
                          <div>{row.fromWahaChat ? 'WAHA Chat' : '-'}</div>
                          <div>{row.isInConversation ? 'In Progress' : 'Idle'}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">
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
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
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
