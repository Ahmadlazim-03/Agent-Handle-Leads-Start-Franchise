'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

type LoginResponse = {
  ok?: boolean;
  error?: string;
};

function resolveSafeNextPath(rawNext: string | null): string {
  if (!rawNext) {
    return '/dashboard';
  }

  const trimmed = rawNext.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/dashboard';
  }

  if (trimmed.startsWith('/api/')) {
    return '/dashboard';
  }

  return trimmed;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [nextPath, setNextPath] = useState('/dashboard');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(resolveSafeNextPath(params.get('next')));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorText('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const payload = (await response.json()) as LoginResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Login gagal.');
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login gagal.';
      setErrorText(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-violet-600/10 blur-3xl" />
      </div>

      <main className="glass-card glow-accent relative w-full max-w-md rounded-3xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20">
            <svg className="h-5 w-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <span className="rounded-full bg-indigo-600/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
            Admin Portal
          </span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white">Login Dashboard</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Masuk menggunakan akun admin untuk mengelola lead dan konfigurasi bot.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-zinc-300" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              disabled={isSubmitting}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-zinc-300" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={isSubmitting}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              required
            />
          </div>

          {errorText ? (
            <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-sm text-rose-300">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {errorText}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="group relative w-full overflow-hidden rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="relative z-10">{isSubmitting ? 'Memproses Login...' : 'Masuk ke Dashboard'}</span>
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform group-hover:translate-x-full duration-700" />
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-500 transition hover:text-indigo-400"
          >
            ← Kembali ke Home
          </Link>
        </div>
      </main>
    </div>
  );
}
