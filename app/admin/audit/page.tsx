import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import { diffFields } from "@platform/audit";
import { Card, DataTable, PageHeader, Pagination, Badge } from "@platform/ui";

const PAGE_SIZE = 25;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string; actor?: string; page?: string }>;
}) {
  await requirePermission("admin.audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = {
    ...(sp.app ? { app: sp.app } : {}),
    ...(sp.actor ? { actorEmail: { contains: sp.actor, mode: "insensitive" as const } } : {}),
  };
  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditEvent.count({ where }),
  ]);
  const qs = (p: number) =>
    `/admin/audit?${new URLSearchParams({ ...(sp.app ? { app: sp.app } : {}), ...(sp.actor ? { actor: sp.actor } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every mutation across every internal app, written transactionally." />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2 text-sm" action="/admin/audit">
          <input
            name="app"
            defaultValue={sp.app ?? ""}
            placeholder="app (kyc, flags)"
            className="rounded-md border border-slate-300 px-2 py-1"
          />
          <input
            name="actor"
            defaultValue={sp.actor ?? ""}
            placeholder="actor email"
            className="rounded-md border border-slate-300 px-2 py-1"
          />
          <button className="rounded-md bg-slate-900 px-3 py-1 text-white">Filter</button>
        </form>
        <DataTable
          rows={events}
          columns={[
            { header: "When", cell: (e) => <span className="font-mono text-xs">{e.at.toISOString().slice(0, 19).replace("T", " ")}</span> },
            { header: "App", cell: (e) => <Badge tone="info">{e.app}</Badge> },
            { header: "Actor", cell: (e) => e.actorEmail },
            { header: "Action", cell: (e) => <span className="font-medium">{e.action}</span> },
            { header: "Entity", cell: (e) => <span className="font-mono text-xs">{e.entityType}:{e.entityId.slice(0, 8)}</span> },
            { header: "Reason", cell: (e) => e.reason ?? "—" },
            {
              header: "Changes",
              cell: (e) => {
                const d = diffFields(e.before as Record<string, unknown> | null, e.after as Record<string, unknown> | null);
                if (d.length === 0) return "—";
                return (
                  <span className="text-xs text-slate-600">
                    {d.map((c) => `${c.field}: ${JSON.stringify(c.before)}→${JSON.stringify(c.after)}`).join("; ")}
                  </span>
                );
              },
            },
          ]}
          empty="No audit events yet"
        />
        <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} hrefFor={qs} />
      </Card>
    </>
  );
}
