"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/super-admin", label: "Dashboard", exact: true },
  { href: "/super-admin/schools", label: "Schools" },
  { href: "/super-admin/plans", label: "Plans" },
  { href: "/super-admin/subscriptions", label: "Subscriptions" },
  { href: "/super-admin/payments", label: "Payments" },
  { href: "/super-admin/storage", label: "Storage" },
] as const;

const COMING_SOON = ["Settings"];

/** Left-hand menu of the Super Admin panel (a top bar on small screens). */
export function SuperAdminNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** Same menu without the "current page" highlight (shown while the URL is read). */
export function SuperAdminNavFallback() {
  return <NavLinks pathname="" />;
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Super Admin" className="flex gap-1 overflow-x-auto md:flex-col">
      {LINKS.map((link) => {
        const active =
          "exact" in link && link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
              active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      {COMING_SOON.map((label) => (
        <span
          key={label}
          title="Coming in a later phase"
          className="hidden cursor-default whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-400 md:block"
        >
          {label} <span className="text-xs">· soon</span>
        </span>
      ))}
    </nav>
  );
}
