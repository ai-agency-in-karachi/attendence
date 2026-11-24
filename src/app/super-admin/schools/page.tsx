import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb } from "@/lib/db";
import { PLATFORM_TIME_ZONE } from "@/lib/platform";
import { PageSkeleton } from "@/components/page-skeleton";
import { ButtonLink, Card, PageHeader, StatusBadge, formatDate, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Schools" };

const PAGE_SIZE = 20;

export default function SchoolsPage({ searchParams }: PageProps<"/super-admin/schools">) {
  return (
    <>
      <PageHeader
        title="Schools"
        description="All schools on the platform."
        actions={<ButtonLink href="/super-admin/schools/new">+ New school</ButtonLink>}
      />
      <Suspense fallback={<PageSkeleton />}>
        <SchoolsList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

async function SchoolsList({ searchParams }: { searchParams: PageProps<"/super-admin/schools">["searchParams"] }) {
  const user = await requireSuperAdmin();
  const params = await searchParams;

  const q = one(params.q).trim().slice(0, 100);
  const statusParam = one(params.status);
  const status = statusParam === "ACTIVE" || statusParam === "INACTIVE" ? statusParam : undefined;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(params.page), 10) || 1));

  const where: Prisma.SchoolWhereInput = {
    ...(status && { status }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { contactEmail: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const { total, schools } = await platformDb(user, async (tx) => {
    const [total, schools] = await Promise.all([
      tx.school.count({ where }),
      tx.school.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          timezone: true,
          createdAt: true,
          _count: { select: { students: true, users: true } },
        },
      }),
    ]);
    return { total, schools };
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return `/super-admin/schools${s ? `?${s}` : ""}`;
  };

  return (
    <Card>
      {/* Plain GET form: filters live in the URL, so results can be bookmarked/shared. */}
      <form className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4" role="search">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="sr-only">
            Search schools
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search by name, web name or email…"
            className={`${inputClass} mt-0`}
          />
        </div>
        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <select id="status" name="status" defaultValue={status ?? ""} className={`${inputClass} mt-0`}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <button type="submit" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Filter
        </button>
        {(q || status) && (
          <Link href="/super-admin/schools" className="py-2 text-sm text-slate-600 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {schools.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-slate-500">
          {q || status ? (
            "No schools match these filters."
          ) : (
            <>
              No schools yet.{" "}
              <Link href="/super-admin/schools/new" className="text-blue-700 hover:underline">
                Create the first one
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">School</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Students</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Admins</th>
                <th scope="col" className="px-3 py-2 font-medium">Time zone</th>
                <th scope="col" className="px-5 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schools.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/super-admin/schools/${s.id}`} className="font-medium text-slate-900 hover:underline">
                      {s.name}
                    </Link>
                    <div className="text-xs text-slate-500">{s.slug}</div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{s._count.students.toLocaleString("en-US")}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{s._count.users}</td>
                  <td className="px-3 py-3 text-slate-600">{s.timezone}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(s.createdAt, PLATFORM_TIME_ZONE)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
        <span>
          {total === 0
            ? "0 schools"
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString("en-US")}`}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={link(page - 1)} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">
                ← Previous
              </Link>
            ) : (
              <span className="rounded-md border border-slate-200 px-3 py-1 text-slate-300">← Previous</span>
            )}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={link(page + 1)} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">
                Next →
              </Link>
            ) : (
              <span className="rounded-md border border-slate-200 px-3 py-1 text-slate-300">Next →</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
