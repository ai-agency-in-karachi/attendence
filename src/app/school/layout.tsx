import { Suspense } from "react";
import { requireSchoolAdmin } from "@/lib/auth/dal";
import { AppHeader, AppHeaderSkeleton } from "@/components/app-header";

export default function SchoolLayout({ children }: LayoutProps<"/school">) {
  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <Suspense fallback={<AppHeaderSkeleton />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

async function Header() {
  const user = await requireSchoolAdmin();
  return <AppHeader panelName={user.school.name} userName={user.fullName} subtitle="School Admin" />;
}
