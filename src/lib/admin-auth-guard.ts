import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSessionToken } from '@/lib/admin-auth';
import { ADMIN_SESSION_COOKIE_NAME } from '@/lib/admin-auth-shared';

export function isAdminAuthenticated(request: NextRequest): boolean {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value || '';
  if (!token) {
    return false;
  }

  return verifyAdminSessionToken(token);
}

export function createUnauthorizedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Unauthorized',
    },
    {
      status: 401,
    }
  );
}
