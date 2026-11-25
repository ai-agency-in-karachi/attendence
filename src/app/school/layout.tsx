import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { AppHeader, AppHeaderSkeleton } from "@/components/app-header";
import { SchoolNav, SchoolNavFallback } from "./_components/nav";

export default function SchoolLayout({ children }: LayoutProps<"/school">) {
  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <div className="print:hidden">
        <Suspense fallback={<AppHeaderSkeleton />}>
          <Header />
        </Suspense>
      </div>
      <Suspense fallback={<SchoolNavFallback />}>
        <SchoolNav />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

async function Header() {
  const user = await requireSchoolAdmin();
  return <AppHeader panelName={user.school.name} userName={user.fullName} accountHref="/school/account" subtitle="School Admin" />;
}
