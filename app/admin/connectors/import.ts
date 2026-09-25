import type { ConnectorRecord } from "@platform/connectors";
import { prisma } from "@platform/db";

export const CONNECTORS_PERMISSION = "admin.connectors.view";

export const SOURCE_FIELDS = ["id", "name", "country"] as const satisfies readonly (keyof ConnectorRecord)[];
export const TARGET_FIELDS = ["applicantName", "applicantCountry"] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];
export type TargetField = (typeof TARGET_FIELDS)[number];
export type Mapping = Partial<Record<TargetField, SourceField>>;
export type Applicant = Record<TargetField, string> & { riskScore: number };

export const DEFAULT_MAPPING: Required<Mapping> = { applicantName: "name", applicantCountry: "country" };
/** Value written when an admin has removed the mapping for a required column. */
export const UNMAPPED = "UNMAPPED";

export function isSourceField(v: unknown): v is SourceField {
  return (SOURCE_FIELDS as readonly string[]).includes(String(v));
}
export function isTargetField(v: unknown): v is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(String(v));
}

/** Stored mapping rows for a source. With no rows at all the built-in defaults apply. */
export async function loadMapping(source: string): Promise<Mapping> {
  const rows = await prisma.sourceMapping.findMany({ where: { source } });
  if (rows.length === 0) return { ...DEFAULT_MAPPING };
  const mapping: Mapping = {};
  for (const r of rows) if (isTargetField(r.targetField) && isSourceField(r.sourceField)) mapping[r.targetField] = r.sourceField;
  return mapping;
}

export function applyMapping(mapping: Mapping, record: ConnectorRecord): Record<TargetField, string> {
  return {
    applicantName: mapping.applicantName ? record[mapping.applicantName] : UNMAPPED,
    applicantCountry: mapping.applicantCountry ? record[mapping.applicantCountry] : UNMAPPED,
  };
}

/** Stable, deterministic risk band so an imported case looks like the seeded ones. */
export function syntheticRisk(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h % 100;
}

/** Prisma's unique-constraint code: another pull already imported this record. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Import key: stable per source record, so re-pulling the same record is a no-op. */
/** Human-facing case id, assigned from the database sequence once the row exists. */
export function referenceFor(caseNumber: number): string {
  return `KYC-${String(caseNumber).padStart(6, "0")}`;
}
