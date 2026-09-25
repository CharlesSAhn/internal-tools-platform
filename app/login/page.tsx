import { prisma } from "@platform/db";
import { Button, Card, ErrorText, PageHeader } from "@platform/ui";
import { signInAction } from "@/app/(auth)/actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const users = await prisma.user.findMany({
    orderBy: { email: "asc" },
    select: { email: true, name: true, roles: { select: { role: { select: { key: true } } } } },
  });
  return (
    <>
      <PageHeader
        title="Sign in"
        subtitle="Demo authentication: pick a seeded user. Production would use Okta/Entra OIDC — see docs/ARCHITECTURE.md."
      />
      <ErrorText>{error}</ErrorText>
      <Card className="max-w-2xl">
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.email} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
              <div>
                <div className="text-sm font-medium text-slate-900">{u.name}</div>
                <div className="font-mono text-xs text-slate-500">
                  {u.email} · {u.roles.map((r) => r.role.key).join(", ") || "no roles"}
                </div>
              </div>
              <form action={signInAction}>
                <input type="hidden" name="email" value={u.email} />
                <Button type="submit" variant="secondary">
                  Sign in
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
