import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-slate-100 via-zinc-50 to-slate-200 px-6 py-16">
      <main className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-lg backdrop-blur md:p-12">
        <p className="mb-3 inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
          WA Lead Agent
        </p>

        <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
          Dashboard untuk Monitor Nomor dan Kontak WAHA
        </h1>

        <p className="mt-4 text-sm leading-7 text-slate-600 md:text-base">
          Gunakan dashboard untuk melihat nomor yang pernah chat, menandai known lead,
          serta memantau hasil fetch kontak dari WAHA secara real-time.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            Login Dashboard
          </Link>
          <a
            href="/api/dashboard/numbers"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Lihat JSON API
          </a>
        </div>
      </main>
    </div>
  );
}
