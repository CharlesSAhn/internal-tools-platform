import { requirePermission } from "@platform/auth";
import { connectors, type Connector, type ConnectorRecord } from "@platform/connectors";
import { Badge, Button, Card, ErrorText, PageHeader } from "@platform/ui";
import { pullIntoKycAction } from "./actions";
import { CONNECTORS_PERMISSION } from "./import";

const PREVIEW_LIMIT = 8;

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

function LiveCard({ connector, records }: { connector: Connector; records: ConnectorRecord[] }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Icon initials={connector.initials} live />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">{connector.name}</span>
            <Badge tone="success">Enabled / Connected</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{connector.description}</p>
          <p className="mt-3 text-sm font-medium text-slate-900">
            Data sources coming in: {records.length} records
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
            {records.slice(0, PREVIEW_LIMIT).map((r) => (
              <li key={r.id}>
                {r.name} <span className="font-mono text-xs text-slate-400">{r.country}</span>
              </li>
            ))}
          </ul>
          <form action={pullIntoKycAction} className="mt-3">
            <input type="hidden" name="connectorId" value={connector.id} />
            <Button type="submit">Pull into KYC</Button>
          </form>
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
            <Badge tone="neutral">Not connected</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{connector.description}</p>
          <Button type="button" variant="secondary" disabled className="mt-3">
            Pull into KYC
          </Button>
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
  const records = await Promise.all(live.map((c) => c.listRecords()));

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
          <LiveCard key={c.id} connector={c} records={records[i]} />
        ))}
        {disabled.map((c) => (
          <DisabledCard key={c.id} connector={c} />
        ))}
      </div>
    </>
  );
}
