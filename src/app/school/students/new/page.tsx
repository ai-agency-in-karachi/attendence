import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { toId } from "@/lib/form";
import { one } from "@/lib/params";
import { storageStatus } from "@/lib/storage";
import { PageSkeleton } from "@/components/page-skeleton";
import { Alert, Card, Crumbs, PageHeader } from "@/components/ui";
import { StudentForm } from "../_components/student-form";
import { StorageNotice } from "@/components/storage-notice";

export const metadata: Metadata = { title: "Add student" };

export default function NewStudentPage({ searchParams }: PageProps<"/school/students/new">) {
  return (
    <>
      <PageHeader title="Add student" description={<Crumbs items={[["Students", "/school/students"], ["Add"]]} />} />
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/school/students/new">["searchParams"] }) {
  const user = await requireSchoolAdmin();
  const addedId = toId(one((await searchParams).added));
  const { classes, added, storage } = await schoolDb(user, async (tx) => ({
    classes: await tx.classGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    added: addedId ? await tx.student.findUnique({ where: { id: addedId }, select: { fullName: true } }) : null,
    storage: await storageStatus(tx, user.school.id),
  }));
  return (
    <div className="max-w-3xl space-y-4">
      {added && <Alert tone="success">{added.fullName} was added. Add the next student below.</Alert>}
      <StorageNotice status={storage} />
      <Card className="p-5">
        <StudentForm initial={{ studentCode: "", fullName: "", classGroupId: "" }} classes={classes} />
      </Card>
    </div>
  );
}
