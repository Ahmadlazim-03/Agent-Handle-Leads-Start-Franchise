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
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-slate-100 via-zinc-50 to-slate-200 px-6 py-16">
      <main className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-lg backdrop-blur">
        <p className="mb-3 inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
          Admin Portal
        </p>

        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Login Dashboard</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Masuk menggunakan akun admin untuk mengakses dashboard manajemen lead WA.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-slate-700" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            disabled={isSubmitting}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-slate-300 transition focus:ring"
            required
          />

          <label className="block text-sm font-semibold text-slate-700" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={isSubmitting}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-slate-300 transition focus:ring"
            required
          />

          {errorText ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorText}</p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Memproses Login...' : 'Masuk ke Dashboard'}
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-slate-600">
          <Link
            href="/"
            className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4"
          >
            Kembali ke Home
          </Link>
        </div>
      </main>
    </div>
  );
}
