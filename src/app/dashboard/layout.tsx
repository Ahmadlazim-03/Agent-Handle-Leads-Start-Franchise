import { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminSessionToken } from '@/lib/admin-auth';
import {
  ADMIN_LOGIN_PATH,
  ADMIN_SESSION_COOKIE_NAME,
} from '@/lib/admin-auth-shared';

type DashboardLayoutProps = {
  children: ReactNode;
};

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value || '';

  if (!token || !verifyAdminSessionToken(token)) {
    redirect(`${ADMIN_LOGIN_PATH}?next=%2Fdashboard`);
  }

  return children;
}
