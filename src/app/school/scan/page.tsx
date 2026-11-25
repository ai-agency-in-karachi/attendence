import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { dateOnlyLabel, dateOnlyToDb, todayInZone } from "@/lib/dates";
import { PageSkeleton } from "@/components/page-skeleton";
import { PageHeader } from "@/components/ui";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Scan QR attendance" };

export default function ScanPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const user = await requireSchoolAdmin();
  const today = todayInZone(user.school.timezone);
  const count = await schoolDb(user, (tx) => tx.attendance.count({ where: { date: dateOnlyToDb(today), status: "PRESENT" } }));
  return (
    <>
      <PageHeader title="Scan QR attendance" description={`Attendance for ${dateOnlyLabel(today)}`} />
      <Scanner initialCount={count} schoolTimeZone={user.school.timezone} />
    </>
  );
}
