import Link from "next/link";
import { getCurrentUser } from "@platform/auth";
import { apps } from "@platform/registry";
import { Card, PageHeader } from "@platform/ui";

export default async function HomePage() {
  const user = await getCurrentUser();
  return (
    <>
      <PageHeader
        title="Internal tools"
        subtitle={user ? `Signed in as ${user.name}` : "Sign in to see the tools you have access to"}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {apps.map((app) => {
          const allowed = user?.permissions.includes(app.viewPermission) ?? false;
          return (
            <Card key={app.id}>
              <h3 className="text-base font-semibold text-slate-900">{app.name}</h3>
              <p className="mt-1 text-sm text-slate-600">{app.description}</p>
              <p className="mt-3 text-sm">
                {allowed ? (
                  <Link className="text-blue-700 hover:underline" href={app.nav[0].href}>
                    Open →
                  </Link>
                ) : (
                  <span className="text-slate-400">No access ({app.viewPermission})</span>
                )}
              </p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
