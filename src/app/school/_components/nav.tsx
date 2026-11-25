"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/school", label: "Dashboard", exact: true },
  { href: "/school/scan", label: "Scan QR" },
  { href: "/school/attendance", label: "Register" },
  { href: "/school/students", label: "Students" },
  { href: "/school/classes", label: "Classes" },
  { href: "/school/import", label: "Import" },
  { href: "/school/cards", label: "Cards" },
] as const;

/** School Admin menu: a scrollable row of tabs (works on phones too). */
export function SchoolNav() {
  return <Tabs pathname={usePathname()} />;
}

export function SchoolNavFallback() {
  return <Tabs pathname="" />;
}

function Tabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="School" className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
        {LINKS.map((link) => {
          const active = "exact" in link ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${
                active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
