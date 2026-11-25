import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth/dal";
import { AppHeader, AppHeaderSkeleton } from "@/components/app-header";
import { SuperAdminNav, SuperAdminNavFallback } from "./_components/nav";

export default function SuperAdminLayout({ children }: LayoutProps<"/super-admin">) {
  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <Suspense fallback={<AppHeaderSkeleton />}>
        <Header />
      </Suspense>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-48 md:shrink-0">
          <Suspense fallback={<SuperAdminNavFallback />}>
            <SuperAdminNav />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

async function Header() {
  const user = await requireSuperAdmin();
  return <AppHeader panelName="Super Admin" userName={user.fullName} accountHref="/super-admin/account" subtitle="Platform management" />;
}
