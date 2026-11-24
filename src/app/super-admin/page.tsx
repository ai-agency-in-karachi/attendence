import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { PageSkeleton } from "@/components/page-skeleton";

export const metadata: Metadata = { title: "Super Admin" };

export default function SuperAdminHome() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  // Every component that shows protected data checks the session itself.
  const user = await requireSuperAdmin();
  return (
    <section>
      <h1 className="text-2xl font-semibold text-slate-900">Welcome, {user.fullName}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Signed in as Super Admin ({user.email}). School, plan and payment management arrive in
        Phases 4–5.
      </p>
    </section>
  );
}
