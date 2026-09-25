import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { Badge, Button, Card, ErrorText, PageHeader, inputClass } from "@platform/ui";
import { CONNECTORS_PERMISSION, ensureMappingRows, isSourceField, SOURCE_FIELDS, TARGET_FIELDS, UNMAPPED } from "../../import";
import { deleteMappingAction, resetMappingAction, saveMappingAction } from "./actions";

export default async function SchemaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission(CONNECTORS_PERMISSION);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const connector = getConnector(id);
  if (!connector) notFound();

  const rows = await ensureMappingRows(prisma, id);
  const stored = new Map(rows.map((r) => [r.targetField, r]));

  return (
    <>
      <PageHeader
        title={`${connector.name} → KycCase`}
        subtitle="Which connector field fills each KYC column on pull. Changes apply to the next pull; decided cases are never rewritten."
        actions={
          <Link href="/admin/connectors" className="text-sm text-blue-700 hover:underline">
            Back to connectors
          </Link>
        }
      />
      {sp.error ? <ErrorText>{sp.error}</ErrorText> : null}
      <Card>
        <p className="mb-3 text-sm text-slate-600">
          Source record shape: <code className="font-mono text-xs">{`{ ${SOURCE_FIELDS.join(", ")} }`}</code>.
        </p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">KycCase column</th>
              <th className="px-3 py-2 font-medium">Connector field</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {TARGET_FIELDS.map((target) => {
              const row = stored.get(target);
              const current = isSourceField(row?.sourceField) ? row.sourceField : undefined;
              return (
                <tr key={target} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{target}</td>
                  <td className="px-3 py-2">
                    <form action={saveMappingAction} className="flex items-center gap-2">
                      <input type="hidden" name="source" value={id} />
                      <input type="hidden" name="targetField" value={target} />
                      <select name="sourceField" defaultValue={current ?? ""} className={inputClass}>
                        {current ? null : <option value="">— pick a field —</option>}
                        {SOURCE_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    {current ? (
                      <Badge tone="success">mapped</Badge>
                    ) : (
                      <Badge tone="warning">unmapped → &quot;{UNMAPPED}&quot;</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {current ? (
                      <form action={deleteMappingAction}>
                        <input type="hidden" name="source" value={id} />
                        <input type="hidden" name="targetField" value={target} />
                        <Button type="submit" variant="danger">
                          Delete
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <form action={resetMappingAction} className="mt-4">
          <input type="hidden" name="source" value={id} />
          <Button type="submit" variant="secondary">
            Reset to defaults
          </Button>
        </form>
      </Card>
    </>
  );
}
