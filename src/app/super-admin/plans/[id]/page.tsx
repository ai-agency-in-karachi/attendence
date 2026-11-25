import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { platformDb } from "@/lib/db";
import { toId } from "@/lib/form";
import { minorToInput } from "@/lib/billing";
import { MB } from "@/lib/validation/school";
import { PageSkeleton } from "@/components/page-skeleton";
import { Crumbs, PageHeader } from "@/components/ui";
import { PlanForm } from "../_components/plan-form";

export const metadata: Metadata = { title: "Edit plan" };

export default function EditPlanPage(props: PageProps<"/super-admin/plans/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params }: PageProps<"/super-admin/plans/[id]">) {
  const user = await requireSuperAdmin();
  const id = toId((await params).id);
  if (!id) notFound();
  const plan = await platformDb(user, (tx) => tx.plan.findUnique({ where: { id } }));
  if (!plan) notFound();
  return (
    <>
      <PageHeader title={`Edit ${plan.name}`} description={<Crumbs items={[["Plans", "/super-admin/plans"], [plan.name]]} />} />
      <PlanForm
        planId={plan.id}
        initial={{
          name: plan.name,
          description: plan.description ?? "",
          storageLimitMb: String(Number(plan.storageLimitBytes / BigInt(MB))),
          price: minorToInput(plan.priceMinor),
          currency: plan.currency,
          billingPeriod: plan.billingPeriod,
        }}
      />
    </>
  );
}
