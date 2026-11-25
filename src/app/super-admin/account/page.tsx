import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { PageSkeleton } from "@/components/page-skeleton";
import { ChangePasswordForm } from "@/components/change-password-form";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "My account" };

export default function AccountPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const user = await requireSuperAdmin();
  return (
    <>
      <PageHeader title="My account" description={`${user.fullName} · ${user.email} · Super Admin`} />
      <ChangePasswordForm />
    </>
  );
}
