import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Small shared building blocks so every screen looks consistent. */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {actions}
    </div>
  );
}

const buttonStyles = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-60",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60",
} as const;

type Variant = keyof typeof buttonStyles;
const buttonBase = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium";

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${buttonBase} ${buttonStyles[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${buttonBase} ${buttonStyles[variant]} ${className}`} {...props} />;
}

export function StatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  return status === "ACTIVE" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-500/20">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Inactive
    </span>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "success" | "error" | "warning"; children: ReactNode }) {
  const tones = {
    info: "bg-blue-50 text-blue-800 ring-blue-600/20",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
    error: "bg-red-50 text-red-800 ring-red-600/20",
    warning: "bg-amber-50 text-amber-900 ring-amber-600/20",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md px-4 py-3 text-sm ring-1 ${tones[tone]}`}>
      {children}
    </div>
  );
}

export const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 aria-[invalid=true]:border-red-400";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}

export function formatDate(d: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(d);
}

export function formatDateTime(d: Date, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

/** Shows a form action's general error or success message. */
export function FormMessage({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (state?.error) return <Alert tone="error">{state.error}</Alert>;
  if (state?.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** aria attributes linking an input to its error message. */
export function ariaFor(error: string | undefined, id: string) {
  return error ? ({ "aria-invalid": true, "aria-describedby": `${id}-error` } as const) : {};
}

export type Tone = "green" | "amber" | "red" | "slate" | "blue";

/** Small colored label, e.g. subscription status. */
export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
    red: "bg-red-50 text-red-700 ring-red-600/20",
    slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
    blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  };
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Table header cell / body cell styles used by every list. */
export const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 first:pl-5 last:pr-5";
export const td = "px-3 py-3 first:pl-5 last:pr-5";

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-12 text-center text-sm text-slate-500">{children}</div>;
}

/** "Showing 1–20 of 135" + previous/next links. `href(page)` builds each page's URL. */
export function Pagination({
  page,
  pageSize,
  total,
  href,
  noun = "items",
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const linkCls = "rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50";
  const offCls = "rounded-md border border-slate-200 px-3 py-1 text-slate-300";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
      <span>
        {total === 0
          ? `0 ${noun}`
          : `Showing ${((page - 1) * pageSize + 1).toLocaleString("en-US")}–${Math.min(page * pageSize, total).toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? <Link href={href(page - 1)} className={linkCls}>← Previous</Link> : <span className={offCls}>← Previous</span>}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href(page + 1)} className={linkCls}>Next →</Link> : <span className={offCls}>Next →</span>}
        </div>
      )}
    </div>
  );
}

/** One labelled number in a row of stats. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-slate-500">{hint}</dd>}
    </Card>
  );
}

/** Breadcrumb trail: [["Schools", "/super-admin/schools"], ["Green Valley"]] */
export function Crumbs({ items }: { items: [string, string?][] }) {
  return (
    <>
      {items.map(([label, href], i) => (
        <span key={i}>
          {i > 0 && " / "}
          {href ? (
            <Link href={href} className="text-blue-700 hover:underline">
              {label}
            </Link>
          ) : (
            label
          )}
        </span>
      ))}
    </>
  );
}
