import Link from "next/link";
import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import { can } from "@platform/rbac";
import { Badge, Card, DataTable, PageHeader } from "@platform/ui";
import { CREATE_PERMISSION, ENVS, VIEW_PERMISSION, type FlagEnvName } from "./policy";
import { EnvSummary } from "./env-summary";

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await requirePermission(VIEW_PERMISSION);
  const sp = await searchParams;
  const showArchived = sp.archived === "1";

  const flags = await prisma.featureFlag.findMany({
    where: showArchived ? {} : { archived: false },
    orderBy: { key: "asc" },
    include: { envStates: true },
  });

  return (
    <>
      <PageHeader
        title="Feature Flags"
        subtitle="Environment-scoped configuration. Production changes need an elevated permission and a reason."
        actions={
          can(user, CREATE_PERMISSION) ? (
            <Link href="/flags/new" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
              New flag
            </Link>
          ) : null
        }
      />
      <Card>
        <div className="mb-4 flex items-center gap-3 text-sm">
          <Link
            href="/flags"
            className={showArchived ? "text-slate-500 hover:text-slate-900" : "font-medium text-slate-900 underline"}
          >
            Active
          </Link>
          <Link
            href="/flags?archived=1"
            className={showArchived ? "font-medium text-slate-900 underline" : "text-slate-500 hover:text-slate-900"}
          >
            Including archived
          </Link>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">{flags.length} flags</span>
        </div>
        <DataTable
          rows={flags}
          rowHref={(f) => `/flags/${f.id}`}
          columns={[
            { header: "Key", cell: (f) => <span className="font-mono text-xs">{f.key}</span> },
            { header: "Description", cell: (f) => f.description },
            { header: "Owner", cell: (f) => <span className="text-xs text-slate-600">{f.ownerEmail}</span> },
            ...ENVS.map((env: FlagEnvName) => ({
              header: env.toLowerCase(),
              cell: (f: (typeof flags)[number]) => {
                const s = f.envStates.find((x) => x.env === env);
                return <EnvSummary state={s ?? null} />;
              },
            })),
            {
              header: "",
              cell: (f) => (f.archived ? <Badge tone="warning">archived</Badge> : null),
            },
          ]}
          empty="No flags yet"
        />
      </Card>
    </>
  );
}
