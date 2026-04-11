import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-indigo-500/5 blur-3xl" />
      </div>

      <main className="glass-card glow-accent relative w-full max-w-2xl rounded-3xl p-8 md:p-12">
        <div className="gradient-border rounded-3xl" />

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20">
            <svg className="h-5 w-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className="rounded-full bg-indigo-600/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
            WA Lead Agent
          </span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
          Dashboard Monitor <br />
          <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            AI Lead Agent
          </span>
        </h1>

        <p className="mt-4 text-sm leading-7 text-zinc-400 md:text-base">
          Sistem otomasi kualifikasi lead WhatsApp berbasis AI. Monitor nomor, 
          kelola kontak WAHA, dan pantau performa bot secara real-time.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="group relative overflow-hidden rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/25"
          >
            <span className="relative z-10">Login Dashboard</span>
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform group-hover:translate-x-full duration-700" />
          </Link>
          <a
            href="/api/dashboard/numbers"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-zinc-700 bg-zinc-800/50 px-6 py-3 text-sm font-semibold text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
          >
            Lihat JSON API
          </a>
        </div>

        {/* Decorative bottom bar */}
        <div className="mt-10 flex items-center gap-3 border-t border-zinc-800 pt-6">
          <div className="flex -space-x-1">
            <div className="h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
            <div className="h-2 w-2 rounded-full bg-indigo-400 pulse-dot" style={{ animationDelay: '0.3s' }} />
            <div className="h-2 w-2 rounded-full bg-violet-400 pulse-dot" style={{ animationDelay: '0.6s' }} />
          </div>
          <p className="text-xs text-zinc-500">
            Powered by GPT-4o · WAHA · Next.js
          </p>
        </div>
      </main>
    </div>
  );
}
