import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  isAdminCredentialValid,
} from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoginBody = {
  username?: string;
  password?: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginBody;
    const username = normalizeText(body.username);
    const password = normalizeText(body.password);

    if (!username || !password) {
      return NextResponse.json(
        {
          ok: false,
          error: 'username dan password wajib diisi.',
        },
        {
          status: 400,
        }
      );
    }

    if (!isAdminCredentialValid(username, password)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Username atau password salah.',
        },
        {
          status: 401,
        }
      );
    }

    const token = createAdminSessionToken();
    const response = NextResponse.json({
      ok: true,
      user: {
        username,
      },
    });

    response.cookies.set({
      name: ADMIN_SESSION_COOKIE_NAME,
      value: token,
      ...getAdminSessionCookieOptions(request.nextUrl.hostname),
    });

    return response;
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Gagal memproses login.',
      },
      {
        status: 500,
      }
    );
  }
}
