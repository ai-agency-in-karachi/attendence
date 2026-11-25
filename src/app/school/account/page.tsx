import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
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
  const user = await requireSchoolAdmin();
  return (
    <>
      <PageHeader title="My account" description={`${user.fullName} · ${user.email} · School Admin, ${user.school.name}`} />
      <ChangePasswordForm />
    </>
  );
}
