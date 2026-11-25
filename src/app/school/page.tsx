import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { percent } from "@/lib/format";
import { storageStatus } from "@/lib/storage";
import { isCurrent } from "@/lib/billing";
import { addDays, dateOnlyLabel, dateOnlyToDb, dbToDateOnly, timeInZone, todayInZone, weekday } from "@/lib/dates";
import { PageSkeleton } from "@/components/page-skeleton";
import { StudentPhoto } from "@/components/student-photo";
import { StorageMeter, SubscriptionBadge } from "@/components/billing-ui";
import { StorageNotice } from "@/components/storage-notice";
import { ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "School dashboard" };

export default function SchoolHome() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  // Every component that shows protected data checks the session itself.
  const user = await requireSchoolAdmin();
  const tz = user.school.timezone;
  const today = todayInZone(tz);
  const weekStart = addDays(today, -6);

  const d = await schoolDb(user, async (tx) => {
    const [active, inactive, classes, todayRows, week, recent, storage, subscription] = await Promise.all([
      tx.student.count({ where: { status: "ACTIVE" } }),
      tx.student.count({ where: { status: "INACTIVE" } }),
      tx.classGroup.count({ where: { isActive: true } }),
      tx.attendance.groupBy({ by: ["status"], where: { date: dateOnlyToDb(today) }, _count: { _all: true } }),
      tx.attendance.groupBy({
        by: ["date"],
        where: { status: "PRESENT", date: { gte: dateOnlyToDb(weekStart), lte: dateOnlyToDb(today) } },
        _count: { _all: true },
      }),
      tx.attendance.findMany({
        where: { date: dateOnlyToDb(today), status: "PRESENT" },
        orderBy: { markedAt: "desc" },
        take: 8,
        select: {
          markedAt: true,
          source: true,
          student: { select: { id: true, fullName: true, photoKey: true, classGroup: { select: { name: true } } } },
        },
      }),
      storageStatus(tx, user.school.id),
      tx.subscription.findFirst({
        where: { status: { in: ["ACTIVE", "TRIAL"] } },
        include: { plan: { select: { name: true } } },
      }),
    ]);
    return { active, inactive, classes, todayRows, week, recent, storage, subscription };
  });

  const present = d.todayRows.find((r) => r.status === "PRESENT")?._count._all ?? 0;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const perDay = new Map(d.week.map((w) => [dbToDateOnly(w.date), w._count._all]));
  const max = Math.max(1, d.active, ...perDay.values());
  const sub = d.subscription && isCurrent(d.subscription) ? d.subscription : null;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName}`}
        description={dateOnlyLabel(today)}
        actions={
          <>
            <ButtonLink href="/school/scan">Scan QR attendance</ButtonLink>
            <ButtonLink href="/school/students/new" variant="secondary">+ Add student</ButtonLink>
          </>
        }
      />

      <div className="space-y-6">
        <StorageNotice status={d.storage} />

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Present today" value={present.toLocaleString("en-US")} hint={`${percent(present, d.active)}% of active students`} />
          <Stat label="Not yet scanned" value={Math.max(0, d.active - present).toLocaleString("en-US")} />
          <Stat label="Active students" value={d.active.toLocaleString("en-US")} hint={d.inactive ? `${d.inactive} inactive` : undefined} />
          <Stat label="Classes" value={d.classes} />
        </dl>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Present in the last 7 days" actions={<Link href="/school/attendance" className="text-sm text-blue-700 hover:underline">Open register</Link>} />
            <div className="flex h-44 items-end gap-2 px-5 pb-4 pt-6" role="img" aria-label="Students present per day for the last 7 days">
              {days.map((day) => {
                const n = perDay.get(day) ?? 0;
                const weekend = weekday(day) === 0 || weekday(day) === 6;
                return (
                  <div key={day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-xs tabular-nums text-slate-600">{n}</span>
                    <div
                      className={`w-full max-w-12 rounded-t ${day === today ? "bg-blue-600" : weekend ? "bg-slate-300" : "bg-blue-300"}`}
                      style={{ height: `${Math.max(2, (n / max) * 100)}%` }}
                    />
                    <span className={`text-xs ${day === today ? "font-semibold text-slate-900" : "text-slate-500"}`}>
                      {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(dateOnlyToDb(day))}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Storage" />
              <div className="p-5">
                {d.storage.quota.limit === null ? (
                  <p className="text-sm text-slate-600">No storage plan yet.</p>
                ) : (
                  <StorageMeter status={d.storage} />
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Subscription" />
              <div className="space-y-1 p-5 text-sm">
                {sub ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{sub.plan.name}</span>
                      <SubscriptionBadge sub={sub} />
                    </div>
                    <p className="text-slate-600">Valid until {formatDate(sub.endsAt, tz)}</p>
                  </>
                ) : (
                  <p className="text-slate-600">No active subscription. Contact the platform administrator.</p>
                )}
              </div>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader title="Latest arrivals today" actions={<Link href="/school/scan" className="text-sm text-blue-700 hover:underline">Scan</Link>} />
          {d.recent.length === 0 ? (
            <EmptyState>No one has been marked present yet today.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map((r) => (
                <li key={r.student.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <StudentPhoto student={r.student} size={32} />
                  <Link href={`/school/students/${r.student.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.student.fullName}
                  </Link>
                  <span className="text-slate-500">{r.student.classGroup?.name}</span>
                  <span className="ml-auto text-xs text-slate-500">
                    {r.source === "QR_SCAN" ? "QR" : "By hand"} · {timeInZone(r.markedAt, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
