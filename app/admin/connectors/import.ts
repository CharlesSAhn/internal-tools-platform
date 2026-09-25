export const CONNECTORS_PERMISSION = "admin.connectors.view";

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
export function referenceFor(connectorId: string, recordId: string): string {
  const slug = recordId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32).toUpperCase();
  return `${connectorId.toUpperCase()}-${slug}`;
}
