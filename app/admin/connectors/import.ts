import type { ConnectorRecord } from "@platform/connectors";
import { prisma, type Tx } from "@platform/db";

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

/** Row value meaning "admin explicitly unmapped this column"; distinct from a row that was never created. */
export const NO_SOURCE = "";

export function defaultMappingRows(source: string) {
  return TARGET_FIELDS.map((t) => ({ source, targetField: t, sourceField: DEFAULT_MAPPING[t] }));
}

/**
 * Materialises the default rows the first time a source is touched, so afterwards every target
 * field has exactly one row and the stored state is never ambiguous with "unconfigured".
 */
export async function ensureMappingRows(tx: Tx, source: string) {
  const rows = await tx.sourceMapping.findMany({ where: { source }, orderBy: { targetField: "asc" } });
  if (rows.length > 0) return rows;
  await tx.sourceMapping.createMany({ data: defaultMappingRows(source), skipDuplicates: true });
  return tx.sourceMapping.findMany({ where: { source }, orderBy: { targetField: "asc" } });
}

export async function loadMapping(source: string): Promise<Mapping> {
  const rows = await ensureMappingRows(prisma, source);
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

/** Reference format used by imports before cases carried `source`/`sourceId`; used to adopt those rows. */
export function legacyReferenceFor(connectorId: string, recordId: string): string {
  const slug = recordId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32).toUpperCase();
  return `${connectorId.toUpperCase()}-${slug}`;
}

/** Human-facing case id, assigned from the database sequence once the row exists. */
export function referenceFor(caseNumber: number): string {
  return `KYC-${String(caseNumber).padStart(6, "0")}`;
}
