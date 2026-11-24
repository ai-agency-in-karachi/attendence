import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { TIME_ZONES, utcOffsetLabel } from "@/lib/timezones";
import { PageSkeleton } from "@/components/page-skeleton";
import { PageHeader } from "@/components/ui";
import { CreateSchoolForm } from "./create-school-form";

export const metadata: Metadata = { title: "New school" };

export default function NewSchoolPage() {
  return (
    <>
      <PageHeader
        title="New school"
        description={
          <>
            <Link href="/super-admin/schools" className="text-blue-700 hover:underline">
              Schools
            </Link>{" "}
            / New
          </>
        }
      />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  await requireSuperAdmin();
  const zones = TIME_ZONES.map((z) => ({ value: z, label: `${z.replaceAll("_", " ")} (${utcOffsetLabel(z)})` }));
  return <CreateSchoolForm timeZones={zones} />;
}
