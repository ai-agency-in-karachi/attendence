import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { PageSkeleton } from "@/components/page-skeleton";
import { Crumbs, PageHeader } from "@/components/ui";
import { PlanForm } from "../_components/plan-form";

export const metadata: Metadata = { title: "New plan" };

export default function NewPlanPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader title="New plan" description={<Crumbs items={[["Plans", "/super-admin/plans"], ["New"]]} />} />
      <PlanForm initial={{ name: "", description: "", storageLimitMb: "", price: "", currency: "PKR", billingPeriod: "MONTHLY" }} />
    </>
  );
}
