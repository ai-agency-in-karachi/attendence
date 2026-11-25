import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb } from "@/lib/db";
import { PLATFORM_TIME_ZONE } from "@/lib/platform";
import { PageSkeleton } from "@/components/page-skeleton";
import { ButtonLink, Card, CardHeader, PageHeader, StatusBadge, formatDate, formatDateTime } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

export default function SuperAdminDashboard() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

/** Readable names for audit actions shown in "Recent activity". */
const ACTION_LABELS: Record<string, string> = {
  "school.create": "School created",
  "school.activate": "School activated",
  "school.deactivate": "School deactivated",
  "user.create_school_admin": "School Admin created",
  "user.create_super_admin": "Super Admin created",
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Failed sign-in",
  "auth.login_blocked": "Blocked sign-in (disabled)",
  "auth.locked": "Account locked (too many attempts)",
  "school.update": "School details edited",
  "user.reset_password": "Admin password reset",
  "user.enable": "Admin enabled",
  "user.disable": "Admin disabled",
  "user.change_own_password": "Password changed",
  "plan.create": "Plan created",
  "plan.update": "Plan edited",
  "plan.activate": "Plan made available",
  "plan.deactivate": "Plan retired",
  "subscription.create": "Subscription started",
  "subscription.cancel": "Subscription ended",
  "subscription.extend": "Subscription extended",
  "payment.record": "Payment recorded",
  "student.create": "Student added",
  "student.update": "Student edited",
  "student.deactivate": "Student deactivated",
  "student.activate": "Student reactivated",
  "student.delete": "Student deleted",
  "student.import": "Students imported",
  "student.regenerate_qr": "QR card replaced",
  "student.photo": "Student photo changed",
  "attendance.update": "Attendance changed by hand",
};

async function Dashboard() {
  const user = await requireSuperAdmin();

  const data = await platformDb(user, async (tx) => {
    const [byStatus, students, admins, recentSchools, activity] = await Promise.all([
      tx.school.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.student.count({ where: { status: "ACTIVE" } }),
      tx.user.count({ where: { role: "SCHOOL_ADMIN", isActive: true } }),
      tx.school.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, status: true, createdAt: true, _count: { select: { students: true } } },
      }),
      tx.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          action: true,
          createdAt: true,
          actor: { select: { fullName: true } },
          school: { select: { id: true, name: true } },
        },
      }),
    ]);
    const count = (s: "ACTIVE" | "INACTIVE") => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return { active: count("ACTIVE"), inactive: count("INACTIVE"), students, admins, recentSchools, activity };
  });

  const stats = [
    { label: "Total schools", value: data.active + data.inactive },
    { label: "Active schools", value: data.active },
    { label: "Inactive schools", value: data.inactive },
    { label: "Active students", value: data.students },
    { label: "School Admins", value: data.admins },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user.fullName}.`}
        actions={<ButtonLink href="/super-admin/schools/new">+ New school</ButtonLink>}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="px-4 py-3">
            <dt className="text-xs font-medium text-slate-500">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {s.value.toLocaleString("en-US")}
            </dd>
          </Card>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Newest schools"
            actions={
              <Link href="/super-admin/schools" className="text-sm text-blue-700 hover:underline">
                View all
              </Link>
            }
          />
          {data.recentSchools.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              No schools yet.{" "}
              <Link href="/super-admin/schools/new" className="text-blue-700 hover:underline">
                Create the first one
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentSchools.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/super-admin/schools/${s.id}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      Added {formatDate(s.createdAt, PLATFORM_TIME_ZONE)} · {s._count.students} students
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          {data.activity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.activity.map((a) => (
                <li key={a.id.toString()} className="px-5 py-3 text-sm">
                  <p className="text-slate-900">
                    {ACTION_LABELS[a.action] ?? a.action}
                    {a.school && (
                      <>
                        {" · "}
                        <Link href={`/super-admin/schools/${a.school.id}`} className="text-blue-700 hover:underline">
                          {a.school.name}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(a.createdAt, PLATFORM_TIME_ZONE)}
                    {a.actor && ` · by ${a.actor.fullName}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
