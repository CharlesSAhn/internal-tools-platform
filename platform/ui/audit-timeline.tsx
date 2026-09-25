import { prisma } from "@platform/db";
import { diffFields } from "@platform/audit";

export async function AuditTimeline({
  app,
  entityType,
  entityId,
}: {
  app: string;
  entityType: string;
  entityId: string;
}) {
  const events = await prisma.auditEvent.findMany({
    where: { app, entityType, entityId },
    orderBy: { at: "desc" },
  });
  if (events.length === 0) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const changes = diffFields(
          e.before as Record<string, unknown> | null,
          e.after as Record<string, unknown> | null,
        );
        return (
          <li key={e.id} className="border-l-2 border-slate-200 pl-3">
            <div className="text-sm">
              <span className="font-medium text-slate-900">{e.action}</span>{" "}
              <span className="text-slate-500">by {e.actorEmail}</span>
            </div>
            <div className="text-xs text-slate-500">{e.at.toISOString().replace("T", " ").slice(0, 19)} UTC</div>
            {e.reason ? <div className="mt-1 text-sm text-slate-700">“{e.reason}”</div> : null}
            {changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {changes.map((c) => (
                  <li key={c.field}>
                    <span className="font-mono">{c.field}</span>: {JSON.stringify(c.before) ?? "—"} →{" "}
                    <span className="font-medium">{JSON.stringify(c.after) ?? "—"}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
