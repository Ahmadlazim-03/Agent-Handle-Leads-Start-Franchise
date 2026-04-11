import { NextRequest, NextResponse } from 'next/server';
import { createUnauthorizedResponse, isAdminAuthenticated } from '@/lib/admin-auth-guard';
import {
  clearDashboardLogs,
  listDashboardLogs,
} from '@/lib/dashboard-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readLimit(value: string | null): number {
  const parsed = Number(value || '80');
  if (!Number.isFinite(parsed)) {
    return 80;
  }

  return Math.max(1, Math.min(parsed, 250));
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return createUnauthorizedResponse();
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = readLimit(searchParams.get('limit'));
    const level = searchParams.get('level') || 'all';
    const source = searchParams.get('source') || 'all';
    const search = searchParams.get('q') || '';

    const result = await listDashboardLogs({
      limit,
      level,
      source,
      search,
    });

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      redisAvailable: result.redisAvailable,
      storage: result.storage,
      logs: result.logs,
    });
  } catch (error) {
    console.error('[Dashboard Logs API] Failed to fetch logs:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load dashboard logs.',
      },
      {
        status: 500,
      }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return createUnauthorizedResponse();
  }

  try {
    const result = await clearDashboardLogs();

    return NextResponse.json({
      ok: true,
      removed: result.removed,
      redisAvailable: result.redisAvailable,
      storage: result.storage,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Dashboard Logs API] Failed to clear logs:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to clear dashboard logs.',
      },
      {
        status: 500,
      }
    );
  }
}
