import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { schoolDb } from "@/lib/db";
import { storageStatus } from "@/lib/storage";
import { PageSkeleton } from "@/components/page-skeleton";
import { StorageNotice } from "@/components/storage-notice";
import { Card, PageHeader } from "@/components/ui";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import students" };

export default function ImportPage() {
  return (
    <>
      <PageHeader title="Import students" description="Add many students at once from an Excel or CSV file." />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const user = await requireSchoolAdmin();
  const storage = await schoolDb(user, (tx) => storageStatus(tx, user.school.id));
  return (
    <div className="max-w-5xl space-y-6">
      <StorageNotice status={storage} />
      <Card className="p-5">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            Download the template:{" "}
            <a href="/school/import/template" className="font-medium text-blue-700 hover:underline" download>Excel (.xlsx)</a> or{" "}
            <a href="/school/import/template?format=csv" className="font-medium text-blue-700 hover:underline" download>CSV</a>.
          </li>
          <li>Fill in one student per row: <strong>Student ID</strong>, <strong>Full Name</strong> and (optional) <strong>Class</strong>.</li>
          <li>Upload it and press <strong>Check file</strong>. Nothing is saved yet — you will see what will happen to every row.</li>
          <li>If it looks right, press <strong>Import</strong>. The import is all-or-nothing: if anything fails, nothing is saved.</li>
        </ol>
      </Card>
      <ImportForm />
    </div>
  );
}
