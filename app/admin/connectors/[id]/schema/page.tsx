import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { getConnector } from "@platform/connectors";
import { prisma } from "@platform/db";
import { Badge, Button, Card, ErrorText, PageHeader, inputClass } from "@platform/ui";
import {
  CONNECTORS_PERMISSION,
  ensureMappingRows,
  isValidTemplate,
  MISSING,
  readPath,
  renderTemplate,
  TARGET_FIELDS,
  UNMAPPED,
} from "../../import";
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

  const [rows, records] = await Promise.all([
    ensureMappingRows(prisma, id),
    connector.status === "live" ? connector.listRecords() : Promise.resolve([]),
  ]);
  const stored = new Map(rows.map((r) => [r.targetField, r]));
  const sample = records[0];
  const listId = `${id}-fields`;

  return (
    <>
      <PageHeader
        title={`${connector.name} → KycCase`}
        subtitle="Which raw source fields fill each KYC column on pull. Templates combine {path} tokens and literal text. Changes apply to the next pull; decided cases are never rewritten."
        actions={
          <Link href="/admin/connectors" className="text-sm text-blue-700 hover:underline">
            Back to connectors
          </Link>
        }
      />
      {sp.error ? <ErrorText>{sp.error}</ErrorText> : null}
      <Card>
        <datalist id={listId}>
          {connector.fields.map((f) => (
            <option key={f} value={`{${f}}`} />
          ))}
        </datalist>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">KycCase column</th>
              <th className="px-3 py-2 font-medium">Template over raw record</th>
              <th className="px-3 py-2 font-medium">Preview (first record)</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {TARGET_FIELDS.map((target) => {
              const row = stored.get(target);
              const current = isValidTemplate(row?.sourceField, connector.fields) ? row!.sourceField : undefined;
              const preview = current && sample ? renderTemplate(current, sample.raw) || MISSING : UNMAPPED;
              return (
                <tr key={target} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="px-3 py-2 font-mono text-xs">{target}</td>
                  <td className="px-3 py-2">
                    <form action={saveMappingAction} className="flex items-center gap-2">
                      <input type="hidden" name="source" value={id} />
                      <input type="hidden" name="targetField" value={target} />
                      <input
                        key={current ?? "unmapped"}
                        name="sourceField"
                        list={listId}
                        defaultValue={current ?? ""}
                        placeholder="{name.first} {name.last}"
                        className={`${inputClass} w-72 font-mono text-xs`}
                      />
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{sample ? preview : "—"}</td>
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

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-medium text-slate-900">Available source fields</h2>
          <table className="w-full text-left text-xs">
            <tbody>
              {connector.fields.map((f) => (
                <tr key={f} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-3 font-mono">{`{${f}}`}</td>
                  <td className="py-1 font-mono text-slate-500">{sample ? readPath(sample.raw, f) || "∅" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-medium text-slate-900">Raw record (first of {records.length})</h2>
          <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs text-slate-700">
            {sample ? JSON.stringify(sample.raw, null, 2) : "No records available."}
          </pre>
        </Card>
      </div>
    </>
  );
}
