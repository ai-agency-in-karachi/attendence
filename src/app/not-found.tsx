import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 px-4 py-24 text-center">
      <p className="text-sm font-semibold text-blue-700">404</p>
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="max-w-md text-sm text-slate-600">This page does not exist, or it belongs to another account.</p>
      <Link href="/" className="mt-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Go to my dashboard
      </Link>
    </main>
  );
}
