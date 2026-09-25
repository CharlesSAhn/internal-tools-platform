import type { Connector, ConnectorRecord } from "@platform/connectors";
import { prisma, type Tx } from "@platform/db";

export const CONNECTORS_PERMISSION = "admin.connectors.view";

export const TARGET_FIELDS = ["applicantName", "applicantCountry"] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];
/**
 * A mapping value is a template over the connector's raw record: `{path}` tokens are replaced by
 * the value at that dot-path, literal text is kept. `"{name.first} {name.last}"`, `"{nat}"`.
 */
export type Mapping = Partial<Record<TargetField, string>>;
export type Applicant = Record<TargetField, string> & { riskScore: number };
/** `null`: the column is mapped but the source record has no value at the mapped path(s). */
export type MappedColumns = Record<TargetField, string | null>;

export const DEFAULT_MAPPING: Required<Mapping> = {
  applicantName: "{name.first} {name.last}",
  applicantCountry: "{nat}",
};
/** Value written when an admin has removed the mapping for a required column. */
export const UNMAPPED = "UNMAPPED";
/** Value written for a new case whose mapped source path is empty; existing cases keep their value. */
export const MISSING = "MISSING";
/** Row value meaning "admin explicitly unmapped this column"; distinct from a row that was never created. */
export const NO_SOURCE = "";

/**
 * Values stored by the previous flattened-record editor, translated onto the raw payload. `id` was the
 * connector uuid, which is already kept as `sourceId`; a column mapped to it reverts to its default.
 */
function upgradeLegacyValue(targetField: string, sourceField: string): string | undefined {
  if (sourceField === "name") return DEFAULT_MAPPING.applicantName;
  if (sourceField === "country") return DEFAULT_MAPPING.applicantCountry;
  if (sourceField === "id" && isTargetField(targetField)) return DEFAULT_MAPPING[targetField];
  return undefined;
}

const TOKEN = /\{([a-zA-Z0-9_.]+)\}/g;
const VALUE_MAX = 120;

export function isTargetField(v: unknown): v is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(String(v));
}

export function templatePaths(template: string): string[] {
  return Array.from(template.matchAll(TOKEN), (m) => m[1]);
}

/**
 * A usable template references at least one path, only paths the connector documents, and no stray
 * braces: `{nat}{missing` or `{{nat}}` would otherwise leak literal brace text into a case.
 */
export function isValidTemplate(template: unknown, fields: readonly string[]): template is string {
  if (typeof template !== "string" || template.length > VALUE_MAX) return false;
  const paths = templatePaths(template);
  if (paths.length === 0 || !paths.every((p) => fields.includes(p))) return false;
  return !/[{}]/.test(template.replace(TOKEN, ""));
}

export function readPath(raw: Record<string, unknown>, path: string): string {
  const v = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as object)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, raw);
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

export function renderTemplate(template: string, raw: Record<string, unknown>): string {
  return template
    .replace(TOKEN, (_, path: string) => readPath(raw, path))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VALUE_MAX);
}

export function defaultMappingRows(source: string) {
  return TARGET_FIELDS.map((t) => ({ source, targetField: t, sourceField: DEFAULT_MAPPING[t] }));
}

/**
 * Materialises the default rows the first time a source is touched, so afterwards every target
 * field has exactly one row and the stored state is never ambiguous with "unconfigured".
 * Rows written by the earlier flattened editor are upgraded to raw-path templates in place; the
 * upgrade is conditional on the legacy value still being there so it cannot clobber a concurrent save.
 */
export async function ensureMappingRows(tx: Tx, source: string) {
  const rows = await tx.sourceMapping.findMany({ where: { source }, orderBy: { targetField: "asc" } });
  if (rows.length === 0) {
    await tx.sourceMapping.createMany({ data: defaultMappingRows(source), skipDuplicates: true });
    return tx.sourceMapping.findMany({ where: { source }, orderBy: { targetField: "asc" } });
  }
  let upgraded = false;
  for (const r of rows) {
    const next = upgradeLegacyValue(r.targetField, r.sourceField);
    if (!next) continue;
    const { count } = await tx.sourceMapping.updateMany({
      where: { id: r.id, sourceField: r.sourceField },
      data: { sourceField: next },
    });
    upgraded ||= count > 0;
  }
  return upgraded ? tx.sourceMapping.findMany({ where: { source }, orderBy: { targetField: "asc" } }) : rows;
}

export async function loadMapping(connector: Pick<Connector, "id" | "fields">): Promise<Mapping> {
  const rows = await ensureMappingRows(prisma, connector.id);
  const mapping: Mapping = {};
  for (const r of rows) {
    if (isTargetField(r.targetField) && isValidTemplate(r.sourceField, connector.fields)) {
      mapping[r.targetField] = r.sourceField;
    }
  }
  return mapping;
}

function column(mapping: Mapping, target: TargetField, raw: Record<string, unknown>): string | null {
  const template = mapping[target];
  if (!template) return UNMAPPED;
  const value = renderTemplate(template, raw);
  if (!value) return null;
  return target === "applicantCountry" && /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : value;
}

export function applyMapping(mapping: Mapping, record: ConnectorRecord): MappedColumns {
  return {
    applicantName: column(mapping, "applicantName", record.raw),
    applicantCountry: column(mapping, "applicantCountry", record.raw),
  };
}

/** Resolve mapped columns against the case being written: an empty source keeps what is already there. */
export function resolveColumns(
  mapped: MappedColumns,
  existing: Record<TargetField, string> | null,
): Record<TargetField, string> {
  return {
    applicantName: mapped.applicantName ?? existing?.applicantName ?? MISSING,
    applicantCountry: mapped.applicantCountry ?? existing?.applicantCountry ?? MISSING,
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
