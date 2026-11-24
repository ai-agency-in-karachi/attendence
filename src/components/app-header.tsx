import { logout } from "@/lib/auth/actions";

type Props = {
  panelName: string;
  userName: string;
  subtitle?: string;
};

/** Top bar shared by both panels: panel name, who is signed in, sign out. */
export function AppHeader({ panelName, userName, subtitle }: Props) {
  return (
    <HeaderFrame>
      <div>
        <p className="text-sm font-semibold text-slate-900">{panelName}</p>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-600">{userName}</span>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </HeaderFrame>
  );
}

/** Same-size placeholder shown for a moment while the signed-in user loads. */
export function AppHeaderSkeleton() {
  return (
    <HeaderFrame>
      <div className="h-9 w-40 animate-pulse rounded bg-slate-100" />
      <div className="h-8 w-32 animate-pulse rounded bg-slate-100" />
    </HeaderFrame>
  );
}

function HeaderFrame({ children }: { children: React.ReactNode }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        {children}
      </div>
    </header>
  );
}
