import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { PageSkeleton } from "@/components/page-skeleton";

export const metadata: Metadata = { title: "School dashboard" };

export default function SchoolHome() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  // Every component that shows protected data checks the session itself.
  const user = await requireSchoolAdmin();
  return (
    <section>
      <h1 className="text-2xl font-semibold text-slate-900">Welcome, {user.fullName}</h1>
      <p className="mt-2 text-sm text-slate-600">
        School Admin for <strong>{user.school.name}</strong>. Dashboard, students and attendance
        arrive in later phases.
      </p>
    </section>
  );
}
