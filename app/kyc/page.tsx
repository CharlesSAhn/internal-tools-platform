import { requirePermission } from "@platform/auth";
import { prisma } from "@platform/db";
import { Badge, Card, DataTable, PageHeader, Pagination, inputClass } from "@platform/ui";
import type { KycStatus, Prisma } from "@prisma/client";
import { HIGH_RISK_THRESHOLD, riskBand } from "./workflow";

const PAGE_SIZE = 25;

const STATUS_TONE: Record<KycStatus, "neutral" | "info" | "success" | "danger" | "warning"> = {
  NEW: "neutral",
  IN_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
  ESCALATED: "warning",
};

const RISK_TONE = { low: "success", medium: "warning", high: "danger" } as const;

const SEARCH_MAX_LENGTH = 100;

function parseStatus(status?: string): KycStatus | undefined {
  return status && Object.hasOwn(STATUS_TONE, status) ? (status as KycStatus) : undefined;
}

function parsePage(page?: string): number {
  const n = Number(page);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

type Search = {
  status?: string;
  risk?: string;
  mine?: string;
  q?: string;
  page?: string;
};

function riskFilter(risk?: string): Prisma.KycCaseWhereInput {
  if (risk === "low") return { riskScore: { lt: 40 } };
  if (risk === "medium") return { riskScore: { gte: 40, lt: HIGH_RISK_THRESHOLD } };
  if (risk === "high") return { riskScore: { gte: HIGH_RISK_THRESHOLD } };
  return {};
}

function parseRisk(risk?: string): "low" | "medium" | "high" | undefined {
  return risk === "low" || risk === "medium" || risk === "high" ? risk : undefined;
}

export default async function KycQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("kyc.app.view");
  const sp = await searchParams;
  const status = parseStatus(sp.status);
  const risk = parseRisk(sp.risk);
  const q = sp.q?.slice(0, SEARCH_MAX_LENGTH);

  const where: Prisma.KycCaseWhereInput = {
    ...(status ? { status } : {}),
    ...riskFilter(risk),
    ...(sp.mine === "1" ? { assigneeId: user.id } : {}),
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { applicantName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await prisma.kycCase.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(parsePage(sp.page), pageCount);

  const cases = await prisma.kycCase.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const assigneeIds = [...new Set(cases.map((c) => c.assigneeId).filter((id): id is string => !!id))];
  const assignees = await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } });
  const nameById = new Map(assignees.map((a) => [a.id, a.name]));

  const hrefFor = (p: number) =>
    `/kyc?${new URLSearchParams({
      ...(status ? { status } : {}),
      ...(risk ? { risk } : {}),
      ...(sp.mine === "1" ? { mine: "1" } : {}),
      ...(q ? { q } : {}),
      page: String(p),
    })}`;

  return (
    <>
      <PageHeader title="KYC review queue" subtitle={`${total} case${total === 1 ? "" : "s"} matching the current filters`} />
      <Card>
        <form action="/kyc" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Status</span>
            <select name="status" defaultValue={status ?? ""} className={inputClass}>
              <option value="">All</option>
              {(Object.keys(STATUS_TONE) as KycStatus[]).map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Risk band</span>
            <select name="risk" defaultValue={risk ?? ""} className={inputClass}>
              <option value="">All</option>
              <option value="low">Low (&lt;40)</option>
              <option value="medium">Medium (40–79)</option>
              <option value="high">High (≥80)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Search</span>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="reference or applicant" className={inputClass} />
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} />
            <span className="text-sm text-slate-700">Assigned to me</span>
          </label>
          <button className="mb-1 rounded-md bg-slate-900 px-3 py-1.5 text-white">Apply</button>
          <a href="/kyc" className="mb-1 rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
            Reset
          </a>
        </form>

        <DataTable
          rows={cases}
          rowHref={(c) => `/kyc/${c.id}`}
          empty="No cases match these filters"
          columns={[
            { header: "Reference", cell: (c) => c.reference },
            { header: "Applicant", cell: (c) => c.applicantName },
            { header: "Country", cell: (c) => c.applicantCountry },
            {
              header: "Risk",
              cell: (c) => <Badge tone={RISK_TONE[riskBand(c.riskScore)]}>{c.riskScore}</Badge>,
            },
            { header: "Status", cell: (c) => <Badge tone={STATUS_TONE[c.status]}>{c.status.replace("_", " ")}</Badge> },
            { header: "Assignee", cell: (c) => (c.assigneeId ? (nameById.get(c.assigneeId) ?? "—") : "Unassigned") },
            { header: "Submitted", cell: (c) => c.submittedAt.toISOString().slice(0, 10) },
          ]}
        />
        <Pagination page={page} pageCount={pageCount} hrefFor={hrefFor} />
      </Card>
    </>
  );
}
