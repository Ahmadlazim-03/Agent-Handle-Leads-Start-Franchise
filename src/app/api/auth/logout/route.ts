import { NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE_NAME,
  getAdminSessionCookieOptions,
} from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const url = new URL(request.url);

  const response = NextResponse.json({
    ok: true,
  });

  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: '',
    ...getAdminSessionCookieOptions(url.hostname),
    maxAge: 0,
  });

  return response;
}
