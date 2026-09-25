import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import { availableTransitions } from "@platform/workflow";
import { AuditTimeline } from "@platform/ui/audit-timeline";
import { Badge, Button, Card, ErrorText, PageHeader, inputClass } from "@platform/ui";
import { transitionCaseAction } from "../actions";
import { ACTION_LABELS, kycMachine, riskBand, type KycStatusValue } from "../workflow";

const STATUS_TONE = {
  NEW: "neutral",
  IN_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
  ESCALATED: "warning",
} as const;

const RISK_TONE = { low: "success", medium: "warning", high: "danger" } as const;

export default async function KycCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission("kyc.app.view");
  const { id } = await params;
  const { error } = await searchParams;

  const kycCase = await prisma.kycCase.findUnique({
    where: { id },
    include: { documents: { orderBy: { type: "asc" } } },
  });
  if (!kycCase) notFound();

  const entity = {
    id: kycCase.id,
    status: kycCase.status as KycStatusValue,
    riskScore: kycCase.riskScore,
    assigneeId: kycCase.assigneeId,
    lastEscalatedById: kycCase.lastEscalatedById,
  };
  const transitions = availableTransitions(kycMachine, entity.status, user, entity);

  const relatedIds = [kycCase.assigneeId, kycCase.lastEscalatedById].filter((x): x is string => !!x);
  const related = await prisma.user.findMany({ where: { id: { in: relatedIds } }, select: { id: true, name: true } });
  const nameById = new Map(related.map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader
        title={`${kycCase.reference} · ${kycCase.applicantName}`}
        subtitle={`Submitted ${kycCase.submittedAt.toISOString().slice(0, 10)}`}
        actions={
          <Link href="/kyc" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            Back to queue
          </Link>
        }
      />
      {error ? <ErrorText>{error}</ErrorText> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Applicant">
            <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-slate-500">Name</dt>
                <dd className="text-slate-900">{kycCase.applicantName}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Country</dt>
                <dd className="text-slate-900">{kycCase.applicantCountry}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Source</dt>
                <dd className="text-slate-900">
                  {kycCase.source}
                  {kycCase.sourceId ? <span className="ml-1 font-mono text-xs text-slate-400">{kycCase.sourceId}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Risk score</dt>
                <dd>
                  <Badge tone={RISK_TONE[riskBand(kycCase.riskScore)]}>
                    {kycCase.riskScore} · {riskBand(kycCase.riskScore)}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Status</dt>
                <dd>
                  <Badge tone={STATUS_TONE[kycCase.status]}>{kycCase.status.replace("_", " ")}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Assignee</dt>
                <dd className="text-slate-900">
                  {kycCase.assigneeId ? (nameById.get(kycCase.assigneeId) ?? kycCase.assigneeId) : "Unassigned"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-slate-500">Escalated by</dt>
                <dd className="text-slate-900">
                  {kycCase.lastEscalatedById ? (nameById.get(kycCase.lastEscalatedById) ?? kycCase.lastEscalatedById) : "—"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Documents">
            <ul className="divide-y divide-slate-100 text-sm">
              {kycCase.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium text-slate-900">{d.type.replace(/_/g, " ")}</span>{" "}
                    <span className="font-mono text-xs text-slate-500">{d.filename}</span>
                  </span>
                  <Badge tone={d.verified ? "success" : "neutral"}>{d.verified ? "verified" : "unverified"}</Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Decision">
            {transitions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No actions available to you on this case in state {kycCase.status.replace("_", " ")}.
              </p>
            ) : (
              <div className="space-y-4">
                {transitions.map((t) => (
                  <form key={t.action} action={transitionCaseAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="caseId" value={kycCase.id} />
                    <input type="hidden" name="action" value={t.action} />
                    {t.requiresReason ? (
                      <label className="min-w-64 flex-1 space-y-1">
                        <span className="block text-xs font-medium text-slate-600">
                          Reason (required for {ACTION_LABELS[t.action] ?? t.action})
                        </span>
                        <textarea name="reason" rows={2} required className={inputClass} />
                      </label>
                    ) : null}
                    <Button type="submit" variant={t.action === "reject" ? "danger" : "primary"}>
                      {ACTION_LABELS[t.action] ?? t.action}
                    </Button>
                  </form>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Audit timeline" className="h-fit">
          <AuditTimeline app="kyc" entityType="KycCase" entityId={kycCase.id} />
        </Card>
      </div>
    </>
  );
}
