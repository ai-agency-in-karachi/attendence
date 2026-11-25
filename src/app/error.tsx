"use client";

import Link from "next/link";

/** Shown when a page fails unexpectedly. Never displays technical details. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-md text-sm text-slate-600">
        Please try again. If it keeps happening, contact the platform administrator
        {digest ? ` and mention code ${digest}` : ""}.
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => retry()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Dashboard
        </Link>
      </div>
    </main>
  );
}
