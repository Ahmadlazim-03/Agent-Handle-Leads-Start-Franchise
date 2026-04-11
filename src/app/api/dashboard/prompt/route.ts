import { NextRequest, NextResponse } from 'next/server';
import {
  getRuntimePromptConfig,
  resetRuntimeSystemPrompt,
  saveRuntimeSystemPrompt,
} from '@/lib/prompt-config';
import { createUnauthorizedResponse, isAdminAuthenticated } from '@/lib/admin-auth-guard';
import { DEFAULT_RUNTIME_SYSTEM_PROMPT } from '@/prompts/runtime-system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PromptMutationBody = {
  action?: string;
  prompt?: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validationErrorStatus(errorMessage: string): number {
  if (
    errorMessage.toLowerCase().includes('tidak boleh kosong') ||
    errorMessage.toLowerCase().includes('terlalu panjang')
  ) {
    return 400;
  }

  if (errorMessage.toLowerCase().includes('redis')) {
    return 503;
  }

  return 500;
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return createUnauthorizedResponse();
  }

  try {
    const config = await getRuntimePromptConfig();

    return NextResponse.json({
      ok: true,
      prompt: config.prompt,
      defaultPrompt: DEFAULT_RUNTIME_SYSTEM_PROMPT,
      source: config.source,
      isCustom: config.isCustom,
      updatedAt: config.updatedAt,
      promptLength: config.prompt.length,
    });
  } catch (error) {
    console.error('[Prompt Dashboard API] Failed to load prompt config:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load runtime prompt config',
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
    const body = (await request.json()) as PromptMutationBody;
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

    if (action === 'save') {
      if (typeof body.prompt !== 'string') {
        return NextResponse.json(
          {
            ok: false,
            error: 'prompt is required for save action',
          },
          { status: 400 }
        );
      }

      const result = await saveRuntimeSystemPrompt(body.prompt);
      if (!result.ok || !result.config) {
        const errorMessage = result.error || 'Failed to save prompt';
        return NextResponse.json(
          {
            ok: false,
            error: errorMessage,
          },
          {
            status: validationErrorStatus(errorMessage),
          }
        );
      }

      return NextResponse.json({
        ok: true,
        action,
        prompt: result.config.prompt,
        source: result.config.source,
        isCustom: result.config.isCustom,
        updatedAt: result.config.updatedAt,
        promptLength: result.config.prompt.length,
      });
    }

    if (action === 'reset') {
      const result = await resetRuntimeSystemPrompt();
      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: result.error || 'Failed to reset prompt',
            prompt: result.config.prompt,
            source: result.config.source,
            isCustom: result.config.isCustom,
            updatedAt: result.config.updatedAt,
            promptLength: result.config.prompt.length,
          },
          { status: 503 }
        );
      }

      return NextResponse.json({
        ok: true,
        action,
        prompt: result.config.prompt,
        source: result.config.source,
        isCustom: result.config.isCustom,
        updatedAt: result.config.updatedAt,
        promptLength: result.config.prompt.length,
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
    console.error('[Prompt Dashboard API] Mutation error:', error);
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
