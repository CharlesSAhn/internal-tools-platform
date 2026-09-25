import { Card, PageHeader } from "@platform/ui";

export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  return (
    <>
      <PageHeader title="Access denied" subtitle="Your roles do not grant this permission." />
      <Card className="max-w-xl">
        <p className="text-sm text-slate-700">
          Required permission: <span className="font-mono">{p ?? "unknown"}</span>
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Access is checked on the server for every route and every mutation, not by hiding buttons.
        </p>
      </Card>
    </>
  );
}
