import { NextRequest, NextResponse } from 'next/server';
import {
  RuntimeEnvKey,
  getRuntimeEnvConfigItems,
  listRuntimeEnvDefinitions,
  resetRuntimeEnvValue,
  saveRuntimeEnvValue,
} from '@/lib/runtime-env';
import { createUnauthorizedResponse, isAdminAuthenticated } from '@/lib/admin-auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RuntimeEnvMutationBody = {
  action?: string;
  key?: string;
  value?: string;
};

const RUNTIME_ENV_KEY_SET = new Set<RuntimeEnvKey>(
  listRuntimeEnvDefinitions().map((item) => item.key)
);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRuntimeEnvKey(value: string): RuntimeEnvKey | null {
  const normalized = value.trim().toUpperCase() as RuntimeEnvKey;
  if (!RUNTIME_ENV_KEY_SET.has(normalized)) {
    return null;
  }

  return normalized;
}

function resolveErrorStatus(message: string): number {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('tidak boleh kosong') ||
    normalized.includes('terlalu panjang') ||
    normalized.includes('unsupported')
  ) {
    return 400;
  }

  if (normalized.includes('redis')) {
    return 503;
  }

  return 500;
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return createUnauthorizedResponse();
  }

  try {
    const items = await getRuntimeEnvConfigItems();

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      items,
    });
  } catch (error) {
    console.error('[Dashboard Runtime Env API] Failed to load runtime env config:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load runtime env config',
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return createUnauthorizedResponse();
  }

  try {
    const body = (await request.json()) as RuntimeEnvMutationBody;
    const action = normalizeText(body.action).toLowerCase();

    if (!action) {
      return NextResponse.json(
        {
          ok: false,
          error: 'action is required',
        },
        { status: 400 }
      );
    }

    const runtimeEnvKey = asRuntimeEnvKey(normalizeText(body.key));
    if (!runtimeEnvKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'key is required and must be supported',
        },
        { status: 400 }
      );
    }

    if (action === 'save') {
      if (typeof body.value !== 'string') {
        return NextResponse.json(
          {
            ok: false,
            error: 'value is required for save action',
          },
          { status: 400 }
        );
      }

      const result = await saveRuntimeEnvValue(runtimeEnvKey, body.value);
      if (!result.ok || !result.item) {
        const message = result.error || 'Failed to save runtime env';
        return NextResponse.json(
          {
            ok: false,
            error: message,
          },
          {
            status: resolveErrorStatus(message),
          }
        );
      }

      return NextResponse.json({
        ok: true,
        action,
        item: result.item,
      });
    }

    if (action === 'reset') {
      const result = await resetRuntimeEnvValue(runtimeEnvKey);
      if (!result.ok || !result.item) {
        const message = result.error || 'Failed to reset runtime env';
        return NextResponse.json(
          {
            ok: false,
            error: message,
          },
          {
            status: resolveErrorStatus(message),
          }
        );
      }

      return NextResponse.json({
        ok: true,
        action,
        item: result.item,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: 'Unsupported action',
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Dashboard Runtime Env API] Mutation error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to execute action',
      },
      {
        status: 500,
      }
    );
  }
}
