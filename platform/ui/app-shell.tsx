import Link from "next/link";
import { getCurrentUser } from "@platform/auth";
import { apps } from "@platform/registry";
import { signOutAction } from "@/app/(auth)/actions";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const visibleApps = apps.filter((a) => user?.permissions.includes(a.viewPermission));
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/" className="text-sm font-semibold text-slate-900">
            Internal Tools
          </Link>
          <nav className="flex flex-1 gap-4 text-sm">
            {visibleApps.flatMap((a) =>
              a.nav.map((n) => (
                <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">
                  {n.label}
                </Link>
              )),
            )}
            {user?.permissions.includes("admin.audit.view") ? (
              <Link href="/admin/audit" className="text-slate-600 hover:text-slate-900">
                Audit log
              </Link>
            ) : null}
          </nav>
          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-500">
                {user.name} · <span className="font-mono text-xs">{user.roles.join(", ") || "no roles"}</span>
              </span>
              <form action={signOutAction}>
                <button className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <Link href="/login" className="text-sm text-blue-700">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">{children}</main>
    </div>
  );
}
