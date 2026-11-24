import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb } from "@/lib/db";
import { PLATFORM_TIME_ZONE } from "@/lib/platform";
import { utcOffsetLabel } from "@/lib/timezones";
import { PageSkeleton } from "@/components/page-skeleton";
import { Alert, Card, CardHeader, PageHeader, StatusBadge, formatDateTime } from "@/components/ui";
import { StatusControl } from "./status-control";

export const metadata: Metadata = { title: "School" };

export default function SchoolDetailPage(props: PageProps<"/super-admin/schools/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SchoolDetail {...props} />
    </Suspense>
  );
}

async function SchoolDetail({ params, searchParams }: PageProps<"/super-admin/schools/[id]">) {
  const user = await requireSuperAdmin();
  const { id } = await params;
  const created = (await searchParams).created === "1";

  const schoolId = /^\d{1,9}$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(schoolId)) notFound();

  const school = await platformDb(user, (tx) =>
    tx.school.findUnique({
      where: { id: schoolId },
      include: {
        users: {
          orderBy: { createdAt: "asc" },
          select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true, createdAt: true },
        },
        _count: { select: { students: true, classGroups: true } },
      },
    }),
  );
  if (!school) notFound();

  const details: [string, string][] = [
    ["Web name", school.slug],
    ["Time zone", `${school.timezone} (${utcOffsetLabel(school.timezone)})`],
    ["Contact email", school.contactEmail ?? "—"],
    ["Contact phone", school.contactPhone ?? "—"],
    ["Address", school.address ?? "—"],
    ["Added", formatDateTime(school.createdAt, PLATFORM_TIME_ZONE)],
  ];

  return (
    <>
      <PageHeader
        title={school.name}
        description={
          <>
            <Link href="/super-admin/schools" className="text-blue-700 hover:underline">
              Schools
            </Link>{" "}
            / {school.name}
          </>
        }
        actions={<StatusBadge status={school.status} />}
      />

      {created && (
        <div className="mb-6">
          <Alert tone="success">
            School created{school.users.length > 0 ? " together with its first School Admin login" : ""}.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-slate-100">
              {details.map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-4 px-5 py-3 text-sm">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="col-span-2 break-words text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title={`School Admins (${school.users.length})`} />
            {school.users.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">
                No admin logins yet. Adding admins from here arrives in the next step (Phase 4b).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-2 font-medium">Name</th>
                      <th scope="col" className="px-3 py-2 font-medium">Email</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      <th scope="col" className="px-5 py-2 font-medium">Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {school.users.map((u) => (
                      <tr key={u.id}>
                        <td className="px-5 py-3 font-medium text-slate-900">{u.fullName}</td>
                        <td className="px-3 py-3 text-slate-600">{u.email}</td>
                        <td className="px-3 py-3">
                          {u.isActive ? (
                            <span className="text-emerald-700">Active</span>
                          ) : (
                            <span className="text-slate-500">Disabled</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                          {u.lastLoginAt ? formatDateTime(u.lastLoginAt, PLATFORM_TIME_ZONE) : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="At a glance" />
            <dl className="grid grid-cols-2 gap-4 p-5">
              <div>
                <dt className="text-xs text-slate-500">Students</dt>
                <dd className="text-xl font-semibold tabular-nums">{school._count.students.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Classes</dt>
                <dd className="text-xl font-semibold tabular-nums">{school._count.classGroups}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">Storage used</dt>
                <dd className="text-sm text-slate-700">Measured from Phase 8 (storage engine)</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Account status" />
            <div className="space-y-3 p-5">
              <p className="text-sm text-slate-600">
                {school.status === "ACTIVE"
                  ? "This school's admins can sign in and use the system."
                  : "This school is inactive. Its admins cannot sign in. All data is kept."}
              </p>
              <StatusControl schoolId={school.id} status={school.status} adminCount={school.users.length} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
