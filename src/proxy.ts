import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSessionToken } from '@/lib/admin-auth';
import {
  ADMIN_DASHBOARD_API_PREFIX,
  ADMIN_DASHBOARD_PATH,
  ADMIN_LOGIN_PATH,
  ADMIN_SESSION_COOKIE_NAME,
} from '@/lib/admin-auth-shared';

function isDashboardPagePath(pathname: string): boolean {
  return pathname === ADMIN_DASHBOARD_PATH || pathname.startsWith(`${ADMIN_DASHBOARD_PATH}/`);
}

function isDashboardApiPath(pathname: string): boolean {
  return pathname === ADMIN_DASHBOARD_API_PREFIX || pathname.startsWith(`${ADMIN_DASHBOARD_API_PREFIX}/`);
}

function hasValidSessionCookie(request: NextRequest): boolean {
  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value || '';
  const token = sessionCookie.trim();
  if (!token) {
    return false;
  }

  return verifyAdminSessionToken(token);
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const loggedIn = hasValidSessionCookie(request);

  if (!loggedIn && isDashboardApiPath(pathname)) {
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

  if (!loggedIn && isDashboardPagePath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = ADMIN_LOGIN_PATH;
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (loggedIn && pathname === ADMIN_LOGIN_PATH) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = ADMIN_DASHBOARD_PATH;
    dashboardUrl.search = '';
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/dashboard/:path*', '/login'],
};
