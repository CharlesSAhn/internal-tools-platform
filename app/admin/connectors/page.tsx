import Link from "next/link";
import { requirePermission } from "@platform/auth";
import { connectors, type Connector, type ConnectorRecord } from "@platform/connectors";
import { prisma } from "@platform/db";
import { Badge, Button, Card, ErrorText, PageHeader } from "@platform/ui";
import { pullIntoKycAction } from "./actions";
import { CONNECTORS_PERMISSION } from "./import";

type PullSummary = { seen?: number; imported?: number; updated?: number };
type Activity = { lastAt: Date | null; lastPull: PullSummary; lastHour: number };

/** Recent activity comes from the per-pull audit rows, not from re-fetching the source. */
async function activityFor(connectorId: string): Promise<Activity> {
  const where = { app: "admin", entityType: "Connector", entityId: connectorId, action: "pull" };
  const [last, recent] = await Promise.all([
    prisma.auditEvent.findFirst({ where, orderBy: { at: "desc" } }),
    prisma.auditEvent.findMany({
      where: { ...where, at: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      select: { after: true },
    }),
  ]);
  const ingested = (s: PullSummary) => (s.imported ?? 0) + (s.updated ?? 0);
  return {
    lastAt: last?.at ?? null,
    lastPull: (last?.after as PullSummary | null) ?? {},
    lastHour: recent.reduce((n, e) => n + ingested((e.after as PullSummary | null) ?? {}), 0),
  };
}

function Icon({ initials, live }: { initials: string; live: boolean }) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
        live ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
      }`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function LiveCard({
  connector,
  records,
  activity,
}: {
  connector: Connector;
  records: ConnectorRecord[];
  activity: Activity;
}) {
  const { lastAt, lastPull, lastHour } = activity;
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Icon initials={connector.initials} live />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">{connector.name}</span>
            <Badge tone="success">Enabled</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{connector.description}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Available now</dt>
            <dd className="text-slate-900">{records.length} records</dd>
            <dt className="text-slate-500">Last pull</dt>
            <dd className="text-slate-900">
              {lastAt ? (
                <>
                  {lastAt.toLocaleString("en-GB", { timeZone: "UTC" })} UTC —{" "}
                  {(lastPull.imported ?? 0) + (lastPull.updated ?? 0)} ingested of {lastPull.seen ?? 0}
                </>
              ) : (
                "never"
              )}
            </dd>
            <dt className="text-slate-500">Last hour</dt>
            <dd className="text-slate-900">{lastHour} ingested</dd>
          </dl>
          <div className="mt-3 flex items-center gap-3">
            <form action={pullIntoKycAction}>
              <input type="hidden" name="connectorId" value={connector.id} />
              <Button type="submit" variant="secondary">
                Pull now
              </Button>
            </form>
            <Link href={`/admin/connectors/${connector.id}/schema`} className="text-sm text-blue-700 hover:underline">
              Schema
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DisabledCard({ connector }: { connector: Connector }) {
  return (
    <Card>
      <div className="flex items-start gap-3 opacity-70" title="Not wired in this prototype">
        <Icon initials={connector.initials} live={false} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">{connector.name}</span>
            <Badge tone="neutral">Disabled</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{connector.description}</p>
          <p className="mt-3 text-sm text-slate-500">Not connected</p>
        </div>
      </div>
    </Card>
  );
}

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; updated?: string; seen?: string; error?: string }>;
}) {
  await requirePermission(CONNECTORS_PERMISSION);
  const sp = await searchParams;

  const live = connectors.filter((c) => c.status === "live");
  const disabled = connectors.filter((c) => c.status === "disabled");
  const [records, activity] = await Promise.all([
    Promise.all(live.map((c) => c.listRecords())),
    Promise.all(live.map((c) => activityFor(c.id))),
  ]);

  return (
    <>
      <PageHeader
        title="Connectors"
        subtitle="One live HTTP connector. Other tiles are catalog placeholders."
      />
      {sp.error ? <ErrorText>{sp.error}</ErrorText> : null}
      {sp.imported ? (
        <p className="text-sm text-slate-700">
          {sp.seen ?? "?"} records pulled: {sp.imported} new KYC case{sp.imported === "1" ? "" : "s"},{" "}
          {sp.updated ?? "0"} updated.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {live.map((c, i) => (
          <LiveCard key={c.id} connector={c} records={records[i]} activity={activity[i]} />
        ))}
        {disabled.map((c) => (
          <DisabledCard key={c.id} connector={c} />
        ))}
      </div>
    </>
  );
}
